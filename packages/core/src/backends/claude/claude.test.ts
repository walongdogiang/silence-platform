// Adapter tests with a scripted fake `query` (record/replay): no model call, no quota.
import { describe, expect, it } from "vitest";
import type { Options, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { BackendEvent, Decision, ToolCall } from "../types.js";
import { ClaudeBackend, type QueryFn } from "./index.js";
import { AUTH_VARS, claudeEnv } from "./env.js";
import { toToolCall } from "./toolMap.js";

type Script = (ctx: { options: Options; input: AsyncIterator<SDKUserMessage>; hook: (name: string, input: Record<string, unknown>, id: string) => Promise<unknown> }) => AsyncGenerator<Record<string, unknown>>;

function fakeQuery(script: Script) {
  const calls = { interrupt: 0, close: 0, modes: [] as string[] };
  let seenOptions: Options | undefined;
  const fn: QueryFn = ({ prompt, options }) => {
    seenOptions = options;
    const matcher = options.hooks!.PreToolUse![0]!;
    const hook = (tool_name: string, tool_input: Record<string, unknown>, tool_use_id: string) =>
      matcher.hooks[0]!({ hook_event_name: "PreToolUse", tool_name, tool_input, tool_use_id, session_id: "s", transcript_path: "", cwd: "" } as never, tool_use_id, { signal: new AbortController().signal });
    const gen = script({ options, input: prompt[Symbol.asyncIterator](), hook });
    return Object.assign(gen, {
      interrupt: async () => void calls.interrupt++,
      close: () => void calls.close++,
      setPermissionMode: async (m: string) => void calls.modes.push(m),
      setModel: async () => {},
    }) as unknown as Query;
  };
  return { fn, calls, options: () => seenOptions! };
}

async function run(script: Script, decide: (c: ToolCall) => Promise<Decision>, env: NodeJS.ProcessEnv = {}) {
  const fq = fakeQuery(script);
  const events: BackendEvent[] = [];
  const done = new Promise<void>((resolve) => {
    void new ClaudeBackend({ queryFn: fq.fn, env })
      .start({ sessionId: "core-1", cwd: "D:/ws", mode: "agent", systemAppend: "PROFILE", plugins: ["C:/p"] }, { decide, emit: (e) => { events.push(e); if (e.type === "turn.end") resolve(); } })
      .then((h) => h.send({ text: "hi" }));
  });
  await done;
  return { events, ...fq };
}

const init = { type: "system", subtype: "init", session_id: "b-1", model: "claude-haiku-5-5", tools: ["Bash"], claude_code_version: "2.1.327", apiKeySource: "none" };
const result = { type: "result", subtype: "success", usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 40000 }, total_cost_usd: 0.009, duration_ms: 1234, stop_reason: "end_turn" };

describe("ClaudeBackend options", () => {
  it("locks down permissions, env, tools and loads the profile and plugin", async () => {
    const { options } = await run(async function* ({ input }) {
      await input.next();
      yield init;
      yield result;
    }, async () => ({ action: "allow" }), { PATH: "/bin", ANTHROPIC_API_KEY: "sk-x", SOME_HOST_VAR: "1" });
    const o = options();
    expect(o.settingSources).toEqual(["project"]);
    expect(o.permissionMode).toBe("default");
    expect(o.env).toEqual({ PATH: "/bin" });
    expect(o.tools).toContain("Bash");
    expect(o.tools).not.toContain("CronCreate");
    expect(o.systemPrompt).toEqual({ type: "preset", preset: "claude_code", append: "PROFILE" });
    expect(o.plugins).toEqual([{ type: "local", path: "C:/p" }]);
    const m = o.hooks!.PreToolUse![0]!;
    expect(m.onFailure).toBe("block");
    expect(m.timeout).toBeGreaterThanOrEqual(600);
  });
});

describe("ClaudeBackend decisions", () => {
  it("asks the core in the hook, applies allow/modify/deny, and canUseTool reuses the decision", async () => {
    const seen: ToolCall[] = [];
    const decide = async (c: ToolCall): Promise<Decision> => {
      seen.push(c);
      if (c.name === "shell") return { action: "modify", input: { command: "echo safe" } };
      if (c.name === "write") return { action: "deny", reason: "no" };
      return { action: "allow" };
    };
    const outs: unknown[] = [];
    let reuse: unknown;
    const { events } = await run(async function* ({ input, hook, options }) {
      await input.next();
      yield init;
      outs.push(await hook("Bash", { command: "rm -rf /" }, "t1"));
      outs.push(await hook("Write", { file_path: "a.txt", content: "x" }, "t2"));
      outs.push(await hook("Read", { file_path: "a.txt" }, "t3"));
      reuse = await options.canUseTool!("Bash", { command: "rm -rf /" }, { signal: new AbortController().signal, toolUseID: "t1", requestId: "r" } as never);
      yield { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "safe" }] } };
      yield result;
    }, decide);
    expect(seen.map((c) => c.name)).toEqual(["shell", "write", "read"]);
    expect(outs[0]).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow", updatedInput: { command: "echo safe" } } });
    expect(outs[1]).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "no" } });
    expect(outs[2]).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    expect(reuse).toEqual({ behavior: "allow", updatedInput: { command: "echo safe" } });
    expect(seen).toHaveLength(3); // canUseTool did not ask again
    expect(events.filter((e) => e.type === "tool.start").map((e) => (e as { callId: string }).callId)).toEqual(["t1", "t3"]);
    expect(events.find((e) => e.type === "tool.end")).toMatchObject({ callId: "t1", ok: true, output: "safe", untrusted: false });
  });

  it("turns a failing decide into a deny, never an allow", async () => {
    const outs: unknown[] = [];
    await run(async function* ({ input, hook }) {
      await input.next();
      yield init;
      outs.push(await hook("Bash", { command: "ls" }, "t1"));
      yield result;
    }, async () => {
      throw new Error("core down");
    });
    expect(outs[0]).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    expect(JSON.stringify(outs[0])).toContain("harness unavailable");
  });
});

