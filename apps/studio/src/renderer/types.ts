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
  /** Network hosts not allowlisted yet: the card offers to allow them. */
  hosts?: string[];
  /** Escalation card (repeated blocks); `stop_only` = only "Dừng" is offered. */
  escalation?: { count: number; stop_only: boolean; blocked: string[] };
  /** Below: TS core permission modes only (protocol 0.1.20). */
  level?: RiskLevel;
  codes?: string[];
  segments?: { text: string; level: RiskLevel; codes: string[] }[];
  impact?: { network: boolean; outside_workspace: boolean; deletes: boolean; admin: boolean; undoable: boolean };
  source?: "agent" | "subagent" | "verify" | "hook";
  tainted?: boolean;
  mode?: string;
  /** Rule "Always allow" saves; absent for red calls. */
  allow_rule?: string;
  deny_rule?: string;
  /** Bypass: seconds before the card refuses on its own. */
  countdown_s?: number;
};
/** Display level on the core's permission card: none, yellow, red, refused outright. */
export type RiskLevel = "safe" | "caution" | "danger" | "hard_block";
/** Answer on the core's permission card (`session.permission.decision`). */
export type PermAnswer = "allow_once" | "allow_always" | "deny" | "deny_always";

/** Copy of `packages/protocol` SandboxStatus / NetworkList (`sandbox.status`, `network.list`). */
export type SandboxStatus =
  | { state: "unsupported" | "not_installed" | "ready" }
  | { state: "degraded"; reason: string };
export type NetworkList = { defaults: string[]; allow: string[] };

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
  | { type: "cost"; input_tokens: number; output_tokens: number; usd: number; slot?: string; baseline_usd?: number; cache_read_tokens?: number; cache_write_tokens?: number }
  | { type: "terminal"; data: string }
  /** Background process (`proc_start`): started, new localhost URL, or ended. `status`: running | stopped | exited <code>. */
  | { type: "proc"; id: string; command: string; status: string; urls: string[] }
  /** Agent's headless browser: address, title, small JPEG frame, totals of console errors / failed requests. Empty `url` = closed. */
  | { type: "browser"; url: string; title: string; frame?: string; errors: number; failed: number }
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
  | "CLI_LIMIT"
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

/* ── Evals from Studio (`eval.*` RPC, `eval.progress` notifications) ── */
export type EvalStatus = "PASS" | "FAIL" | "ERROR" | "SKIP";
/** `eval.estimate` / `eval.start`. No permission field: eval sessions are created by the Engine. */
export type EvalConfig = {
  suite: string;
  tasks: string[];
  /** Provider id; omitted = each task's own model. */
  source?: string;
  /** Catalog id or `auto`; omitted = per task (pin / manifest). */
  model?: string;
  effort?: string;
  repeat: number;
  retry_failed: boolean;
  max_cost?: number;
  history: boolean;
};
export type EvalTaskInfo = {
  id: string;
  kind: string;
  mode: string;
  manifest_model?: string | null;
  pinned?: string | null;
  effort?: string | null;
  missing_env?: string | null;
  last?: { run_id: string; status: EvalStatus; model: string; cost_usd: number } | null;
};
/** `eval.catalog`. `sources` = rows of `providers.status`. */
export type EvalCatalog = {
  available: boolean;
  suites: { name: string; error?: string; tasks: EvalTaskInfo[] }[];
  sources: { id: string; label: string; kind: string; available: boolean; unavailable_reason: string }[];
  running: boolean;
};
/** `eval.config.get` / `eval.config.set`: file `evals/config.yaml` (`eval_config.rs`). */
export type EvalSettings = {
  /** Nguồn khi chạy trên máy: provider id, hoặc `per-task` (mỗi task theo model ghim). */
  source: string;
  profiles: {
    smoke: { max_cost: number };
    nightly: { max_cost: number };
    weekly: { v0_max_cost: number; modes_max_cost: number; auto_max_cost: number };
  };
  /** Lượt tự chạy trên GitHub Actions; `source` không được là Claude CLI. */
  ci: { enabled: boolean; source: string; nightly: boolean; weekly: boolean };
};
export type EvalSettingsInfo = {
  settings: EvalSettings;
  /** Mọi nguồn; `ready` = dùng được ngay trên máy này (có khoá / CLI đã cài và đăng nhập). */
  sources: { id: string; label: string; env: string; cli: boolean; ready: boolean; reason: string }[];
  path: string;
  exists: boolean;
  max_cap_usd: number;
};
export type EvalEstimate = {
  estimate: { tasks: { id: string; model: string; usd: number | null }[]; total_usd: number; unknown: number };
  skipped: { id: string; reason: string }[];
};
export type EvalTaskMetrics = {
  id: string;
  kind: string;
  status: EvalStatus;
  model: string;
  effort: string;
  attempts: number;
  passes: number;
  errors: number;
  flaky: boolean;
  duration_secs: number;
  cost_usd: number;
  model_calls: number;
  input_tokens: number;
  output_tokens: number;
  /** Part of input_tokens read from the prompt cache (0 = none or unknown). */
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  tool_calls: number;
  error?: string;
  error_code?: string;
  slots?: string[];
  escalated?: boolean;
};
export type EvalRunSummary = {
  run_id: string;
  suite: string;
  profile: string;
  started_at: string;
  stopped?: string | null;
  counts: { pass: number; fail: number; error: number; skip: number };
  total_cost_usd: number;
  tasks: EvalTaskMetrics[];
};
/** Row of `eval.runs` (`{ runs }`). */
export type EvalRun = EvalRunSummary & { failed: string[] };
export type EvalProgress =
  | { type: "started"; run_id: string; suite: string; tasks: string[] }
  | { type: "task_started"; id: string; model: string; attempt: number }
  | { type: "skipped"; id: string; model: string; reason: string }
  | { type: "task_done"; task: EvalTaskMetrics }
  | { type: "finished"; summary: EvalRunSummary }
  | { type: "failed"; message: string };
/** `eval.status`: every progress event of the current (or last) run, to replay after a reload. */
export type EvalLiveStatus = { running: boolean; events: EvalProgress[] };
/** `eval.task {suite, task_id, attempt?}`. */
export type EvalTaskDetail = {
  suite: string;
  task_id: string;
  attempt: number;
  attempts: number[];
  workspace: string;
  report: string;
  audit: string[];
  files: { path: string; status: "added" | "modified" | "deleted"; before: string; after: string; binary: boolean }[];
  /** `checks.json`: one row per `pass_if` check; null for attempts from before it existed. */
  checks?: EvalCheck[] | null;
  /** `trace.jsonl`: session events of the attempt (capped, redacted); empty for old attempts. */
  trace?: EvalTraceLine[];
};
/** One `pass_if` check of an attempt and why it failed. */
export type EvalCheck = { kind: string; target: string; ok: boolean; detail?: string };
/** One line of `trace.jsonl`: a `SessionEvent` (`type` tag) plus `t_ms`; tokens merged into `text`. */
export type EvalTraceLine = { type: string; t_ms: number; [field: string]: unknown };
