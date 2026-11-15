use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: &str = "0.1.16";

/// Schema version of one line in a session `events.jsonl`.
pub const EVENT_LOG_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcRequest {
    pub jsonrpc: String,
    pub id: Option<Value>,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcResponse {
    pub jsonrpc: String,
    pub id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcNotification {
    pub jsonrpc: String,
    pub method: String,
    pub params: Value,
}

impl RpcResponse {
    pub fn ok(id: Option<Value>, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn err(id: Option<Value>, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            id,
            result: None,
            error: Some(RpcError {
                code,
                message: message.into(),
                data: None,
            }),
        }
    }
}

impl RpcNotification {
    pub fn new(method: impl Into<String>, params: Value) -> Self {
        Self {
            jsonrpc: "2.0".into(),
            method: method.into(),
            params,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionCreateParams {
    pub workspace: String,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub mode: SessionMode,
    #[serde(default)]
    pub permission: PermissionMode,
    /// `auto` (default) = let the model pick; otherwise one of [`EFFORT_LEVELS`].
    #[serde(default)]
    pub effort: Option<String>,
    /// Answer style: `default` (or absent) adds nothing; see [`RESPONSE_STYLES`].
    #[serde(default)]
    pub style: Option<String>,
}

/// Answer styles the UI can pick (Settings → Chat). `default` = the plain system prompt.
pub const RESPONSE_STYLES: [&str; 3] = ["default", "concise", "explanatory"];

/// Effort levels the UI can pick, weakest first. `auto` (not listed) = send nothing.
pub const EFFORT_LEVELS: [&str; 5] = ["low", "medium", "high", "xhigh", "max"];

/// Params of `providers.set_credential` (Studio main process only). `key: ""` clears it.
#[derive(Clone, Serialize, Deserialize)]
pub struct SetCredentialParams {
    pub provider: String,
    pub key: String,
}

impl std::fmt::Debug for SetCredentialParams {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SetCredentialParams")
            .field("provider", &self.provider)
            .field("key", &"[REDACTED]")
            .finish()
    }
}

/// Result of `providers.cli_info`: what the local Claude CLI is and how 5ilence runs it.
/// Shown in Settings → Model sources. Local only; nothing here leaves the machine.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CliInfo {
    /// Provider id (`claude-cli`).
    pub provider: String,
    /// False when no `claude` executable answered `--version`.
    pub installed: bool,
    /// Executable 5ilence runs (`claude`, `claude.cmd`, or `SILENCE_CLAUDE_CLI`).
    pub program: String,
    pub version: String,
    /// `None` when installed but `claude auth status` failed or timed out.
    pub account: Option<CliAccount>,
    pub usage: CliUsage,
    /// Hardening 5ilence always applies: `(what it means, the flag)`.
    pub safeguards: Vec<(String, String)>,
    /// Catalog models of this source: `(label, CLI model id)`.
    pub models: Vec<(String, String)>,
}

/// From `claude auth status --json`.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct CliAccount {
    pub logged_in: bool,
    pub email: String,
    pub org_name: String,
    /// `pro`, `max`, `team`, … (`subscriptionType` / `planTier`); empty for API keys.
    pub plan: String,
    /// `claude.ai`, `api_key`, …
    pub auth_method: String,
    /// `firstParty`, `bedrock`, `vertex`, …
    pub api_provider: String,
    /// RFC 3339; empty when the login does not expire.
    pub login_expires_at: String,
    pub config_dir: String,
}

/// Cost the CLI reported (`total_cost_usd`) for turns 5ilence ran, from the audit log.
/// Subscription quota is not readable from the CLI, so it is not here.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct CliUsage {
    pub turns_today: u32,
    pub usd_today: f64,
    pub turns_total: u32,
    pub usd_total: f64,
}

/// Params of `providers.set_preferred`. `""` = catalog order.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetPreferredParams {
    pub provider: String,
}

