//! Tiêu đề chat do AI sinh (`chat.title`): một lượt ngắn với model tier `fast`, không tools.

use crate::agent::AppCtx;
use crate::audit::now_event;
use crate::gateway;
use crate::redact::redact;
use anyhow::{anyhow, Result};
use serde_json::json;

const TITLE_SYSTEM: &str = "You write titles for chat conversations between a user and a coding assistant. \
Reply with a 3-6 word title that names the user's task. Use the same language as the user's message. \
Sentence case, no quotes, no trailing punctuation, no emoji, no markdown. Output only the title.";

const INPUT_CHARS: usize = 1500;
const MAX_TITLE_CHARS: usize = 60;
const MAX_TOKENS: u32 = 48;

pub async fn generate_title(
    ctx: &AppCtx,
    session_id: &str,
    user_text: &str,
    reply_text: &str,
) -> Result<String> {
    let user = clip(user_text.trim(), INPUT_CHARS);
    if user.is_empty() {
        return Err(anyhow!("user_text is empty"));
    }
    let reply = clip(reply_text.trim(), INPUT_CHARS);
    let mut content = format!("<user_message>\n{}\n</user_message>", redact(&user));
    if !reply.is_empty() {
        content.push_str(&format!(
            "\n<assistant_reply>\n{}\n</assistant_reply>",
            redact(&reply)
        ));
    }
    let model = ctx.catalog.by_tier("fast")?.id.clone();
    let msgs = vec![
        json!({"role": "system", "content": TITLE_SYSTEM}),
        json!({"role": "user", "content": content}),
    ];
    let result = gateway::chat_short(&ctx.catalog, &model, &msgs, MAX_TOKENS).await?;
    let usd = ctx
        .catalog
        .model(&model)
        .map(|m| gateway::chat_cost_usd(m, &result))
        .unwrap_or(0.0);
    let _ = ctx
        .audit
        .append(now_event(
            session_id,
            "title",
            &model,
            "",
            "",
            result.input_tokens,
            result.output_tokens,
            usd,
            json!({}),
        ))
        .await;
    sanitize_title(&result.content).ok_or_else(|| anyhow!("model returned an empty title"))
}

fn clip(s: &str, max_chars: usize) -> String {
    s.chars().take(max_chars).collect()
}

/// Chuẩn hoá output của model thành tiêu đề một dòng; `None` nếu rỗng.
pub fn sanitize_title(raw: &str) -> Option<String> {
    let line = raw.lines().map(str::trim).find(|l| !l.is_empty())?;
    let mut t = line.trim_start_matches(['#', '*', '-', ' ']).trim();
    for prefix in ["Title:", "title:", "Tiêu đề:", "tiêu đề:"] {
        if let Some(rest) = t.strip_prefix(prefix) {
            t = rest.trim();
        }
    }
    let quotes: &[char] = &['"', '\'', '“', '”', '‘', '’', '`', '*'];
    let t = t.trim_matches(quotes).trim();
    let t = t.trim_end_matches(['.', '!', '?', ':', ';', ',', '…', '。']).trim();
    let t = t.trim_matches(quotes).trim();
    let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() {
        return None;
    }
    if t.chars().count() <= MAX_TITLE_CHARS {
        return Some(t);
    }
    let cut: String = t.chars().take(MAX_TITLE_CHARS - 1).collect();
    Some(format!("{}…", cut.trim_end()))
}

#[cfg(test)]
mod tests {
    use super::sanitize_title;

    #[test]
    fn strips_quotes_prefix_and_punctuation() {
        assert_eq!(
            sanitize_title("\"Đổi giá trị biến so_a.\"").as_deref(),
            Some("Đổi giá trị biến so_a")
        );
        assert_eq!(
            sanitize_title("Title: Fix login bug").as_deref(),
            Some("Fix login bug")
        );
        assert_eq!(
            sanitize_title("**Refactor  router**").as_deref(),
            Some("Refactor router")
        );
    }

    #[test]
    fn keeps_first_non_empty_line() {
        assert_eq!(
            sanitize_title("\n\nThêm test cho parser\nExtra explanation").as_deref(),
            Some("Thêm test cho parser")
        );
    }

    #[test]
    fn empty_is_none() {
        assert_eq!(sanitize_title(""), None);
        assert_eq!(sanitize_title("  \"...\"  "), None);
    }

    #[test]
    fn caps_length_on_char_boundary() {
        let long = "Tiếng Việt ".repeat(20);
        let t = sanitize_title(&long).unwrap();
        assert!(t.chars().count() <= 60);
        assert!(t.ends_with('…'));
    }
}
