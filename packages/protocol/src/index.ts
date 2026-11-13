export const PROTOCOL_VERSION = "0.1.13";

/** Schema version of one line in a session `events.jsonl`. */
export const EVENT_LOG_VERSION = 1;

export type DiffApplyParams = {
  session_id: string;
  path: string;
  after: string;
};

export type DiffRejectParams = {
  session_id: string;
  path: string;
};

export type SessionMode = "agent" | "plan" | "ask" | "debug" | "review" | "multitask";

/**
 * Params of `session.prompt`. `context`: extra text the UI attaches (e.g. Output tail in Debug).
 * `images`: pasted images as `data:image/<png|jpeg|gif|webp>;base64,...` URLs (max 4, 5 MB each).
 */
export type PromptParams = { session_id: string; text: string; context?: string; images?: string[] };
/** Params of `fs.read_image`: an image (png, jpg, gif, webp, svg; max 5 MB) inside `workspace`. */
export type FsReadImageParams = { workspace: string; path: string };
/** Result of `fs.read_image`. `data_url` = `data:<mime>;base64,...`. */
export type FsReadImageResult = { path: string; mime: string; bytes: number; data_url: string };
/** Params of `chat.title`: first user message + first assistant reply. Result: `ChatTitleResult`. */
export type ChatTitleParams = { session_id?: string; user_text: string; reply_text?: string };
export type ChatTitleResult = { title: string };
/** Params of `session.context`. `mode` / `model` preview the UI's pick before it is synced to the session. */
export type SessionContextParams = { session_id: string; mode?: SessionMode; model?: string };
/** Result of `session.context`: what the next request of the session sends. */
export type ContextUsage = {
  /** Measured from the provider when `measured`, otherwise estimated (chars/4). */
  used: number;
  /** `context_window` of the model the next turn uses. */
  window: number;
  model: string;
  measured: boolean;
  parts: {
    system: number;
    rules: number;
    tools: number;
    mcp_tools: number;
    summarized: number;
    conversation: number;
  };
};
/** Answer style appended to the system prompt; `default` (or absent) adds nothing. */
export type ResponseStyle = "default" | "concise" | "explanatory";
/** Params of `session.create`. */
export type SessionCreateParams = {
  workspace: string;
  model?: string;
  mode?: SessionMode;
  permission?: PermissionMode;
  /** `auto` (default) or one of low | medium | high | xhigh | max. */
  effort?: string;
  style?: ResponseStyle;
};
/** Params of `session.prune`: delete chats whose last event is older than `older_than_days`. `keep` = ids never deleted (pinned). */
export type SessionPruneParams = { older_than_days: number; keep?: string[] };
/** Params of `session.delete`. Audit log is kept. */
export type SessionDeleteParams = { session_ids: string[] };
export type SessionPruneResult = { deleted: string[] };

/** One MCP server in `.silence/mcp.json`. `env` values may use `${VAR}` (read from the Engine's environment). */
export type McpServerConfig = {
  name: string;
  command: string;
  args?: string[];
  env?: [string, string][];
  enabled?: boolean;
};
/**
 * A server as `mcp.list` shows it. Env values never leave the Engine (`env_keys` only).
 * `needs_approval`: from the workspace file, not yet allowed on this machine.
 */
export type McpServerView = {
  name: string;
  command: string;
  args: string[];
  env_keys: string[];
  enabled: boolean;
  approved: boolean;
  status: "running" | "error" | "off" | "needs_approval" | "stopped";
  error: string | null;
  tools: { name: string; description: string; read_only: boolean }[];
};
/** `mcp.list {workspace}` → `{servers}`; `mcp.add {workspace, server}` / `mcp.set_enabled {workspace, name, enabled}` → `{server}`; `mcp.remove {workspace, name}`. */
export type McpListResult = { servers: McpServerView[] };

/** `balanced` is the default; `yolo` is refused over RPC (evals only). docs/security/permissions.md */
export type PermissionMode = "ask" | "allowlist" | "yolo" | "balanced" | "autonomous";

