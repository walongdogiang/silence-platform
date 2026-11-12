//! Anthropic Messages API (`POST /v1/messages`, SSE). The session history stays in the
//! OpenAI chat shape the rest of the Engine uses; this module converts at the edge.
//!
//! Assistant turns that came from this API carry their raw content blocks under
//! [`RAW_BLOCKS_KEY`] (thinking blocks with their signature, text, tool_use). They are sent
//! back verbatim: the API needs the thinking blocks of a tool-use turn unchanged.

use super::{ChatResult, ToolCall};
use crate::provider_error::ProviderError;
use anyhow::Result;
use futures_util::StreamExt;
use serde_json::{json, Map, Value};
use silence_router::{ModelEntry, Provider};
use std::time::Duration;

pub const API_VERSION: &str = "2023-06-01";
/// Field on an assistant message holding the API's own content blocks.
pub const RAW_BLOCKS_KEY: &str = "anthropic_content";

#[allow(clippy::too_many_arguments)]
pub(super) async fn chat(
    provider: &Provider,
    key: &str,
    model: &ModelEntry,
    messages: &[Value],
    tools: &Value,
    max_tokens: u32,
    effort: Option<String>,
    mut on_token: impl FnMut(&str),
    mut on_thinking: impl FnMut(&str),
) -> Result<ChatResult> {
    let url = format!("{}/v1/messages", provider.base_url.trim_end_matches('/'));
    let body = build_request(model, messages, tools, max_tokens, effort.as_deref());
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()?;
    let res = client
        .post(&url)
        .header("x-api-key", key)
        .header("anthropic-version", API_VERSION)
        .json(&body)
        .send()
        .await
        .map_err(|e| ProviderError::from_reqwest(&e, key))?;
    if !res.status().is_success() {
        let status = res.status().as_u16();
        let text = res.text().await.unwrap_or_default();
        return Err(ProviderError::from_http(status, &text, key).into());
    }
    let mut stream = res.bytes_stream();
    let mut buf = String::new();
    let mut st = StreamState::default();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| ProviderError::from_reqwest(&e, key))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim().to_string();
            buf = buf[pos + 1..].to_string();
            if let Some(data) = line.strip_prefix("data:") {
                if let Ok(v) = serde_json::from_str::<Value>(data.trim()) {
                    st.ingest(&v, &mut on_token, &mut on_thinking)?;
                }
            }
        }
    }
    if let Some(data) = buf.trim().strip_prefix("data:") {
        if let Ok(v) = serde_json::from_str::<Value>(data.trim()) {
            st.ingest(&v, &mut on_token, &mut on_thinking)?;
        }
    }
    Ok(st.finish())
}

/// Request body. `effort` is already mapped to what the model accepts (`None` = omit).
pub(super) fn build_request(
    model: &ModelEntry,
    messages: &[Value],
    tools: &Value,
    max_tokens: u32,
    effort: Option<&str>,
) -> Value {
    let (system, mut msgs) = convert_messages(messages);
    let thinking = !model.efforts.is_empty();
    // Thinking tokens count against `max_tokens`: a tiny cap (titles) could end the reply
    // before any text.
    let max_tokens = if thinking { max_tokens.max(2048) } else { max_tokens };
    let mut body = json!({
        "model": model.api_model,
        "max_tokens": max_tokens,
        "stream": true,
    });
    if !system.is_empty() {
        let mut blocks: Vec<Value> = system.into_iter().map(|t| json!({"type": "text", "text": t})).collect();
        mark_cache(blocks.last_mut());
        body["system"] = Value::Array(blocks);
    }
    // Cache the growing history too: the last block of the last message.
    if let Some(last) = msgs.last_mut() {
        if let Some(arr) = last.get_mut("content").and_then(Value::as_array_mut) {
            mark_cache(arr.last_mut());
        }
    }
    body["messages"] = Value::Array(msgs);
    if model.tools {
        let mut ts = convert_tools(tools);
        if !ts.is_empty() {
            mark_cache(ts.last_mut());
            body["tools"] = Value::Array(ts);
        }
    }
    // Models listed with effort levels are the current generation: adaptive thinking, with a
    // summary so the UI can show it. Older or ad-hoc models get no thinking field at all.
    if thinking {
        body["thinking"] = json!({"type": "adaptive", "display": "summarized"});
    }
    if let Some(e) = effort {
        body["output_config"] = json!({"effort": e});
    }
    body
}