/// Slot of the Auto model. Auto never reads the prompt: it picks a slot from the phase (mode)
/// and the purpose of the call, then escalates on trouble. Ordered weakest first.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash, Default)]
#[serde(rename_all = "lowercase")]
pub enum Slot {
    Small,
    #[default]
    Strong,
    Frontier,
}

impl Slot {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Small => "small",
            Self::Strong => "strong",
            Self::Frontier => "frontier",
        }
    }
}

/// Model ids the `custom` preset pins per slot. Empty = the `balanced` default for that slot.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct AutoSlots {
    #[serde(default)]
    pub frontier: String,
    #[serde(default)]
    pub strong: String,
    #[serde(default)]
    pub small: String,
}

/// Auto settings of one source (provider). Studio keeps one per source and sends it with
/// `auto.set_config`; the Engine keeps it in memory.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AutoConfig {
    /// `balanced` (default) | `economy` | `max` | `custom`.
    #[serde(default = "default_preset")]
    pub preset: String,
    /// Only read when `preset` is `custom`.
    #[serde(default)]
    pub slots: AutoSlots,
    /// Model ids Auto may use on this source. Empty = every non-opt-in model of the source.
    #[serde(default)]
    pub pool: Vec<String>,
    /// Spend cap per session in USD. `None` = no cap.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub budget_usd: Option<f64>,
    /// Slot of the main turn per mode (`plan`, `agent`, `ask`, `debug`, `review`, `multitask`).
    /// Missing mode = its default (Plan/Review → Frontier, the rest → Strong).
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub mode_slots: std::collections::BTreeMap<String, Slot>,
}

fn default_preset() -> String {
    "balanced".into()
}

impl Default for AutoConfig {
    fn default() -> Self {
        Self {
            preset: default_preset(),
            slots: AutoSlots::default(),
            pool: Vec::new(),
            budget_usd: None,
            mode_slots: Default::default(),
        }
    }
}

/// Params of `auto.set_config`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetAutoConfigParams {
    pub provider: String,
    pub config: AutoConfig,
}

/// Params of `session.set_effort`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetEffortParams {
    pub session_id: String,
    pub effort: String,
}

/// `session.set_style`: one of [`RESPONSE_STYLES`]; applies from the next turn.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetStyleParams {
    pub session_id: String,
    pub style: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SessionMode {
    #[default]
    Agent,
    Plan,
    /// Read-only Q&A: read/search tools only, no edits, no plan submission.
    Ask,
    /// Agent tools + evidence-first debugging workflow.
    Debug,
    /// Read-only code review of the working tree / named files.
    Review,
    /// Agent that splits work into independent sub-tasks and delegates them to sub-agents.
    Multitask,
}

impl SessionMode {
    /// Modes that must never mutate the workspace.
    pub fn read_only(self) -> bool {
        matches!(self, SessionMode::Plan | SessionMode::Ask | SessionMode::Review)
    }
}

/// How the Engine gates tool calls by risk tier (docs/security/permissions.md).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum PermissionMode {
    /// Thận trọng: only read-only (tier 0) runs without asking.
    Ask,
    /// Legacy: never prompts; runs only what the allowlist covers (plus tier 0).
    Allowlist,
    /// In-process evals only; refused over RPC. Tier 3 is still blocked.
    Yolo,
    /// Cân bằng (default): tiers 0–1 run (visible + audited), tier 2 asks, tier 3 blocked.
    #[default]
    Balanced,
    /// Tự chủ: like Balanced; tier 2 runs only inside a network sandbox (not available yet → asks).
    Autonomous,
}

/// Why a permission is asked: risk tier and reason codes from the Risk Engine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PermissionRisk {
    /// `auto` | `logged` | `ask` | `block`
    pub tier: String,
    pub reasons: Vec<RiskReason>,
    /// What "remember" would store, e.g. `npm install *`. `None` = cannot be remembered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    /// Hosts of a network command that are not allowlisted yet (the card offers to allow them).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hosts: Vec<String>,
    /// Set when this card is an escalation (repeated blocks), not a normal permission.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub escalation: Option<Escalation>,
}

