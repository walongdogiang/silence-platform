//! Images the user pasted into the composer.
//!
//! The Studio sends them as `data:image/<type>;base64,...` URLs on `session.prompt`. A user
//! message with images is stored as OpenAI-style content parts
//! (`[{type:text}, {type:image_url}]`); one without stays a plain string so old sessions and
//! every `content.as_str()` reader keep working.

use anyhow::{bail, Result};
use serde_json::{json, Value};

/// Most images one message may carry.
pub const MAX_IMAGES: usize = 4;
/// Largest decoded image accepted (bytes).
pub const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
/// Rough token cost of one image for context estimates (providers bill ~1–2K for a screenshot).
pub const IMAGE_TOKENS: usize = 1600;

const MIME: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/// Checks pasted images: count, type, base64 shape and size. Errors are user-facing.
pub fn validate(images: &[String]) -> Result<()> {
    if images.len() > MAX_IMAGES {
        bail!("too many images: {} (max {MAX_IMAGES})", images.len());
    }
    for url in images {
        let Some((head, data)) = url.strip_prefix("data:").and_then(|r| r.split_once(',')) else {
            bail!("image must be a data URL");
        };
        let Some(mime) = head.strip_suffix(";base64") else {
            bail!("image must be base64-encoded");
        };
        if !MIME.contains(&mime) {
            bail!("unsupported image type {mime} (png, jpeg, gif, webp)");
        }
        if data.is_empty()
            || !data
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))
        {
            bail!("image data is not valid base64");
        }
        if data.len() / 4 * 3 > MAX_IMAGE_BYTES {
            bail!("image is larger than {} MB", MAX_IMAGE_BYTES / 1024 / 1024);
        }
    }
    Ok(())
}

/// `content` of a user message: the text alone, or text + image parts.
pub fn user_content(text: &str, images: &[String]) -> Value {
    if images.is_empty() {
        return Value::String(text.to_string());
    }
    let mut parts = vec![json!({"type": "text", "text": text})];
    parts.extend(
        images
            .iter()
            .map(|url| json!({"type": "image_url", "image_url": {"url": url}})),
    );
    Value::Array(parts)
}

/// Text of a message's `content`, whether a string or content parts.
pub fn content_text(m: &Value) -> String {
    match m.get("content") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// Number of image parts in a message.
pub fn image_count(m: &Value) -> usize {
    m.get("content")
        .and_then(|c| c.as_array())
        .map(|parts| parts.iter().filter(|p| is_image(p)).count())
        .unwrap_or(0)
}

/// Token estimate of one message, counting each image as `IMAGE_TOKENS` instead of its base64.
pub fn message_tokens(m: &Value) -> usize {
    let n = image_count(m);
    if n == 0 {
        return crate::compact::estimate_tokens(&m.to_string());
    }
    let mut lean = m.clone();
    lean["content"] = Value::String(content_text(m));
    crate::compact::estimate_tokens(&lean.to_string()) + n * IMAGE_TOKENS
}

/// For a model without vision: replace image parts with a short note, so a session that
/// switches to such a model keeps working.
pub fn strip_images(messages: &[Value]) -> Vec<Value> {
    messages
        .iter()
        .map(|m| {
            let n = image_count(m);
            if n == 0 {
                return m.clone();
            }
            let mut out = m.clone();
            out["content"] = Value::String(format!(
                "{}\n\n[{n} image(s) omitted: the current model cannot read images]",
                content_text(m)
            ));
            out
        })
        .collect()
}

fn is_image(p: &Value) -> bool {
    p.get("type").and_then(|t| t.as_str()) == Some("image_url")
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &str = "data:image/png;base64,iVBORw0KGgo=";

    #[test]
    fn validate_accepts_png_and_rejects_bad_input() {
        assert!(validate(&[PNG.to_string()]).is_ok());
        assert!(validate(&["https://x/y.png".into()]).is_err());
        assert!(validate(&["data:image/svg+xml;base64,AAAA".into()]).is_err());
        assert!(validate(&["data:image/png,raw".into()]).is_err());
        assert!(validate(&["data:image/png;base64,<script>".into()]).is_err());
        assert!(validate(&vec![PNG.to_string(); MAX_IMAGES + 1]).is_err());
        let big = format!("data:image/png;base64,{}", "A".repeat(MAX_IMAGE_BYTES / 3 * 4 + 8));
        assert!(validate(&[big]).is_err());
    }

    #[test]
    fn user_content_keeps_plain_string_without_images() {
        assert_eq!(user_content("hi", &[]), json!("hi"));
        let c = user_content("look", &[PNG.to_string()]);
        assert_eq!(c[0]["text"], "look");
        assert_eq!(c[1]["image_url"]["url"], PNG);
    }

    #[test]
    fn tokens_and_strip_ignore_base64() {
        let m = json!({"role": "user", "content": user_content("look", &[format!("data:image/png;base64,{}", "A".repeat(400_000))])});
        assert_eq!(content_text(&m), "look");
        assert_eq!(image_count(&m), 1);
        assert!(message_tokens(&m) < IMAGE_TOKENS + 50);
        let s = strip_images(&[m]);
        assert!(s[0]["content"].as_str().unwrap().starts_with("look\n\n[1 image(s) omitted"));
    }
}
