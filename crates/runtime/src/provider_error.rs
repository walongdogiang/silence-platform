//! Chuẩn hóa lỗi provider (HTTP / mạng) thành mã nội bộ để UI hiển thị thân thiện.
//! Không bao giờ đưa raw body ra ngoài: chỉ `detail` đã lọc secret và cắt ngắn.

use crate::redact::redact;
use serde_json::Value;
use std::fmt;

const DETAIL_MAX: usize = 400;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCode {
    ProviderCredits,
    ProviderAuth,
    ProviderRate,
    ProviderUnavailable,
    Network,
    Timeout,
    /// The model declined (Claude API `stop_reason: "refusal"`).
    ProviderRefusal,
    /// `claude` CLI not installed / not on PATH.
    CliNotFound,
    /// `claude` CLI is installed but not signed in.
    CliAuth,
    /// Subscription usage window exhausted (e.g. "You've hit your 5-hour limit · resets 12pm").
    /// Not transient: retrying before the reset only fails again.
    CliLimit,
    Unknown,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ErrorCode::ProviderCredits => "PROVIDER_CREDITS",
            ErrorCode::ProviderAuth => "PROVIDER_AUTH",
            ErrorCode::ProviderRate => "PROVIDER_RATE",
            ErrorCode::ProviderUnavailable => "PROVIDER_UNAVAILABLE",
            ErrorCode::Network => "NETWORK",
            ErrorCode::Timeout => "TIMEOUT",
            ErrorCode::ProviderRefusal => "PROVIDER_REFUSAL",
            ErrorCode::CliNotFound => "CLI_NOT_FOUND",
            ErrorCode::CliAuth => "CLI_AUTH",
            ErrorCode::CliLimit => "CLI_LIMIT",
            ErrorCode::Unknown => "UNKNOWN",
        }
    }

    /// Lỗi tạm thời: được phép escalate/retry. Credit/key sai thì không.
    pub fn retryable(self) -> bool {
        matches!(
            self,
            ErrorCode::ProviderRate
                | ErrorCode::ProviderUnavailable
                | ErrorCode::Network
                | ErrorCode::Timeout
        )
    }
}

#[derive(Debug, Clone)]
pub struct ProviderError {
    pub code: ErrorCode,
    pub status: Option<u16>,
    /// Đã lọc secret + cắt ngắn.
    pub detail: String,
}

impl fmt::Display for ProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.status {
            Some(s) => write!(f, "provider error {} (HTTP {s})", self.code.as_str()),
            None => write!(f, "provider error {}", self.code.as_str()),
        }
    }
}

impl std::error::Error for ProviderError {}

impl ProviderError {
    pub fn from_http(status: u16, body: &str, key: &str) -> Self {
        Self {
            code: classify_http(status, body),
            status: Some(status),
            detail: sanitize(body, key),
        }
    }

    /// The model declined to answer; `category` from `stop_details` (may be empty).
    pub fn refusal(category: &str) -> Self {
        Self {
            code: ErrorCode::ProviderRefusal,
            status: None,
            detail: if category.is_empty() {
                "model declined the request".into()
            } else {
                format!("model declined the request ({category})")
            },
        }
    }

    pub fn new(code: ErrorCode, detail: &str) -> Self {
        Self { code, status: None, detail: sanitize(detail, "") }
    }

    pub fn from_reqwest(err: &reqwest::Error, key: &str) -> Self {
        let code = if err.is_timeout() {
            ErrorCode::Timeout
        } else if err.is_connect() || err.is_request() || err.is_body() {
            ErrorCode::Network
        } else {
            ErrorCode::Unknown
        };
        Self {
            code,
            status: err.status().map(|s| s.as_u16()),
            detail: sanitize(&err.to_string(), key),
        }
    }
}

pub fn classify_http(status: u16, body: &str) -> ErrorCode {
    match status {
        402 => {
            let b = body.to_lowercase();
            let credit_hint = ["credit", "insufficient", "balance", "quota", "payment"]
                .iter()
                .any(|w| b.contains(w));
            if credit_hint {
                ErrorCode::ProviderCredits
            } else {
                ErrorCode::Unknown
            }
        }
        // The Claude API reports an empty balance as 400 "Your credit balance is too low…".
        400 if body.to_lowercase().contains("credit balance") => ErrorCode::ProviderCredits,
        401 | 403 => ErrorCode::ProviderAuth,
        408 => ErrorCode::Timeout,
        429 => ErrorCode::ProviderRate,
        500..=599 => ErrorCode::ProviderUnavailable,
        _ => ErrorCode::Unknown,
    }
}

