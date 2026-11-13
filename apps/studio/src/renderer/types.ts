export type DiffApplyParams = {
  session_id: string;
  path: string;
  after: string;
};

export type DiffRejectParams = {
  session_id: string;
  path: string;
};

/** Copy of `packages/protocol` PermissionRisk (docs/security/permissions.md). */
export type RiskTier = "auto" | "logged" | "ask" | "block";
export type PermissionRisk = {
  tier: RiskTier;
  reasons: { code: string; title: string; detail: string }[];
  /** What "remember" stores, e.g. `npm install *`; absent = cannot be remembered. */
  pattern?: string;
};

export type SessionEvent =
  | { type: "token"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_start"; call_id: string; name: string; input: unknown }
  | { type: "tool_end"; call_id: string; name: string; ok: boolean; output: string }
  | { type: "permission"; request_id: string; name: string; input: unknown; reason: string; risk?: PermissionRisk }
  | { type: "plan"; markdown: string }
  | { type: "mode_suggestion"; mode: "agent" | "plan" | "ask" | "debug" | "review" | "multitask"; reason: string }
  /** `applied`: already written (Balanced) — UI offers Undo instead of Apply/Reject. */
  | { type: "diff"; path: string; before: string; after: string; applied?: boolean }
  | { type: "trace"; event: string; detail: unknown }
  /** `slot` on Auto (`frontier|strong|small`); `escalated` when Auto moved up on trouble. */
  | { type: "route"; task_class: string; model_id: string; reason: string; slot?: string; escalated?: boolean }
  /** `baseline_usd`: same tokens on the source's strongest model ("all Opus"). */
  | { type: "cost"; input_tokens: number; output_tokens: number; usd: number; slot?: string; baseline_usd?: number }
  | { type: "terminal"; data: string }
  | { type: "done"; stop: string }
  | { type: "error"; message: string; error?: ErrorInfo };

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


/** Copy of `ContextUsage` in packages/protocol — result of `session.context`. */
export type ContextUsage = {
  used: number;
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

export type ModelInfo = {
  id: string;
  label?: string;
  api_model?: string;
  tier: string;
  context_window: number;
  tools: boolean;
  vision: boolean;
  /** Effort levels the model accepts; empty = no effort control. */
  efforts?: string[];
  /** Level marked "Recommended". */
  default_effort?: string;
  /** Provider id the picker groups by. */
  provider?: string;
  provider_label?: string;
  provider_kind?: "openai_compat" | "claude_api" | "claude_cli";
  available?: boolean;
  unavailable_reason?: string;
  /** Hidden from the picker until switched on in Settings. */
  opt_in?: boolean;
};

/** Copy of `CliInfo` in packages/protocol — result of `providers.cli_info`. */
export type CliInfo = {
  provider: string;
  installed: boolean;
  program: string;
  version: string;
  account: {
    logged_in: boolean;
    email: string;
    org_name: string;
    plan: string;
    auth_method: string;
    api_provider: string;
    login_expires_at: string;
    config_dir: string;
  } | null;
  usage: { turns_today: number; usd_today: number; turns_total: number; usd_total: number };
  safeguards: [string, string][];
  models: [string, string][];
};

/** Row of `providers.status`. Keys are never returned, only `has_key`. */
/** Copy of `McpServerView` in packages/protocol (Studio does not import it yet). */
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

export type ProviderStatus = {
  id: string;
  label: string;
  kind: "openai_compat" | "claude_api" | "claude_cli";
  has_key: boolean;
  needs_key: boolean;
  cli_version?: string;
  available: boolean;
  unavailable_reason: string;
};
