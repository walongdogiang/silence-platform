use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: &str = "0.1.5";

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
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SessionMode {
    #[default]
    Agent,
    Plan,
    /// Read-only Q&A: read/search tools only, no edits, no plan submission.
    Ask,
    /// Agent tools + evidence-first debugging workflow, strong tier on Auto.
    Debug,
    /// Read-only code review of the working tree / named files, strong tier on Auto.
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum PermissionMode {
    #[default]
    Ask,
    Allowlist,
    Yolo,
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionDecision {
    pub session_id: String,
    pub request_id: String,
    pub allow: bool,
    #[serde(default)]
    pub remember: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovePlanParams {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    },
    Trace {
        event: String,
        detail: Value,
    },
    Route {
        task_class: String,
        model_id: String,
        reason: String,
    },
    Cost {
        input_tokens: u32,
        output_tokens: u32,
        usd: f64,
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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