/// `"<provider>: <upstream message>"` from an OpenRouter error body, if present.
fn upstream_detail(body: &str) -> Option<String> {
    let v: Value = serde_json::from_str(body).ok()?;
    let meta = v.get("error")?.get("metadata")?;
    let raw = meta.get("raw")?;
    let text = match raw {
        Value::String(s) => match serde_json::from_str::<Value>(s) {
            Ok(inner) => inner
                .pointer("/error/message")
                .or_else(|| inner.get("message"))
                .and_then(|m| m.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| s.clone()),
            Err(_) => s.clone(),
        },
        other => other
            .pointer("/error/message")
            .or_else(|| other.get("message"))
            .and_then(|m| m.as_str())
            .map(str::to_string)?,
    };
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    match meta.get("provider_name").and_then(|p| p.as_str()) {
        Some(p) => Some(format!("{p}: {text}")),
        None => Some(text.to_string()),
    }
}

/// Lấy `error.message` nếu body là JSON; xoá key + pattern secret; cắt ngắn.
pub fn sanitize(body: &str, key: &str) -> String {
    let msg = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            v.get("error")
                .and_then(|e| e.get("message").or(Some(e)))
                .and_then(|m| m.as_str().map(str::to_string))
                .or_else(|| v.get("message").and_then(|m| m.as_str()).map(str::to_string))
        })
        .unwrap_or_else(|| body.to_string());
    let mut out = msg.trim().to_string();
    // OpenRouter wraps upstream failures as "Provider returned error"; the real reason is in
    // `error.metadata.raw` (often itself JSON with an `error.message`).
    if let Some(up) = upstream_detail(body) {
        out = format!("{out} — {up}");
    }
    if key.len() >= 4 {
        out = out.replace(key, "[REDACTED]");
    }
    out = redact(&out);
    if out.chars().count() > DETAIL_MAX {
        out = out.chars().take(DETAIL_MAX).collect::<String>() + "…";
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const OR_402: &str = r#"{"error":{"message":"Insufficient credits. Add more using https://openrouter.ai/settings/credits","code":402}}"#;

    #[test]
    fn credits_402_openrouter() {
        let e = ProviderError::from_http(402, OR_402, "");
        assert_eq!(e.code, ErrorCode::ProviderCredits);
        assert_eq!(e.status, Some(402));
        assert!(e.detail.starts_with("Insufficient credits"));
        assert!(!e.detail.contains('{'));
        assert!(!e.code.retryable());
    }

    #[test]
    fn ambiguous_402_is_unknown() {
        assert_eq!(classify_http(402, r#"{"error":{"message":"nope"}}"#), ErrorCode::Unknown);
    }

    #[test]
    fn http_codes() {
        assert_eq!(classify_http(401, ""), ErrorCode::ProviderAuth);
        assert_eq!(classify_http(403, ""), ErrorCode::ProviderAuth);
        assert_eq!(classify_http(429, ""), ErrorCode::ProviderRate);
        assert_eq!(classify_http(503, ""), ErrorCode::ProviderUnavailable);
        assert_eq!(classify_http(418, ""), ErrorCode::Unknown);
        assert!(ErrorCode::ProviderRate.retryable());
        assert!(ErrorCode::Timeout.retryable());
        assert!(!ErrorCode::ProviderAuth.retryable());
    }

    #[test]
    fn upstream_reason_is_surfaced() {
        let body = r#"{"error":{"message":"Provider returned error","code":400,"metadata":{"raw":"{\"error\":{\"message\":\"messages.2: tool_use ids were found without tool_result\"}}","provider_name":"Anthropic"}}}"#;
        let s = sanitize(body, "");
        assert!(s.starts_with("Provider returned error — Anthropic: messages.2"), "{s}");
    }

    #[test]
    fn sanitize_strips_key_and_truncates() {
        let key = "sk-or-v1-abcdef0123456789";
        let body = format!("bad key {key} Bearer abc.def-ghi");
        let s = sanitize(&body, key);
        assert!(!s.contains(key));
        assert!(!s.contains("abc.def-ghi"));
        let long = "x".repeat(2000);
        assert!(sanitize(&long, "").chars().count() <= DETAIL_MAX + 1);
    }

    #[test]
    fn claude_api_error_body() {
        let body = r#"{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}"#;
        let e = ProviderError::from_http(400, body, "");
        assert_eq!(e.code, ErrorCode::ProviderCredits);
        assert!(e.detail.starts_with("Your credit balance"));
        assert_eq!(classify_http(529, ""), ErrorCode::ProviderUnavailable);
    }

    #[test]
    fn display_has_no_body() {
        let e = ProviderError::from_http(402, OR_402, "");
        assert_eq!(e.to_string(), "provider error PROVIDER_CREDITS (HTTP 402)");
    }
}