/** `session.permission` decision. `session` = until the session ends (memory only); `workspace` = saved. */
export type PermissionScope = "once" | "session" | "workspace";
export type PermissionDecision = {
  session_id: string;
  request_id: string;
  allow: boolean;
  /** Legacy: `true` = `scope: "workspace"`. */
  remember?: boolean;
  scope?: PermissionScope;
};
/** `session.set_permission` — `yolo` is rejected. */
export type SetPermissionParams = { session_id: string; permission: PermissionMode };

export type RiskTier = "auto" | "logged" | "ask" | "block";
export type RiskReason = { code: string; title: string; detail: string };
/** Why the Engine asks: tier + reason codes; `pattern` is what "remember" stores (e.g. `npm install *`). */
export type PermissionRisk = { tier: RiskTier; reasons: RiskReason[]; pattern?: string };

export type RpcRequest = {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
};

export type RpcResponse = {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string };
};

export type SessionEvent =
  | { type: "token"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_start"; call_id: string; name: string; input: unknown }
  | { type: "tool_end"; call_id: string; name: string; ok: boolean; output: string }
  | { type: "permission"; request_id: string; name: string; input: unknown; reason: string; risk?: PermissionRisk }
  | { type: "plan"; markdown: string }
  | { type: "mode_suggestion"; mode: SessionMode; reason: string }
  /** `applied`: already written (Balanced/Autonomous) — UI offers Undo instead of Apply/Reject. */
  | { type: "diff"; path: string; before: string; after: string; applied?: boolean }
  | { type: "trace"; event: string; detail: unknown }
  /** `slot` is set on Auto (`frontier|strong|small`); `escalated` when Auto moved up on trouble. */
  | { type: "route"; task_class: string; model_id: string; reason: string; slot?: AutoSlot | ""; escalated?: boolean }
  /** `baseline_usd`: same tokens on the source's strongest model ("all Opus"). */
  | { type: "cost"; input_tokens: number; output_tokens: number; usd: number; slot?: AutoSlot | ""; baseline_usd?: number }
  | { type: "terminal"; data: string }
  | { type: "done"; stop: string }
  | { type: "error"; message: string; error?: ErrorInfo };

/** One line of `sessions/<session_id>/events.jsonl` (append-only, written by the Engine). */
export type LogRecord = {
  v: number;
  seq: number;
  ts: string;
  session_id: string;
} & LogBody;

export type LogBody =
  | { type: "session_start"; workspace: string; mode: SessionMode; model: string; permission: PermissionMode }
  | { type: "mode_changed"; mode: SessionMode }
  | { type: "model_changed"; model: string }
  | { type: "message"; message: unknown }
  | { type: "message_popped" }
  | { type: "messages_replaced"; messages: unknown[] }
  /** `token`, `thinking`, `terminal` and `diff` events are not persisted. */
  | { type: "event"; event: SessionEvent };

/** Row of `session.list` (`{ sessions: SessionSummary[] }`). */
export type SessionSummary = {
  session_id: string;
  workspace: string;
  mode: SessionMode;
  model: string;
  title: string;
  created_at: string;
  updated_at: string;
  turns: number;
};

export type SessionResumeParams = { session_id: string };

/** `records` omit `messages_replaced`. Pending permissions and staged diffs are not restored. */
export type SessionResumeResult = {
  summary: SessionSummary;
  permission: PermissionMode;
  records: LogRecord[];
};

export type ErrorCode =
  | "PROVIDER_CREDITS"
  | "PROVIDER_AUTH"
  | "PROVIDER_RATE"
  | "PROVIDER_UNAVAILABLE"
  | "NETWORK"
  | "TIMEOUT"
  | "PROVIDER_REFUSAL"
  | "CLI_NOT_FOUND"
  | "CLI_AUTH"
  | "UNKNOWN";

/** Lỗi lượt đã chuẩn hóa ở Engine. `detail` đã lọc secret + cắt ngắn. */
export type ErrorInfo = {
  code: ErrorCode | string;
  status?: number;
  retryable: boolean;
  detail: string;
};


/** Effort levels, weakest first. `auto` = send nothing (model default). */
export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";
export type Effort = "auto" | EffortLevel;
/** `session.create` also takes `effort?: Effort`. */
export type SetEffortParams = { session_id: string; effort: Effort };
/** `session.set_style`: applies from the next turn. */
export type SetStyleParams = { session_id: string; style: ResponseStyle };

export type ModelInfo = {
  id: string;
  label?: string;
  api_model?: string;
  tier: string;
  context_window: number;
  tools: boolean;
  vision: boolean;
  /** Levels this model accepts; empty = no effort control. */
  efforts?: EffortLevel[];
  /** Level marked "Recommended"; "" when `efforts` is empty. */
  default_effort?: EffortLevel | "";
  /** Provider id the picker groups by (`company-gateway`, `claude-api`, `claude-cli`). */
  provider?: string;
  provider_label?: string;
  provider_kind?: ProviderKind;
  /** False when the source cannot run now (no key, CLI missing). */
  available?: boolean;
  unavailable_reason?: string;
  /** Hidden from the picker until switched on in Settings (costly models, e.g. Fable). */
  opt_in?: boolean;
};

export type ProviderKind = "openai_compat" | "claude_api" | "claude_cli";
/** Row of `providers.status` (`{ providers: ProviderStatus[], preferred: string }`). */
export type ProviderStatus = {
  id: string;
  label: string;
  kind: ProviderKind;
  /** Keyed providers: a key is set (env or Settings). The key itself is never returned. */
  has_key: boolean;
  /** Needs a key at all (`api_key_env` set). */
  needs_key: boolean;
  /** CLI providers: `claude --version` output; "" when not found. */
  cli_version?: string;
  available: boolean;
  unavailable_reason: string;
};
/** Result of `providers.cli_info` (Settings → Model sources → Claude CLI). Local only. */
export type CliInfo = {
  provider: string;
  installed: boolean;
  program: string;
  version: string;
  /** null when `claude auth status` failed or timed out. */
  account: CliAccount | null;
  usage: CliUsage;
  /** `[meaning, flag]` pairs 5ilence always applies. */
  safeguards: [string, string][];
  /** `[label, CLI model id]`. */
  models: [string, string][];
};
export type CliAccount = {
  logged_in: boolean;
  email: string;
  org_name: string;
  plan: string;
  auth_method: string;
  api_provider: string;
  login_expires_at: string;
  config_dir: string;
};
/** CLI-reported cost of 5ilence's CLI turns (audit log). Subscription quota is not readable. */
export type CliUsage = { turns_today: number; usd_today: number; turns_total: number; usd_total: number };
/** `providers.set_credential` — sent by the main process only, never by the renderer. */
export type SetCredentialParams = { provider: string; key: string };
/** Auto slot, weakest first. Auto picks it from the mode and the purpose of the call. */
export type AutoSlot = "small" | "strong" | "frontier";
export type AutoPreset = "balanced" | "economy" | "max" | "custom";
/** Auto settings of one source. `slots` is read only for `custom`; empty id = balanced default. */
export type AutoConfig = {
  preset: AutoPreset;
  slots?: { frontier?: string; strong?: string; small?: string };
  /** Model ids Auto may use; empty = every non-opt-in model of the source. */
  pool?: string[];
  /** Spend cap per session (USD). */
  budget_usd?: number;
  /** Main-turn slot per mode; missing = default (Plan/Review → frontier, the rest → strong). */
  mode_slots?: Partial<Record<SessionMode, AutoSlot>>;
};
/** `auto.set_config`. */
export type SetAutoConfigParams = { provider: string; config: AutoConfig };
/** `session.carry_spend {session_id, usd}` raises the session's spend to the chat's (never lowers it).
 * `session.budget_continue {session_id}` lets the next turn run past the Auto spend cap once.
 * `session.spend {session_id}` returns this. A turn stopped by the cap ends with `done{stop:"budget"}`. */
export type SessionSpendResult = { spent_usd: number; budget_usd: number | null };
/** `session.set_model` — `source`: provider Auto routes within (needed for the Claude CLI). */
export type SetModelParams = { session_id: string; model: string; source?: string };
/** `providers.set_preferred` — `""` = catalog order. CLI providers are refused. */
export type SetPreferredParams = { provider: string };
