// Claude Code backend through the Claude Agent SDK (ADR 0004, docs/adapters/claude-sdk.md).
// The core decides every tool call: the PreToolUse hook (runs before every permission rule) waits for
// `hooks.decide`; canUseTool only reuses that decision. Hook failures block the tool (onFailure: "block").
import {
  query as sdkQuery,
  type CanUseTool,
  type HookCallbackMatcher,
  type Options,
  type PermissionResult,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { Backend, BackendEvent, BackendHooks, Capabilities, Decision, Effort, Mode, SessionHandle, StartOptions, UserMessage } from "../types.js";
import { claudeEnv, SUBSCRIPTION_KEY_SOURCE } from "./env.js";
import { InputQueue } from "./inputQueue.js";
import { CLAUDE_TOOLS, isUntrustedOutput, toToolCall } from "./toolMap.js";

export type QueryFn = (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => Query;

export interface ClaudeBackendOptions {
  /** Injected in tests (record/replay); defaults to the SDK's `query`. */
  queryFn?: QueryFn;
  /** Environment to build the allowlisted env from (default `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Seconds a PreToolUse hook may wait for the user (default 1 hour). */
  hookTimeoutSec?: number;
  /** Reject sessions whose `apiKeySource` is not the subscription login (default true). */
  requireSubscription?: boolean;
}

export const CLAUDE_CAPABILITIES: Capabilities = {
  interrupt: true,
  resume: true,
  fork: true,
  setMode: true,
  setModel: true,
  partialText: true,
  cost: "estimate",
  quotaEvents: true,
  decide: "callback",
  images: true,
  sandbox: ["macos", "linux"],
  externalSessions: true,
};

const SDK_VERSION = "0.3.327";

export class ClaudeBackend implements Backend {
  readonly info = { id: "claude", version: SDK_VERSION, capabilities: CLAUDE_CAPABILITIES };

  constructor(private readonly opts: ClaudeBackendOptions = {}) {}

  async start(start: StartOptions, hooks: BackendHooks): Promise<SessionHandle> {
    const session = new ClaudeSession(start, hooks, this.opts);
    session.run();
    return session;
  }
}

function toSdkMode(mode: Mode): Options["permissionMode"] {
  return mode === "plan" ? "plan" : "default";
}

class ClaudeSession implements SessionHandle {
  private readonly input = new InputQueue<SDKUserMessage>();
  private readonly q: Query;
  /** Decisions taken in the hook, reused by canUseTool for the same tool_use_id. */
  private readonly decided = new Map<string, Decision>();
  private readonly toolNames = new Map<string, string>();
  private backendSessionId = "";
  private turnStartedAt = 0;
  private closed = false;

  constructor(
    private readonly start: StartOptions,
    private readonly hooks: BackendHooks,
    private readonly opts: ClaudeBackendOptions,
  ) {
    const queryFn = opts.queryFn ?? (sdkQuery as unknown as QueryFn);
    this.q = queryFn({ prompt: this.input, options: this.options() });
  }

  private options(): Options {
    const s = this.start;
    const preToolUse: HookCallbackMatcher = {
      timeout: this.opts.hookTimeoutSec ?? 3600,
      onFailure: "block",
      hooks: [
        async (input) => {
          if (input.hook_event_name !== "PreToolUse") return {};
          const d = await this.decide(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>, input.tool_use_id, input.agent_id, input.mcp_server);
          return {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: d.action === "deny" ? "deny" : "allow",
              permissionDecisionReason: d.action === "deny" ? d.reason : "approved by 5ilence",
              ...(d.action === "modify" ? { updatedInput: d.input } : {}),
            },
          };
        },
      ],
    };
    const canUseTool: CanUseTool = async (toolName, input, o): Promise<PermissionResult> => {
      const d = this.decided.get(o.toolUseID) ?? (await this.decide(toolName, input, o.toolUseID, o.agentID));
      if (d.action === "deny") return { behavior: "deny", message: d.reason, ...(d.interrupt ? { interrupt: true } : {}) };
      return { behavior: "allow", updatedInput: d.action === "modify" ? d.input : input };
    };
    return {
      cwd: s.cwd,
      env: claudeEnv(this.opts.env),
      settingSources: ["project"],
      permissionMode: toSdkMode(s.mode),
      tools: [...CLAUDE_TOOLS],
      systemPrompt: { type: "preset", preset: "claude_code", ...(s.systemAppend ? { append: s.systemAppend } : {}) },
      includePartialMessages: true,
      hooks: { PreToolUse: [preToolUse] },
      canUseTool,
      ...(s.plugins?.length ? { plugins: s.plugins.map((path) => ({ type: "local" as const, path })) } : {}),
      ...(s.model ? { model: s.model } : {}),
      ...(s.effort ? { effort: s.effort } : {}),
      ...(s.limits?.maxTurns ? { maxTurns: s.limits.maxTurns } : {}),
      ...(s.limits?.maxUsd ? { maxBudgetUsd: s.limits.maxUsd } : {}),
      ...(s.resume ? { resume: s.resume.backendSessionId, ...(s.resume.fork ? { forkSession: true } : {}), ...(s.resume.atMessageId ? { resumeSessionAt: s.resume.atMessageId } : {}) } : {}),
    } as Options;
  }

  /** Ask the core; a failure is a deny, never an allow. */
  private async decide(toolName: string, input: Record<string, unknown>, toolUseId: string, agentId?: string, mcpServer?: { name: string; source: string }): Promise<Decision> {
    const cached = this.decided.get(toolUseId);
    if (cached) return cached;
    const call = toToolCall({ toolName, input, toolUseId, cwd: this.start.cwd, ...(agentId ? { agentId } : {}), ...(mcpServer ? { mcpServer } : {}) });
    let d: Decision;
    try {
      d = await this.hooks.decide(call);
    } catch (e) {
      d = { action: "deny", reason: `harness unavailable: ${e instanceof Error ? e.message : String(e)}` };
    }
    this.decided.set(toolUseId, d);
    this.toolNames.set(toolUseId, toolName);
    if (d.action !== "deny") this.emit({ type: "tool.start", callId: toolUseId, name: call.name, args: call.args });
    return d;
  }

  private emit(e: BackendEvent): void {
    try {
      this.hooks.emit(e);
    } catch {
      /* a listener error must not break the stream */
    }
  }

  /** Pump SDK messages into backend events until the query ends. */
  run(): void {
    void (async () => {
      try {
        for await (const m of this.q) this.onMessage(m);
      } catch (e) {
        if (!this.closed) {
          this.emit({ type: "error", code: "backend_crashed", message: e instanceof Error ? e.message : String(e), retryable: true });
          this.emit({ type: "turn.end", stop: "error", durationMs: this.turnStartedAt ? Date.now() - this.turnStartedAt : 0 });
        }
      }
    })();
  }

  private onMessage(m: SDKMessage): void {
    const any = m as Record<string, unknown> & { type: string; subtype?: string };
    switch (any.type) {
      case "system":
        if (any.subtype === "init") this.onInit(any);
        else if (any.subtype === "compact_boundary") {
          const meta = (any.compact_metadata ?? {}) as { trigger?: "auto" | "manual"; pre_tokens?: number };
          this.emit({ type: "compacted", trigger: meta.trigger ?? "auto", preTokens: meta.pre_tokens ?? 0 });
        }
        return;
      case "stream_event": {
        const ev = any.event as { type?: string; delta?: { type?: string; text?: string; thinking?: string } } | undefined;
        if (ev?.type === "content_block_delta" && any.parent_tool_use_id == null) {
          if (ev.delta?.type === "text_delta" && ev.delta.text) this.emit({ type: "text.delta", text: ev.delta.text });
          if (ev.delta?.type === "thinking_delta" && ev.delta.thinking) this.emit({ type: "thinking.delta", text: ev.delta.thinking });
        }
        return;
      }
      case "assistant": {
        const msg = any.message as { id?: string; content?: unknown } | undefined;
        if (any.parent_tool_use_id == null) this.emit({ type: "message", role: "assistant", content: msg?.content ?? [], messageId: String(msg?.id ?? any.uuid ?? "") });
        const err = any.error as string | undefined;
        if (err === "rate_limit") this.emit({ type: "error", code: "rate_limited", message: "rate limited", retryable: true });
        else if (err === "authentication_failed") this.emit({ type: "error", code: "auth_required", message: "Claude login required: run `claude` then /login", retryable: false });
        else if (err === "billing_error") this.emit({ type: "error", code: "quota_exhausted", message: "usage limit reached", retryable: false });
        else if (err === "overloaded") this.emit({ type: "error", code: "overloaded", message: "Claude is overloaded", retryable: true });
        return;
      }
      case "user": {
        const content = (any.message as { content?: unknown } | undefined)?.content;
        if (!Array.isArray(content)) return;
        for (const block of content as Array<Record<string, unknown>>) {
          if (block.type !== "tool_result") continue;
          const id = String(block.tool_use_id ?? "");
          const name = this.toolNames.get(id) ?? "";
          this.emit({ type: "tool.end", callId: id, ok: block.is_error !== true, output: resultText(block.content).slice(0, 8000), untrusted: isUntrustedOutput(name) });
        }
        return;
      }
      case "rate_limit_event":
        this.onRateLimit(any.rate_limit_info as Record<string, unknown> | undefined);
        return;
      case "result":
        this.onResult(any);
        return;
      default:
        return; // undocumented/new message types are ignored (spike: task_*, thinking_tokens, …)
    }
  }

  private onInit(m: Record<string, unknown>): void {
    this.backendSessionId = String(m.session_id ?? "");
    const source = String(m.apiKeySource ?? "");
    this.emit({ type: "ready", backendSessionId: this.backendSessionId, model: String(m.model ?? ""), tools: (m.tools as string[]) ?? [], backendVersion: String(m.claude_code_version ?? ""), auth: { source } });
    if ((this.opts.requireSubscription ?? true) && source !== SUBSCRIPTION_KEY_SOURCE) {
      this.emit({ type: "error", code: "auth_required", message: `Claude is using credential source "${source}", not the subscription login`, retryable: false });
      void this.interrupt().finally(() => void this.close());
    }
  }

  private onRateLimit(info: Record<string, unknown> | undefined): void {
    if (!info) return;
    const windows = (info.unifiedWindows ?? {}) as Record<string, { utilization?: number; resetsAt?: number; status?: string }>;
    let worst: { name: string; utilization: number; resetsAt?: number; status?: string } | null = null;
    for (const [name, w] of Object.entries(windows)) {
      if (typeof w?.utilization === "number" && (!worst || w.utilization > worst.utilization)) worst = { name, utilization: w.utilization, ...(w.resetsAt ? { resetsAt: w.resetsAt } : {}), ...(w.status ? { status: w.status } : {}) };
    }
    const status = String(info.status ?? worst?.status ?? "allowed");
    const resetsAt = (worst?.resetsAt ?? (info.resetsAt as number | undefined)) as number | undefined;
    const utilization = worst?.utilization ?? (info.utilization as number | undefined);
    this.emit({
      type: "quota",
      status: status === "rejected" ? "exhausted" : status === "allowed_warning" ? "warning" : "ok",
      ...(resetsAt ? { resetsAt: resetsAt * 1000 } : {}),
      ...(utilization !== undefined ? { utilization } : {}),
      ...(worst ? { window: worst.name } : info.rateLimitType ? { window: String(info.rateLimitType) } : {}),
    });
  }

  private onResult(m: Record<string, unknown>): void {
    const usage = (m.usage ?? {}) as Record<string, number>;
    this.emit({
      type: "usage",
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
      usd: typeof m.total_cost_usd === "number" ? m.total_cost_usd : 0,
      usdKind: "estimate",
      model: "",
    });
    const sub = String(m.subtype ?? "");
    const stop = sub === "success" ? "completed" : sub === "error_max_turns" ? "max_turns" : sub === "error_max_budget_usd" ? "budget" : "error";
    this.emit({
      type: "turn.end",
      stop: this.interrupting ? "interrupted" : stop,
      ...(m.stop_reason ? { backendStop: String(m.stop_reason) } : {}),
      durationMs: typeof m.duration_ms === "number" ? m.duration_ms : this.turnStartedAt ? Date.now() - this.turnStartedAt : 0,
    });
    this.interrupting = false;
  }

  private interrupting = false;

  async send(msg: UserMessage): Promise<void> {
    this.turnStartedAt = Date.now();
    const content: Array<Record<string, unknown>> = [];
    for (const img of msg.images ?? []) content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
    content.push({ type: "text", text: msg.text });
    this.input.push({ type: "user", message: { role: "user", content }, parent_tool_use_id: null } as unknown as SDKUserMessage);
  }

  async interrupt(): Promise<void> {
    this.interrupting = true;
    await this.q.interrupt();
  }

  async setMode(mode: Mode): Promise<void> {
    await this.q.setPermissionMode(toSdkMode(mode)!);
  }

  async setModel(model?: string, _effort?: Effort): Promise<void> {
    await this.q.setModel(model);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.input.close();
    this.q.close();
  }
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === "object" && c && "text" in c ? String((c as { text: unknown }).text) : "")).join("\n");
  return "";
}
