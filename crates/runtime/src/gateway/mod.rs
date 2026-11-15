use crate::provider_error::ProviderError;
use anyhow::Result;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use silence_router::{Catalog, ModelEntry};
use std::time::Duration;

pub mod claude_api;

/// `Provider.kind` values the gateway speaks.
pub const KIND_OPENAI: &str = "openai_compat";
pub const KIND_CLAUDE_API: &str = "claude_api";
pub const KIND_CLAUDE_CLI: &str = "claude_cli";

/// Opening tag of the per-call tail message (`agent/env.rs::turn_context`).
pub const TURN_CONTEXT_TAG: &str = "<turn_context>";

/// The per-call `<turn_context>` message the agent loop appends after the history. It changes
/// every call and is never stored, so the history cache breakpoint goes on the message before it.
pub fn is_turn_context(m: &Value) -> bool {
    m.get("role").and_then(Value::as_str) == Some("user")
        && m.get("content").and_then(Value::as_str).is_some_and(|t| t.starts_with(TURN_CONTEXT_TAG))
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatResult {
    pub content: String,
    /// Chuỗi suy nghĩ / reasoning stream (nếu provider gửi).
    pub reasoning: String,
    pub tool_calls: Vec<ToolCall>,
    /// Whole prompt size, cached tokens included (measures the context).
    pub input_tokens: u32,
    pub output_tokens: u32,
    /// Part of `input_tokens` served from the prompt cache (Claude API).
    #[serde(default)]
    pub cache_read_tokens: u32,
    /// Part of `input_tokens` written to the prompt cache (Claude API).
    #[serde(default)]
    pub cache_write_tokens: u32,
    pub finish_reason: String,
    /// Provider-native content blocks of this assistant turn, to replay verbatim
    /// (Claude API thinking + signature). Stored on the message under
    /// `claude_api::RAW_BLOCKS_KEY`.
    #[serde(default)]
    pub raw_blocks: Option<Value>,
}

impl ChatResult {
    /// The assistant history message for this turn (OpenAI shape + raw blocks when present).
    pub fn assistant_message(&self, tool_calls: Option<Vec<Value>>) -> Value {
        let mut m = json!({"role": "assistant", "content": self.content});
        if let Some(tc) = tool_calls {
            m["tool_calls"] = Value::Array(tc);
        }
        if let Some(raw) = &self.raw_blocks {
            m[claude_api::RAW_BLOCKS_KEY] = raw.clone();
        }
        m
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

/// `effort`: the session preference (`auto`, `low` … `max`); mapped per model and provider.
pub async fn chat(
    catalog: &Catalog,
    model_id: &str,
    messages: &[Value],
    tools: &Value,
    effort: &str,
    on_token: impl FnMut(&str),
    on_thinking: impl FnMut(&str),
) -> Result<ChatResult> {
    chat_inner(catalog, model_id, messages, tools, None, effort, on_token, on_thinking).await
}

/// Một lượt ngắn không tools, giới hạn `max_tokens` (vd sinh tiêu đề chat). Effort `low`.
pub async fn chat_short(
    catalog: &Catalog,
    model_id: &str,
    messages: &[Value],
    max_tokens: u32,
) -> Result<ChatResult> {
    chat_inner(
        catalog,
        model_id,
        messages,
        &Value::Null,
        Some(max_tokens),
        "low",
        |_| {},
        |_| {},
    )
    .await
}

/// OpenAI-compatible `reasoning.effort`. OpenRouter accepts every level we offer
/// (`low` … `xhigh`, `max`); for Claude it turns the level into a thinking budget.
fn openai_reasoning_effort(effort: &str) -> &str {
    effort
}

#[allow(clippy::too_many_arguments)]
async fn chat_inner(
    catalog: &Catalog,
    model_id: &str,
    messages: &[Value],
    tools: &Value,
    max_tokens: Option<u32>,
    effort: &str,
    mut on_token: impl FnMut(&str),
    mut on_thinking: impl FnMut(&str),
) -> Result<ChatResult> {
    let model = catalog.resolve(model_id)?;
    let provider = catalog.provider_for(&model)?;
    let key = catalog.api_key(provider);
    // A catalog model without vision would reject image parts: send a text note instead.
    // Ad-hoc `vendor/model` ids are not in the catalog and get the images as-is.
    let stripped;
    let messages = if catalog.model(model_id).is_ok_and(|m| !m.vision) {
        stripped = crate::images::strip_images(messages);
        stripped.as_slice()
    } else {
        messages
    };
    let effort = model.effective_effort(effort);
    let max_tokens = max_tokens.unwrap_or_else(|| model.max_output_tokens.max(1024));
    match provider.kind.as_str() {
        KIND_CLAUDE_API => {
            if key.is_empty() {
                return Err(ProviderError::new(
                    crate::provider_error::ErrorCode::ProviderAuth,
                    "Claude API key is not set (ANTHROPIC_API_KEY)",
                )
                .into());
            }
            return claude_api::chat(
                provider, &key, &model, messages, tools, max_tokens, effort, on_token, on_thinking,
            )
            .await;
        }
        KIND_CLAUDE_CLI => {
            return Err(anyhow::anyhow!(
                "model {model_id} runs through the Claude CLI backend, not the HTTP gateway"
            ));
        }
        _ => {}
    }
    let url = format!(
        "{}/chat/completions",
        provider.base_url.trim_end_matches('/')
    );
    // Raw Claude API blocks are only meaningful to that API; OpenAI-compatible endpoints may
    // reject unknown message fields.
    let messages: Vec<Value> = messages
        .iter()
        .map(|m| match m {
            Value::Object(o) if o.contains_key(claude_api::RAW_BLOCKS_KEY) => {
                let mut o = o.clone();
                o.remove(claude_api::RAW_BLOCKS_KEY);
                Value::Object(o)
            }
            other => other.clone(),
        })
        .collect();
    let api_model = expand_api_model(&model.api_model);
    let messages = if wants_cache_breakpoints(&api_model) {
        with_cache_breakpoints(messages)
    } else {
        messages
    };
    let mut body = json!({
        "model": api_model,
        "messages": messages,
        "stream": true,
        "stream_options": {"include_usage": true},
        "max_tokens": max_tokens,
    });
    if model.tools && tools.is_array() && !tools.as_array().unwrap().is_empty() {
        body["tools"] = tools.clone();
    }
    if let Some(e) = effort {
        body["reasoning"] = json!({"effort": openai_reasoning_effort(&e)});
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()?;
    let mut req = client.post(&url).json(&body);
    if !key.is_empty() {
        req = req.bearer_auth(&key);
    }
    req = req
        .header("HTTP-Referer", "https://5ilence.local")
        .header("X-Title", "5ilence");
    let res = req
        .send()
        .await
        .map_err(|e| ProviderError::from_reqwest(&e, &key))?;
    if !res.status().is_success() {
        let status = res.status().as_u16();
        let text = res.text().await.unwrap_or_default();
        return Err(ProviderError::from_http(status, &text, &key).into());
    }
    let mut stream = res.bytes_stream();
    let mut buf = String::new();
    let mut result = ChatResult::default();
    let mut tool_acc: Vec<(String, String, String)> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| ProviderError::from_reqwest(&e, &key))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim().to_string();
            buf = buf[pos + 1..].to_string();
            if let Some(data) = line.strip_prefix("data:") {
                let data = data.trim();
                if data == "[DONE]" {
                    continue;
                }
                if let Ok(v) = serde_json::from_str::<Value>(data) {
                    ingest(&v, &mut result, &mut tool_acc, &mut on_token, &mut on_thinking);
                }
            }
        }
    }
    if !buf.trim().is_empty() {
        if let Some(data) = buf.strip_prefix("data:") {
            if let Ok(v) = serde_json::from_str::<Value>(data.trim()) {
                ingest(&v, &mut result, &mut tool_acc, &mut on_token, &mut on_thinking);
            }
        }
    }
    result.tool_calls = tool_acc
        .into_iter()
        .map(|(id, name, arguments)| ToolCall {
            id,
            name,
            arguments,
        })
        .filter(|t| !t.name.is_empty())
        .collect();
    if result.finish_reason.is_empty() {
        result.finish_reason = if result.tool_calls.is_empty() {
            "stop".into()
        } else {
            "tool_calls".into()
        };
    }
    Ok(result)
}

fn ingest(
    v: &Value,
    result: &mut ChatResult,
    tool_acc: &mut Vec<(String, String, String)>,
    on_token: &mut impl FnMut(&str),
    on_thinking: &mut impl FnMut(&str),
) {
    if let Some(usage) = v.get("usage") {
        result.input_tokens = usage
            .get("prompt_tokens")
            .and_then(|x| x.as_u64())
            .unwrap_or(result.input_tokens as u64) as u32;
        result.output_tokens = usage
            .get("completion_tokens")
            .and_then(|x| x.as_u64())
            .unwrap_or(result.output_tokens as u64) as u32;
        // OpenRouter / OpenAI: cached part of `prompt_tokens` (already included in it).
        if let Some(d) = usage.get("prompt_tokens_details") {
            let n = |k: &str| d.get(k).and_then(|x| x.as_u64());
            if let Some(r) = n("cached_tokens") {
                result.cache_read_tokens = r as u32;
            }
            if let Some(w) = n("cache_write_tokens") {
                result.cache_write_tokens = w as u32;
            }
        }
    }
    let Some(choice) = v.get("choices").and_then(|c| c.get(0)) else {
        return;
    };
    if let Some(fr) = choice.get("finish_reason").and_then(|x| x.as_str()) {
        if fr != "null" {
            result.finish_reason = fr.to_string();
        }
    }
    let delta = choice.get("delta").or_else(|| choice.get("message"));
    let Some(delta) = delta else {
        return;
    };
    push_thinking(delta, result, on_thinking);
    if let Some(content) = delta.get("content") {
        match content {
            Value::String(s) if !s.is_empty() => {
                result.content.push_str(s);
                on_token(s);
            }
            Value::Array(parts) => {
                for part in parts {
                    let ty = part.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    if ty == "thinking" || ty == "reasoning" {
                        if let Some(t) = part
                            .get("thinking")
                            .or_else(|| part.get("text"))
                            .and_then(|x| x.as_str())
                        {
                            if !t.is_empty() {
                                result.reasoning.push_str(t);
                                on_thinking(t);
                            }
                        }
                    } else if let Some(t) = part.get("text").and_then(|x| x.as_str()) {
                        if !t.is_empty() && ty != "tool_use" {
                            result.content.push_str(t);
                            on_token(t);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    if let Some(tcs) = delta.get("tool_calls").and_then(|t| t.as_array()) {
        for tc in tcs {
            let idx = tc.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;
            while tool_acc.len() <= idx {
                tool_acc.push((String::new(), String::new(), String::new()));
            }
            if let Some(id) = tc.get("id").and_then(|i| i.as_str()) {
                tool_acc[idx].0 = id.to_string();
            }
            if let Some(name) = tc
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
            {
                tool_acc[idx].1.push_str(name);
            }
            if let Some(args) = tc
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(|n| n.as_str())
            {
                tool_acc[idx].2.push_str(args);
            }
        }
    }
}

fn push_thinking(delta: &Value, result: &mut ChatResult, on_thinking: &mut impl FnMut(&str)) {
    for key in [
        "reasoning_content",
        "reasoning",
        "thinking",
        "reasoning_text",
    ] {
        if let Some(t) = delta.get(key).and_then(|c| c.as_str()) {
            if !t.is_empty() {
                result.reasoning.push_str(t);
                on_thinking(t);
            }
        }
    }
}

/// Anthropic models behind an OpenAI-compatible router (OpenRouter `anthropic/...`) only cache
/// with explicit `cache_control` breakpoints; OpenAI / Gemini / DeepSeek cache by prefix on
/// their own and must not get the field.
fn wants_cache_breakpoints(api_model: &str) -> bool {
    api_model.starts_with("anthropic/")
}

/// Breakpoints like `claude_api::build_request`: the end of the first system message (static
/// prompt; tools come before it in the cached prefix), the end of the last leading system
/// message (compaction note, if any) and the last history message — not the `<turn_context>`
/// tail, which changes every call; the next call then reads the history from cache. At most 3
/// of the 4 allowed. String contents become one text part carrying `cache_control`; empty texts
/// are skipped (the API rejects empty cached blocks).
fn with_cache_breakpoints(mut messages: Vec<Value>) -> Vec<Value> {
    let lead = messages
        .iter()
        .take_while(|m| m.get("role").and_then(Value::as_str) == Some("system"))
        .count();
    let mut marks: Vec<usize> = Vec::new();
    if lead > 0 {
        marks.push(0);
        marks.push(lead - 1);
    }
    let end = match messages.last() {
        Some(m) if is_turn_context(m) => messages.len() - 1,
        _ => messages.len(),
    };
    if let Some(i) = (lead..end).rev().find(|&i| has_text(&messages[i])) {
        marks.push(i);
    }
    marks.dedup();
    for i in marks {
        mark_message(&mut messages[i]);
    }
    messages
}

fn has_text(m: &Value) -> bool {
    match m.get("content") {
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(parts)) => parts.iter().any(|p| p.get("type").and_then(Value::as_str) == Some("text")),
        _ => false,
    }
}

fn mark_message(m: &mut Value) {
    let cache = json!({"type": "ephemeral"});
    match m.get_mut("content") {
        Some(c @ Value::String(_)) => {
            let text = c.as_str().unwrap_or_default().to_string();
            if !text.is_empty() {
                *c = json!([{"type": "text", "text": text, "cache_control": cache}]);
            }
        }
        Some(Value::Array(parts)) => {
            if let Some(p) = parts
                .iter_mut()
                .rev()
                .find(|p| p.get("type").and_then(Value::as_str) == Some("text"))
            {
                p["cache_control"] = cache;
            }
        }
        _ => {}
    }
}

fn expand_api_model(s: &str) -> String {
    if let Some(rest) = s.strip_prefix("${") {
        return rest
            .trim_end_matches('}')
            .split(":-")
            .next()
            .unwrap_or(s)
            .to_string();
    }
    s.to_string()
}

pub fn cost_usd(model: &ModelEntry, input: u32, output: u32) -> f64 {
    (input as f64 / 1_000_000.0) * model.input_cost_per_1m
        + (output as f64 / 1_000_000.0) * model.output_cost_per_1m
}

/// Cost of one call with prompt-cache pricing: cache reads bill at 0.1× input,
/// 5-minute cache writes at 1.25×, the rest at the full input rate.
pub fn chat_cost_usd(model: &ModelEntry, r: &ChatResult) -> f64 {
    let cached = r.cache_read_tokens + r.cache_write_tokens;
    let plain = r.input_tokens.saturating_sub(cached) as f64;
    let input = plain + r.cache_read_tokens as f64 * 0.1 + r.cache_write_tokens as f64 * 1.25;
    (input / 1_000_000.0) * model.input_cost_per_1m
        + (r.output_tokens as f64 / 1_000_000.0) * model.output_cost_per_1m
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ingest_reasoning_content_stream() {
        let mut result = ChatResult::default();
        let mut tools = Vec::new();
        let mut tokens = String::new();
        let mut thinking = String::new();
        let v = json!({
            "choices": [{
                "delta": {
                    "reasoning_content": "Step one. ",
                    "content": null
                }
            }]
        });
        ingest(
            &v,
            &mut result,
            &mut tools,
            &mut |t| tokens.push_str(t),
            &mut |t| thinking.push_str(t),
        );
        assert_eq!(thinking, "Step one. ");
        assert_eq!(result.reasoning, "Step one. ");
        assert!(tokens.is_empty());
    }

    #[test]
    fn ingest_reads_openrouter_cache_usage() {
        let mut result = ChatResult::default();
        let v = json!({"usage": {"prompt_tokens": 1000, "completion_tokens": 20,
            "prompt_tokens_details": {"cached_tokens": 800, "cache_write_tokens": 150}}});
        ingest(&v, &mut result, &mut Vec::new(), &mut |_| {}, &mut |_| {});
        assert_eq!(result.input_tokens, 1000);
        assert_eq!(result.cache_read_tokens, 800);
        assert_eq!(result.cache_write_tokens, 150);
    }

    #[test]
    fn cache_breakpoints_only_for_anthropic_models() {
        assert!(wants_cache_breakpoints("anthropic/claude-haiku-5.5"));
        assert!(!wants_cache_breakpoints("openai/gpt-5"));
        assert!(!wants_cache_breakpoints("google/gemini-3-pro"));
    }

    #[test]
    fn cache_breakpoints_on_static_env_and_last_message() {
        let out = with_cache_breakpoints(vec![
            json!({"role": "system", "content": "STATIC"}),
            json!({"role": "system", "content": "## Runtime environment"}),
            json!({"role": "user", "content": "fix it"}),
            json!({"role": "assistant", "content": "", "tool_calls": [{"id": "1"}]}),
            json!({"role": "tool", "tool_call_id": "1", "content": "ok"}),
        ]);
        let cached = |i: usize| out[i]["content"][0]["cache_control"]["type"] == "ephemeral";
        assert!(cached(0) && cached(1) && cached(4));
        assert_eq!(out[0]["content"][0]["text"], "STATIC");
        // Untouched: the prompt (not last) and the empty assistant message.
        assert_eq!(out[2]["content"], "fix it");
        assert_eq!(out[3]["content"], "");
    }

    #[test]
    fn cache_breakpoint_skips_the_turn_context_tail() {
        let out = with_cache_breakpoints(vec![
            json!({"role": "system", "content": "STATIC"}),
            json!({"role": "user", "content": "fix it"}),
            json!({"role": "assistant", "content": "", "tool_calls": [{"id": "1"}]}),
            json!({"role": "tool", "tool_call_id": "1", "content": "ok"}),
            json!({"role": "user", "content": "<turn_context>\n## Mode: Ask\n</turn_context>"}),
        ]);
        let cached = |i: usize| out[i]["content"][0]["cache_control"]["type"] == "ephemeral";
        assert!(cached(0) && cached(3));
        assert!(out[4]["content"].is_string(), "the tail changes every call: never a breakpoint");
    }

    #[test]
    fn cache_breakpoint_skips_trailing_empty_message() {
        let out = with_cache_breakpoints(vec![
            json!({"role": "user", "content": [{"type": "text", "text": "a"}, {"type": "image_url", "image_url": {}}]}),
            json!({"role": "assistant", "content": ""}),
        ]);
        assert_eq!(out[0]["content"][0]["cache_control"]["type"], "ephemeral");
        assert!(out[1]["content"].is_string());
    }

    #[test]
    fn cache_pricing() {
        let model = ModelEntry {
            id: "m".into(),
            label: String::new(),
            provider: "p".into(),
            api_model: "m".into(),
            tier: "mid".into(),
            context_window: 1000,
            max_output_tokens: 1000,
            tools: true,
            vision: false,
            input_cost_per_1m: 10.0,
            output_cost_per_1m: 0.0,
            efforts: vec![],
            default_effort: String::new(),
            opt_in: false,
        };
        let r = ChatResult {
            input_tokens: 1_000_000,
            cache_read_tokens: 800_000,
            cache_write_tokens: 100_000,
            ..Default::default()
        };
        // 100k plain + 800k × 0.1 + 100k × 1.25 = 305k tokens at $10/M
        assert!((chat_cost_usd(&model, &r) - 3.05).abs() < 1e-9);
        let plain = ChatResult { input_tokens: 1_000_000, ..Default::default() };
        assert!((chat_cost_usd(&model, &plain) - cost_usd(&model, 1_000_000, 0)).abs() < 1e-9);
    }

    #[test]
    fn assistant_message_keeps_raw_blocks() {
        let r = ChatResult {
            content: "hi".into(),
            raw_blocks: Some(json!([{"type": "text", "text": "hi"}])),
            ..Default::default()
        };
        let m = r.assistant_message(None);
        assert_eq!(m[claude_api::RAW_BLOCKS_KEY][0]["text"], "hi");
        assert!(m.get("tool_calls").is_none());
    }

    #[test]
    fn openai_effort_passes_every_level() {
        for e in silence_protocol::EFFORT_LEVELS {
            assert_eq!(openai_reasoning_effort(e), e);
        }
    }
}