describe("ClaudeBackend events", () => {
  it("maps init, text, quota, usage and turn end", async () => {
    const { events } = await run(async function* ({ input }) {
      await input.next();
      yield init;
      yield { type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hel" } } };
      yield { type: "stream_event", parent_tool_use_id: "sub", event: { type: "content_block_delta", delta: { type: "text_delta", text: "hidden" } } };
      yield { type: "system", subtype: "thinking_tokens" };
      yield {
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed_warning", rateLimitType: "seven_day", unifiedWindows: { five_hour: { utilization: 0.24, resetsAt: 100, status: "allowed" }, seven_day: { utilization: 0.92, resetsAt: 200, status: "allowed_warning" } } },
      };
      yield result;
    }, async () => ({ action: "allow" }));
    expect(events[0]).toMatchObject({ type: "ready", backendSessionId: "b-1", auth: { source: "none" } });
    expect(events.filter((e) => e.type === "text.delta")).toEqual([{ type: "text.delta", text: "Hel" }]);
    expect(events.find((e) => e.type === "quota")).toEqual({ type: "quota", status: "warning", resetsAt: 200_000, utilization: 0.92, window: "seven_day" });
    expect(events.find((e) => e.type === "usage")).toMatchObject({ inputTokens: 5, outputTokens: 7, cacheRead: 100, cacheWrite: 40000, usd: 0.009, usdKind: "estimate" });
    expect(events.at(-1)).toEqual({ type: "turn.end", stop: "completed", backendStop: "end_turn", durationMs: 1234 });
  });

  it("refuses a session that is not on the subscription login", async () => {
    const { events, calls } = await run(async function* ({ input }) {
      await input.next();
      yield { ...init, apiKeySource: "ANTHROPIC_API_KEY" };
      yield result;
    }, async () => ({ action: "allow" }));
    expect(events.some((e) => e.type === "error" && e.code === "auth_required")).toBe(true);
    expect(calls.interrupt).toBe(1);
  });

  it("reports a crashed stream as an error and ends the turn", async () => {
    const { events } = await run(async function* ({ input }) {
      await input.next();
      yield init;
      throw new Error("process exited");
    }, async () => ({ action: "allow" }));
    expect(events.at(-2)).toMatchObject({ type: "error", code: "backend_crashed" });
    expect(events.at(-1)).toMatchObject({ type: "turn.end", stop: "error" });
  });
});

describe("helpers", () => {
  it("never passes credential variables", () => {
    const env = claudeEnv({ PATH: "x", ANTHROPIC_API_KEY: "k", CLAUDE_CODE_OAUTH_TOKEN: "t" }, { ANTHROPIC_BASE_URL: "http://evil" });
    expect(env).toEqual({ PATH: "x" });
    for (const k of AUTH_VARS) expect(env[k]).toBeUndefined();
  });

  it("maps Claude tools to neutral names", () => {
    const t = (toolName: string, input: Record<string, unknown>, agentId?: string) => toToolCall({ toolName, input, toolUseId: "id", cwd: "D:/ws", ...(agentId ? { agentId } : {}) });
    expect(t("PowerShell", { command: "Get-ChildItem" })).toMatchObject({ kind: "shell", name: "shell", args: { command: "Get-ChildItem" } });
    expect(t("Edit", { file_path: "a.ts", old_string: "x", new_string: "y" })).toMatchObject({ kind: "edit", name: "edit", args: { path: "a.ts", old: "x", new: "y" } });
    expect(t("Read", { file_path: ".env" }, "agent-1")).toMatchObject({ name: "read", args: { path: ".env" }, parentCallId: "agent-1" });
    expect(t("mcp__github__create_issue", { title: "x" })).toMatchObject({ kind: "mcp", name: "mcp__github__create_issue", mcp: { server: "github", tool: "create_issue" } });
    expect(t("CronCreate", {})).toMatchObject({ kind: "other", name: "CronCreate" });
  });
});