fn mark_cache(block: Option<&mut Value>) {
    if let Some(Value::Object(o)) = block {
        o.insert("cache_control".into(), json!({"type": "ephemeral"}));
    }
}

/// OpenAI `tools: [{type:function, function:{name, description, parameters}}]` → Anthropic.
pub(super) fn convert_tools(tools: &Value) -> Vec<Value> {
    tools
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|t| {
            let f = t.get("function").unwrap_or(t);
            let name = f.get("name")?.as_str()?;
            let schema = f
                .get("parameters")
                .or_else(|| f.get("input_schema"))
                .cloned()
                .unwrap_or_else(|| json!({"type": "object", "properties": {}}));
            Some(json!({
                "name": name,
                "description": f.get("description").and_then(Value::as_str).unwrap_or(""),
                "input_schema": schema,
            }))
        })
        .collect()
}

/// OpenAI chat history → (system texts, Anthropic messages). Consecutive user-side messages
/// (tool results, then any user text) merge into one user message, as the API expects.
pub(super) fn convert_messages(messages: &[Value]) -> (Vec<String>, Vec<Value>) {
    let mut system = Vec::new();
    let mut out: Vec<Value> = Vec::new();
    for m in messages {
        let role = m.get("role").and_then(Value::as_str).unwrap_or("");
        match role {
            "system" => {
                let t = text_of(m.get("content"));
                if !t.trim().is_empty() {
                    system.push(t);
                }
            }
            "user" => push_user(&mut out, user_blocks(m.get("content"))),
            "tool" => {
                let id = m.get("tool_call_id").and_then(Value::as_str).unwrap_or("");
                let content = text_of(m.get("content"));
                push_user(
                    &mut out,
                    vec![json!({"type": "tool_result", "tool_use_id": id, "content": content})],
                );
            }
            "assistant" => {
                let blocks = assistant_blocks(m);
                if !blocks.is_empty() {
                    out.push(json!({"role": "assistant", "content": blocks}));
                }
            }
            _ => {}
        }
    }
    (system, out)
}

fn push_user(out: &mut Vec<Value>, blocks: Vec<Value>) {
    if blocks.is_empty() {
        return;
    }
    if let Some(last) = out.last_mut() {
        if last["role"] == "user" {
            if let Some(arr) = last["content"].as_array_mut() {
                arr.extend(blocks);
                return;
            }
        }
    }
    out.push(json!({"role": "user", "content": blocks}));
}