/// Escalation card: the agent was blocked `count` times in a row this turn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Escalation {
    pub count: u32,
    /// Only "Dừng" is offered (the blocked action may never run).
    pub stop_only: bool,
    /// What got in the way: reason titles, hosts or paths, as the Engine saw them.
    pub blocked: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RiskReason {
    pub code: String,
    pub title: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionCreateResult {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptParams {
    pub session_id: String,
    pub text: String,
    /// Extra context the user's UI attached (e.g. tail of the Output panel in Debug mode).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    /// Images pasted into the composer, as `data:image/<png|jpeg|gif|webp>;base64,...` URLs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionDecision {
    pub session_id: String,
    pub request_id: String,
    pub allow: bool,
    /// Legacy flag: `true` = `scope: workspace`. Ignored when `scope` is present.
    #[serde(default)]
    pub remember: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<PermissionScope>,
}

/// How long an approval lasts. A deny never persists.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum PermissionScope {
    /// This call only.
    #[default]
    Once,
    /// Until the session ends; held in memory, never written to disk.
    Session,
    /// Saved to `.silence/permissions.json` for the workspace.
    Workspace,
}

impl PermissionDecision {
    pub fn effective_scope(&self) -> PermissionScope {
        match self.scope {
            Some(s) => s,
            None if self.remember => PermissionScope::Workspace,
            None => PermissionScope::Once,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetPermissionParams {
    pub session_id: String,
    pub permission: PermissionMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovePlanParams {
    pub session_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionEvent {
    Token {
        text: String,
    },
    /// Đoạn suy nghĩ / reasoning stream từ model (hiển thị Thought).
    Thinking {
        text: String,
    },
    ToolStart {
        call_id: String,
        name: String,
        input: Value,
    },
    ToolEnd {
        call_id: String,
        name: String,
        ok: bool,
        output: String,
    },
    Permission {
        request_id: String,
        name: String,
        input: Value,
        reason: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        risk: Option<PermissionRisk>,
    },
    Plan {
        markdown: String,
    },
    /// Read-only mode (Ask/Review) where the user wants a change: the model asks the UI to
    /// offer a one-click switch. The Engine never switches modes itself.
    ModeSuggestion {
        mode: SessionMode,
        reason: String,
    },
    Diff {
        path: String,
        before: String,
        after: String,
        /// Already written to disk (Balanced/Autonomous): the UI offers Undo, not Apply/Reject.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        applied: bool,
    },
    Trace {
        event: String,
        detail: Value,
    },
    Route {
        /// Purpose of the call (`agent`, `plan`, `title`, `subagent:explore`, `cli`, …).
        task_class: String,
        model_id: String,
        reason: String,
        /// Auto slot (`frontier|strong|small`); empty for an explicit model pick.
        #[serde(default, skip_serializing_if = "String::is_empty")]
        slot: String,
        /// Auto moved up (effort or slot) because the turn ran into trouble.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        escalated: bool,
    },
    Cost {
        input_tokens: u32,
        output_tokens: u32,
        usd: f64,
        /// Auto slot that spent it; empty for an explicit model pick.
        #[serde(default, skip_serializing_if = "String::is_empty")]
        slot: String,
        /// Same tokens priced on the source's strongest model (the "all Opus" baseline).
        #[serde(default)]
        baseline_usd: f64,
    },
    Terminal {
        data: String,
    },
    Done {
        stop: String,
    },
    Error {
        message: String,
        /// Lỗi có cấu trúc (mã nội bộ). Không có → UI dùng thông báo chung.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<ErrorInfo>,
    },
}

/// One line of `sessions/<session_id>/events.jsonl` (append-only, one writer: the Engine).
/// `seq` starts at 1 and grows by 1 per session; `ts` is RFC3339 UTC with milliseconds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LogRecord {
    pub v: u32,
    pub seq: u64,
    pub ts: String,
    pub session_id: String,
    #[serde(flatten)]
    pub body: LogBody,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum LogBody {
    SessionStart {
        workspace: String,
        mode: SessionMode,
        model: String,
        permission: PermissionMode,
    },
    ModeChanged {
        mode: SessionMode,
    },
    ModelChanged {
        model: String,
    },
    /// Appended to the model-visible history (system, user, assistant, tool). Secrets redacted.
    Message {
        message: Value,
    },
    /// The last history message was dropped (a failed first call rolls the user message back).
    MessagePopped {},
    /// History rewritten wholesale (compaction). Replaces everything before it.
    MessagesReplaced {
        messages: Vec<Value>,
    },
    /// UI-visible event. `token`, `thinking`, `terminal` and `diff` are not persisted.
    Event {
        event: SessionEvent,
    },
}

/// Row of `session.list`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionSummary {
    pub session_id: String,
    pub workspace: String,
    pub mode: SessionMode,
    pub model: String,
    /// First user message, trimmed to 80 characters. Empty until the user speaks.
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    /// Number of user messages.
    pub turns: u32,
}

/// Params of `session.prune`: delete session logs whose last event is older than
/// `older_than_days` (≥ 1). `keep` = ids never deleted (pinned chats). Result: `{deleted}`.
/// `auth.hello`: must be the first request on every connection. `token` is the value the
/// Engine got from `SILENCE_RPC_TOKEN` (Studio sets it when spawning). Wrong or missing →
/// error `-32001` and the connection is closed. Result: `{ok, protocol}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthHelloParams {
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionPruneParams {
    pub older_than_days: u32,
    #[serde(default)]
    pub keep: Vec<String>,
}

/// Params of `session.delete`. The audit log is kept. Result: `{deleted}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionDeleteParams {
    pub session_ids: Vec<String>,
}

/// Params of `session.resume`. Result: [`SessionResumeResult`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionResumeParams {
    pub session_id: String,
}

/// Params of `session.rewind` (protocol 0.1.16): drop a user message and everything after it
/// from a live session's history (memory + log). `keep_user_turns` = user messages kept before
/// it; `text` = the dropped message as written, to find it if the counts drifted.
/// Workspace files are not touched. Result: [`SessionRewindResult`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRewindParams {
    pub session_id: String,
    pub keep_user_turns: u32,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRewindResult {
    /// History messages removed (user, assistant, tool).
    pub dropped: u32,
}

/// Params of `session.fork` (protocol 0.1.16): new live session with the source's history, cut
/// like `session.rewind` (`keep_user_turns` absent = whole history). The source is unchanged.
/// Result: `{session_id}`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionForkParams {
    pub session_id: String,
    #[serde(default)]
    pub keep_user_turns: Option<u32>,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionResumeResult {
    pub summary: SessionSummary,
    pub permission: PermissionMode,
    /// Log without `messages_replaced` snapshots, in order. Pending permission requests and
    /// staged diffs are not restored.
    pub records: Vec<LogRecord>,
}

/// Lỗi lượt đã chuẩn hóa. `code`: PROVIDER_CREDITS | PROVIDER_AUTH | PROVIDER_RATE |
/// PROVIDER_UNAVAILABLE | NETWORK | TIMEOUT | UNKNOWN. `detail` đã lọc secret + cắt ngắn.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ErrorInfo {
    pub code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    pub retryable: bool,
    #[serde(default)]
    pub detail: String,
}

/// Params of `chat.title`: first user message + first assistant reply. Result: `{ "title": String }`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatTitleParams {
    /// Only for the audit log; may be empty.
    #[serde(default)]
    pub session_id: String,
    pub user_text: String,
    #[serde(default)]
    pub reply_text: String,
}

/// Result of `session.context` (`{ session_id, mode?, model? }`): what the next request of the
/// session sends. `mode` / `model` preview the UI's pick before it is synced to the session.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ContextUsage {
    /// Tokens in context. Measured from the provider when `measured`, otherwise estimated.
    pub used: u32,
    /// `context_window` of the model the next turn uses.
    pub window: u32,
    pub model: String,
    pub measured: bool,
    pub parts: ContextParts,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ContextParts {
    pub system: u32,
    pub rules: u32,
    pub tools: u32,
    pub mcp_tools: u32,
    pub summarized: u32,
    pub conversation: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FsReadParams {
    pub workspace: String,
    pub path: String,
}

/// Result of `fs.read_image` (params: `FsReadParams`): an image file inside the workspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FsReadImageResult {
    /// Workspace-relative path with `/`.
    pub path: String,
    pub mime: String,
    pub bytes: u64,
    /// `data:<mime>;base64,...`
    pub data_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FsTreeParams {
    pub workspace: String,
    #[serde(default)]
    pub max_entries: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffApplyParams {
    pub session_id: String,
    pub path: String,
    pub after: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffRejectParams {
    pub session_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Vec<(String, String)>,
    #[serde(default)]
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditQuery {
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalStartParams {
    pub session_id: String,
    #[serde(default)]
    pub cols: Option<u16>,
    #[serde(default)]
    pub rows: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalWriteParams {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskClass {
    Chat,
    Explore,
    Edit,
    Debug,
    Architect,
}

impl TaskClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Explore => "explore",
            Self::Edit => "edit",
            Self::Debug => "debug",
            Self::Architect => "architect",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelInfo {
    pub id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub api_model: String,
    pub tier: String,
    pub context_window: u32,
    pub tools: bool,
    pub vision: bool,
    /// Effort levels this model accepts (subset of [`EFFORT_LEVELS`]); empty = no effort control.
    #[serde(default)]
    pub efforts: Vec<String>,
    /// Level the UI marks "Recommended"; empty when `efforts` is empty.
    #[serde(default)]
    pub default_effort: String,
    /// Provider id (`company-gateway`, `claude-api`, `claude-cli`, …) the picker groups by.
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub provider_label: String,
    /// `openai_compat` | `claude_api` | `claude_cli`.
    #[serde(default)]
    pub provider_kind: String,
    /// False when the source cannot run now (no key, CLI missing); see `unavailable_reason`.
    #[serde(default = "default_true")]
    pub available: bool,
    #[serde(default)]
    pub unavailable_reason: String,
    /// Hidden from the picker until switched on in Settings (costly models, e.g. Fable).
    #[serde(default)]
    pub opt_in: bool,
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn new_settings_params_default_cleanly() {
        let p: SessionCreateParams = serde_json::from_value(json!({"workspace": "w"})).unwrap();
        assert!(p.style.is_none());
        let p: SessionCreateParams = serde_json::from_value(json!({"workspace": "w", "style": "concise"})).unwrap();
        assert_eq!(p.style.as_deref(), Some("concise"));
        let p: SessionPruneParams = serde_json::from_value(json!({"older_than_days": 30})).unwrap();
        assert!(p.keep.is_empty());
    }

    #[test]
    fn error_event_without_info_is_backward_compatible() {
        let ev: SessionEvent = serde_json::from_value(json!({"type":"error","message":"x"})).unwrap();
        let back = serde_json::to_value(&ev).unwrap();
        assert_eq!(back, json!({"type":"error","message":"x"}));
    }

    #[test]
    fn error_event_with_info_roundtrip() {
        let ev = SessionEvent::Error {
            message: "turn failed: PROVIDER_CREDITS".into(),
            error: Some(ErrorInfo {
                code: "PROVIDER_CREDITS".into(),
                status: Some(402),
                retryable: false,
                detail: "Insufficient credits".into(),
            }),
        };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["type"], "error");
        assert_eq!(v["error"]["code"], "PROVIDER_CREDITS");
        assert_eq!(v["error"]["status"], 402);
        assert_eq!(v["error"]["retryable"], false);
    }
}
