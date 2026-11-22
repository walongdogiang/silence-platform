// Backend interface (docs/adapters/protocol.md). An adapter drives one AI coding app
// (Claude Code via the Agent SDK first). The core decides every tool call; adapters never allow on their own.

export type Mode = "agent" | "plan" | "ask";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface Capabilities {
  interrupt: boolean;
  resume: boolean;
  fork: boolean;
  setMode: boolean;
  setModel: boolean;
  partialText: boolean;
  cost: "exact" | "estimate" | "none";
  quotaEvents: boolean;
  decide: "callback" | "mcpOnly";
  images: boolean;
  /** Platforms where the backend can sandbox commands itself. */
  sandbox: Array<"windows" | "macos" | "linux">;
  /** Can list sessions created outside 5ilence (e.g. Claude desktop, terminal). */
  externalSessions: boolean;
}

export interface SandboxRequest {
  required: boolean;
  writable: string[];
  network: string[];
}

export interface StartOptions {
  /** Core session id (not the backend's). */
  sessionId: string;
  cwd: string;
  model?: string;
  effort?: Effort;
  mode: Mode;
  /** Personal profile appended to the backend's system prompt. */
  systemAppend?: string;
  /** Local plugin directories with the user's skills/subagents. */
  plugins?: string[];
  resume?: { backendSessionId: string; fork: boolean; atMessageId?: string };
  limits?: { maxTurns?: number; maxUsd?: number };
  sandbox?: SandboxRequest;
  /**
   * Load the repo's own config (CLAUDE.md, skills, settings hooks, MCP servers). Default true.
   * The core sets false when the user did not approve the repo config (docs/adapters/claude-sdk.md).
   */
  projectConfig?: boolean;
}

export type ToolKind = "read" | "search" | "write" | "edit" | "shell" | "fetch" | "mcp" | "agent" | "plan" | "internal" | "other";

export interface ToolCall {
  callId: string;
  kind: ToolKind;
  /** Neutral name for the Risk Engine: read, write, edit, shell, glob, grep, web_fetch, mcp__server__tool… */
  name: string;
  /** Arguments normalised for `name` (path, content, old/new, command, url…). */
  args: Record<string, unknown>;
  /** The backend's original call, for audit and `modify`. */
  raw: { tool: string; input: Record<string, unknown> };
  mcp?: { server: string; tool: string; readOnly: boolean };
  /** Set when the call runs inside a subagent. */
  parentCallId?: string;
  /** Not from the model: a check the core runs after a turn (`verify`) or a hook (`hook`). */
  origin?: "verify" | "hook";
  cwd: string;
}

export type Decision =
  | { action: "allow" }
  | { action: "deny"; reason: string; interrupt?: boolean }
  | { action: "modify"; input: Record<string, unknown> };

export interface UserMessage {
  text: string;
  images?: Array<{ mediaType: string; data: string }>;
}

export type StopReason = "completed" | "interrupted" | "max_turns" | "budget" | "quota" | "error";

export type BackendErrorCode =
  | "auth_required"
  | "quota_exhausted"
  | "rate_limited"
  | "overloaded"
  | "backend_crashed"
  | "backend_not_found"
  | "unsupported"
  | "internal";

export type BackendEvent =
  | { type: "ready"; backendSessionId: string; model: string; tools: string[]; backendVersion: string; auth: { source: string; account?: string } }
  | { type: "text.delta"; text: string }
  | { type: "thinking.delta"; text: string }
  | { type: "message"; role: "assistant" | "user"; content: unknown; messageId: string }
  | { type: "tool.start"; callId: string; name: string; args: Record<string, unknown> }
  | { type: "tool.end"; callId: string; ok: boolean; output: string; files?: string[]; untrusted: boolean }
  | { type: "usage"; inputTokens: number; outputTokens: number; cacheRead: number; cacheWrite: number; usd: number; usdKind: "exact" | "estimate" | "none"; model: string }
  | { type: "quota"; status: "ok" | "warning" | "exhausted"; resetsAt?: number; utilization?: number; window?: string }
  | { type: "compacted"; trigger: "auto" | "manual"; preTokens: number }
  | { type: "subagent"; callId: string; state: "start" | "end"; summary?: string }
  | { type: "turn.end"; stop: StopReason; backendStop?: string; durationMs: number }
  | { type: "error"; code: BackendErrorCode; message: string; retryable: boolean; retryAfterMs?: number };

export interface BackendHooks {
  /** Called before the backend runs a tool; the call is held until this resolves. Rejection means deny. */
  decide(call: ToolCall): Promise<Decision>;
  emit(event: BackendEvent): void;
}

export interface SessionHandle {
  send(msg: UserMessage): Promise<void>;
  interrupt(): Promise<void>;
  setMode?(mode: Mode): Promise<void>;
  setModel?(model?: string, effort?: Effort): Promise<void>;
  close(): Promise<void>;
}

export interface Backend {
  readonly info: { id: string; version: string; capabilities: Capabilities };
  start(opts: StartOptions, hooks: BackendHooks): Promise<SessionHandle>;
}