fn text_of(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

fn user_blocks(content: Option<&Value>) -> Vec<Value> {
    match content {
        Some(Value::String(s)) if !s.is_empty() => vec![json!({"type": "text", "text": s})],
        Some(Value::Array(parts)) => parts.iter().filter_map(user_part).collect(),
        _ => Vec::new(),
    }
}

fn user_part(p: &Value) -> Option<Value> {
    match p.get("type").and_then(Value::as_str)? {
        "text" => {
            let t = p.get("text")?.as_str()?;
            (!t.is_empty()).then(|| json!({"type": "text", "text": t}))
        }
        "image_url" => {
            let url = p.get("image_url")?.get("url")?.as_str()?;
            Some(image_block(url))
        }
        _ => None,
    }
}

/// `data:<mime>;base64,<data>` → base64 source; anything else → URL source.
fn image_block(url: &str) -> Value {
    if let Some(rest) = url.strip_prefix("data:") {
        if let Some((mime, data)) = rest.split_once(";base64,") {
            return json!({"type": "image", "source": {"type": "base64", "media_type": mime, "data": data}});
        }
    }
    json!({"type": "image", "source": {"type": "url", "url": url}})
}

fn assistant_blocks(m: &Value) -> Vec<Value> {
    if let Some(raw) = m.get(RAW_BLOCKS_KEY).and_then(Value::as_array) {
        if !raw.is_empty() {
            return raw.clone();
        }
    }
    let mut blocks = Vec::new();
    let text = text_of(m.get("content"));
    if !text.trim().is_empty() {
        blocks.push(json!({"type": "text", "text": text}));
    }
    for tc in m.get("tool_calls").and_then(Value::as_array).into_iter().flatten() {
        let f = tc.get("function").cloned().unwrap_or_default();
        let args = f.get("arguments").and_then(Value::as_str).unwrap_or("{}");
        let input = serde_json::from_str::<Value>(args)
            .ok()
            .filter(Value::is_object)
            .unwrap_or_else(|| json!({}));
        blocks.push(json!({
            "type": "tool_use",
            "id": tc.get("id").and_then(Value::as_str).unwrap_or(""),
            "name": f.get("name").and_then(Value::as_str).unwrap_or(""),
            "input": input,
        }));
    }
    blocks
}

/// Content blocks being streamed, by index. Each keeps the raw block so the assistant turn can
/// be replayed verbatim (thinking + signature).
#[derive(Default)]
pub(super) struct StreamState {
    blocks: Vec<Map<String, Value>>,
    /// Accumulated `input_json_delta` per tool_use block index.
    tool_json: Vec<String>,
    result: ChatResult,
}

impl StreamState {
    pub(super) fn ingest(
        &mut self,
        v: &Value,
        on_token: &mut impl FnMut(&str),
        on_thinking: &mut impl FnMut(&str),
    ) -> Result<()> {
        match v.get("type").and_then(Value::as_str).unwrap_or("") {
            "message_start" => {
                if let Some(u) = v.get("message").and_then(|m| m.get("usage")) {
                    self.usage(u);
                }
            }
            "content_block_start" => {
                let idx = index(v);
                let block = v
                    .get("content_block")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default();
                while self.blocks.len() <= idx {
                    self.blocks.push(Map::new());
                    self.tool_json.push(String::new());
                }
                if let Some(t) = block.get("text").and_then(Value::as_str) {
                    if !t.is_empty() {
                        self.result.content.push_str(t);
                        on_token(t);
                    }
                }
                self.blocks[idx] = block;
            }
            "content_block_delta" => {
                let idx = index(v);
                let Some(block) = self.blocks.get_mut(idx) else {
                    return Ok(());
                };
                let d = v.get("delta").cloned().unwrap_or_default();
                match d.get("type").and_then(Value::as_str).unwrap_or("") {
                    "text_delta" => {
                        let t = d.get("text").and_then(Value::as_str).unwrap_or("");
                        append(block, "text", t);
                        self.result.content.push_str(t);
                        on_token(t);
                    }
                    "thinking_delta" => {
                        let t = d.get("thinking").and_then(Value::as_str).unwrap_or("");
                        append(block, "thinking", t);
                        if !t.is_empty() {
                            self.result.reasoning.push_str(t);
                            on_thinking(t);
                        }
                    }
                    "signature_delta" => {
                        let s = d.get("signature").and_then(Value::as_str).unwrap_or("");
                        append(block, "signature", s);
                    }
                    "input_json_delta" => {
                        let p = d.get("partial_json").and_then(Value::as_str).unwrap_or("");
                        self.tool_json[idx].push_str(p);
                    }
                    _ => {}
                }
            }
            "message_delta" => {
                if let Some(u) = v.get("usage") {
                    self.usage(u);
                }
                if let Some(r) = v.get("delta").and_then(|d| d.get("stop_reason")).and_then(Value::as_str) {
                    if r == "refusal" {
                        return Err(ProviderError::refusal(
                            v.get("delta")
                                .and_then(|d| d.get("stop_details"))
                                .and_then(|s| s.get("category"))
                                .and_then(Value::as_str)
                                .unwrap_or(""),
                        )
                        .into());
                    }
                    self.result.finish_reason = match r {
                        "end_turn" | "stop_sequence" | "pause_turn" => "stop",
                        "tool_use" => "tool_calls",
                        "max_tokens" => "length",
                        other => other,
                    }
                    .to_string();
                }
            }
            "error" => {
                let body = v.to_string();
                return Err(ProviderError::from_http(529, &body, "").into());
            }
            _ => {}
        }
        Ok(())
    }

    fn usage(&mut self, u: &Value) {
        let n = |k: &str| u.get(k).and_then(Value::as_u64).map(|x| x as u32);
        if let Some(out) = n("output_tokens") {
            self.result.output_tokens = out;
        }
        let read = n("cache_read_input_tokens");
        let write = n("cache_creation_input_tokens");
        if let Some(r) = read {
            self.result.cache_read_tokens = r;
        }
        if let Some(w) = write {
            self.result.cache_write_tokens = w;
        }
        if let Some(inp) = n("input_tokens") {
            // `input_tokens` excludes cached tokens; the Engine's `input_tokens` is the whole
            // prompt (it measures the context), so add them back.
            self.result.input_tokens =
                inp + self.result.cache_read_tokens + self.result.cache_write_tokens;
        }
    }

    pub(super) fn finish(mut self) -> ChatResult {
        let mut raw = Vec::new();
        for (i, mut block) in self.blocks.into_iter().enumerate() {
            if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                let args = std::mem::take(&mut self.tool_json[i]);
                let args = if args.trim().is_empty() { "{}".to_string() } else { args };
                let input = serde_json::from_str::<Value>(&args).unwrap_or_else(|_| json!({}));
                block.insert("input".into(), input);
                self.result.tool_calls.push(ToolCall {
                    id: block.get("id").and_then(Value::as_str).unwrap_or("").to_string(),
                    name: block.get("name").and_then(Value::as_str).unwrap_or("").to_string(),
                    arguments: args,
                });
            }
            if !block.is_empty() {
                raw.push(Value::Object(block));
            }
        }
        self.result.tool_calls.retain(|t| !t.name.is_empty());
        if self.result.finish_reason.is_empty() {
            self.result.finish_reason =
                if self.result.tool_calls.is_empty() { "stop" } else { "tool_calls" }.into();
        }
        if !raw.is_empty() {
            self.result.raw_blocks = Some(Value::Array(raw));
        }
        self.result
    }
}

