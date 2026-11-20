// Claude Code tool call → neutral ToolCall for the Risk Engine (docs/adapters/claude-sdk.md,
// "Ánh xạ tool Claude → tên trung lập"). Names follow Claude Code 2.1.327 as seen in the spike.
import type { ToolCall, ToolKind } from "../types.js";

/** Tools the adapter passes in `options.tools`. Everything else (account tools, Cron, RemoteTrigger…) stays off. */
export const CLAUDE_TOOLS = [
  "Read",
  "Write",
  "Edit",
  "NotebookEdit",
  "Glob",
  "Grep",
  "Bash",
  "PowerShell",
  "WebSearch",
  "WebFetch",
  "Task",
  "Agent",
  "Skill",
  "TodoWrite",
  "ExitPlanMode",
] as const;

type Mapped = Pick<ToolCall, "kind" | "name" | "args">;

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

function pick(input: Record<string, unknown>, keys: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [from, to] of Object.entries(keys)) if (input[from] !== undefined) out[to] = input[from];
  return out;
}

const MAP: Record<string, (i: Record<string, unknown>) => Mapped> = {
  Read: (i) => ({ kind: "read", name: "read", args: pick(i, { file_path: "path", offset: "offset", limit: "limit" }) }),
  Glob: (i) => ({ kind: "search", name: "glob", args: pick(i, { path: "path", pattern: "pattern" }) }),
  Grep: (i) => ({ kind: "search", name: "grep", args: pick(i, { path: "path", pattern: "pattern", glob: "glob" }) }),
  Write: (i) => ({ kind: "write", name: "write", args: pick(i, { file_path: "path", content: "content" }) }),
  Edit: (i) => ({ kind: "edit", name: "edit", args: pick(i, { file_path: "path", old_string: "old", new_string: "new", replace_all: "replaceAll" }) }),
  MultiEdit: (i) => ({ kind: "edit", name: "edit", args: { ...pick(i, { file_path: "path" }), edits: i.edits } }),
  NotebookEdit: (i) => ({ kind: "edit", name: "edit", args: pick(i, { notebook_path: "path", new_source: "new" }) }),
  Bash: (i) => ({ kind: "shell", name: "shell", args: { command: str(i.command) ?? "" } }),
  PowerShell: (i) => ({ kind: "shell", name: "shell", args: { command: str(i.command) ?? "" } }),
  // Network reads have no rule of their own yet: they fall to UNKNOWN_TOOL (ask) and taint the turn.
  WebFetch: (i) => ({ kind: "fetch", name: "web_fetch", args: pick(i, { url: "url" }) }),
  WebSearch: (i) => ({ kind: "fetch", name: "web_search", args: pick(i, { query: "query" }) }),
  // A subagent's own tool calls go through the hook separately.
  Task: (i) => ({ kind: "agent", name: "task", args: pick(i, { description: "description", subagent_type: "agent" }) }),
  Agent: (i) => ({ kind: "agent", name: "task", args: pick(i, { description: "description", subagent_type: "agent" }) }),
  Skill: (i) => ({ kind: "internal", name: "skill", args: pick(i, { skill: "name" }) }),
  TodoWrite: () => ({ kind: "internal", name: "update_todos", args: {} }),
  ExitPlanMode: (i) => ({ kind: "plan", name: "submit_plan", args: pick(i, { plan: "markdown" }) }),
};

export interface RawCall {
  toolName: string;
  input: Record<string, unknown>;
  toolUseId: string;
  cwd: string;
  agentId?: string;
  mcpServer?: { name: string; source: string };
}

/** Map one Claude tool call; unknown tools become kind `other` with their own name (Risk Engine: ask). */
export function toToolCall(c: RawCall): ToolCall {
  const base = { callId: c.toolUseId, raw: { tool: c.toolName, input: c.input }, cwd: c.cwd, ...(c.agentId ? { parentCallId: c.agentId } : {}) };
  const m = c.toolName.match(/^mcp__(.+?)__(.+)$/);
  if (m) {
    return { ...base, kind: "mcp", name: c.toolName, args: c.input, mcp: { server: m[1]!, tool: m[2]!, readOnly: false } };
  }
  const f = MAP[c.toolName];
  if (f) return { ...base, ...f(c.input) };
  return { ...base, kind: "other" as ToolKind, name: c.toolName, args: c.input };
}

/** Output of these tools comes from outside the machine: the turn becomes tainted. */
export function isUntrustedOutput(toolName: string): boolean {
  return toolName === "WebFetch" || toolName === "WebSearch" || toolName.startsWith("mcp__");
}