fn index(v: &Value) -> usize {
    v.get("index").and_then(Value::as_u64).unwrap_or(0) as usize
}

fn append(block: &mut Map<String, Value>, key: &str, s: &str) {
    let cur = block.get(key).and_then(Value::as_str).unwrap_or("").to_string();
    block.insert(key.into(), Value::String(cur + s));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn model(efforts: bool) -> ModelEntry {
        ModelEntry {
            id: "claude-opus@api".into(),
            label: String::new(),
            provider: "anthropic".into(),
            api_model: "claude-opus-5-5".into(),
            tier: "strong".into(),
            context_window: 1_000_000,
            max_output_tokens: 16384,
            tools: true,
            vision: true,
            input_cost_per_1m: 4.0,
            output_cost_per_1m: 20.0,
            efforts: if efforts { vec!["low".into(), "medium".into()] } else { vec![] },
            default_effort: if efforts { "medium".into() } else { String::new() },
            opt_in: false,
        }
    }

    #[test]
    fn converts_tool_round_and_merges_results() {
        let history = vec![
            json!({"role": "system", "content": "SYS"}),
            json!({"role": "user", "content": "fix it"}),
            json!({"role": "assistant", "content": "", "tool_calls": [
                {"id": "t1", "type": "function", "function": {"name": "read", "arguments": "{\"path\":\"a.rs\"}"}},
                {"id": "t2", "type": "function", "function": {"name": "read", "arguments": "not json"}}
            ]}),
            json!({"role": "tool", "tool_call_id": "t1", "content": "A"}),
            json!({"role": "tool", "tool_call_id": "t2", "content": "B"}),
            json!({"role": "user", "content": [
                {"type": "text", "text": "look"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,QUJD"}}
            ]}),
        ];
        let (system, msgs) = convert_messages(&history);
        assert_eq!(system, vec!["SYS".to_string()]);
        assert_eq!(msgs.len(), 3);
        let a = &msgs[1]["content"];
        assert_eq!(a[0]["type"], "tool_use");
        assert_eq!(a[0]["input"]["path"], "a.rs");
        assert_eq!(a[1]["input"], json!({}));
        let u = msgs[2]["content"].as_array().unwrap();
        assert_eq!(u.len(), 4, "two tool_results + text + image in one user message");
        assert_eq!(u[0]["type"], "tool_result");
        assert_eq!(u[1]["tool_use_id"], "t2");
        assert_eq!(u[3]["source"]["media_type"], "image/png");
        assert_eq!(u[3]["source"]["data"], "QUJD");
    }

    #[test]
    fn replays_raw_blocks_verbatim() {
        let raw = json!([{"type": "thinking", "thinking": "x", "signature": "sig"},
                         {"type": "tool_use", "id": "t1", "name": "read", "input": {}}]);
        let history = vec![
            json!({"role": "user", "content": "q"}),
            json!({"role": "assistant", "content": "", "tool_calls": [], RAW_BLOCKS_KEY: raw.clone()}),
        ];
        let (_, msgs) = convert_messages(&history);
        assert_eq!(msgs[1]["content"], raw);
    }

    #[test]
    fn request_has_cache_effort_and_thinking() {
        let tools = json!([{"type": "function", "function": {"name": "read", "description": "d", "parameters": {"type": "object"}}}]);
        let history = vec![json!({"role": "system", "content": "S"}), json!({"role": "user", "content": "hi"})];
        let body = build_request(&model(true), &history, &tools, 1000, Some("low"));
        assert_eq!(body["model"], "claude-opus-5-5");
        assert_eq!(body["system"][0]["cache_control"]["type"], "ephemeral");
        assert_eq!(body["tools"][0]["input_schema"]["type"], "object");
        assert_eq!(body["tools"][0]["cache_control"]["type"], "ephemeral");
        assert_eq!(body["messages"][0]["content"][0]["cache_control"]["type"], "ephemeral");
        assert_eq!(body["output_config"]["effort"], "low");
        assert_eq!(body["thinking"]["type"], "adaptive");
        assert!(body.get("temperature").is_none());

        let plain = build_request(&model(false), &history, &tools, 1000, None);
        assert!(plain.get("thinking").is_none());
        assert!(plain.get("output_config").is_none());
    }

    #[test]
    fn parses_stream_with_thinking_text_and_tools() {
        let events = [
            json!({"type": "message_start", "message": {"usage": {"input_tokens": 10, "cache_read_input_tokens": 90, "cache_creation_input_tokens": 0, "output_tokens": 1}}}),
            json!({"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": ""}}),
            json!({"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "plan"}}),
            json!({"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "SIG"}}),
            json!({"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}}),
            json!({"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "Reading."}}),
            json!({"type": "content_block_start", "index": 2, "content_block": {"type": "tool_use", "id": "t1", "name": "read", "input": {}}}),
            json!({"type": "content_block_delta", "index": 2, "delta": {"type": "input_json_delta", "partial_json": "{\"path\":"}}),
            json!({"type": "content_block_delta", "index": 2, "delta": {"type": "input_json_delta", "partial_json": "\"a.rs\"}"}}),
            json!({"type": "content_block_start", "index": 3, "content_block": {"type": "tool_use", "id": "t2", "name": "list", "input": {}}}),
            json!({"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 42}}),
        ];
        let mut st = StreamState::default();
        let (mut tok, mut th) = (String::new(), String::new());
        for e in &events {
            st.ingest(e, &mut |t| tok.push_str(t), &mut |t| th.push_str(t)).unwrap();
        }
        let r = st.finish();
        assert_eq!(tok, "Reading.");
        assert_eq!(th, "plan");
        assert_eq!(r.finish_reason, "tool_calls");
        assert_eq!(r.input_tokens, 100);
        assert_eq!(r.cache_read_tokens, 90);
        assert_eq!(r.output_tokens, 42);
        assert_eq!(r.tool_calls.len(), 2);
        assert_eq!(r.tool_calls[0].arguments, "{\"path\":\"a.rs\"}");
        assert_eq!(r.tool_calls[1].arguments, "{}");
        let raw = r.raw_blocks.unwrap();
        assert_eq!(raw[0]["signature"], "SIG");
        assert_eq!(raw[2]["input"]["path"], "a.rs");
    }

    #[test]
    fn refusal_is_an_error() {
        let mut st = StreamState::default();
        let e = json!({"type": "message_delta", "delta": {"stop_reason": "refusal", "stop_details": {"category": "cyber"}}});
        let err = st.ingest(&e, &mut |_| {}, &mut |_| {}).unwrap_err();
        let pe = err.downcast_ref::<ProviderError>().unwrap();
        assert_eq!(pe.code, crate::provider_error::ErrorCode::ProviderRefusal);
    }
}
