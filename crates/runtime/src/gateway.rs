use crate::provider_error::ProviderError;
use anyhow::Result;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use silence_router::{Catalog, ModelEntry};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ChatResult {
    pub content: String,
    /// Chuỗi suy nghĩ / reasoning stream (nếu provider gửi).
    pub reasoning: String,
    pub tool_calls: Vec<ToolCall>,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub finish_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}

pub async fn chat(
    catalog: &Catalog,
    model_id: &str,
    messages: &[Value],
    tools: &Value,
    on_token: impl FnMut(&str),
    on_thinking: impl FnMut(&str),
) -> Result<ChatResult> {
    chat_inner(catalog, model_id, messages, tools, None, on_token, on_thinking).await
}

/// Một lượt ngắn không tools, giới hạn `max_tokens` (vd sinh tiêu đề chat).
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
        |_| {},
        |_| {},
    )
    .await
}

async fn chat_inner(
    catalog: &Catalog,
    model_id: &str,
    messages: &[Value],
    tools: &Value,
    max_tokens: Option<u32>,
    mut on_token: impl FnMut(&str),
    mut on_thinking: impl FnMut(&str),
) -> Result<ChatResult> {
    let model = catalog.resolve(model_id)?;
    let provider = catalog.provider_for(&model)?;
    let key = catalog.api_key(provider);
    let url = format!(
        "{}/chat/completions",
        provider.base_url.trim_end_matches('/')
    );
    let mut body = json!({
        "model": expand_api_model(&model.api_model),
        "messages": messages,
        "stream": true,
        "stream_options": {"include_usage": true},
        "max_tokens": max_tokens.unwrap_or_else(|| model.max_output_tokens.max(1024)),
    });
    if model.tools && tools.is_array() && !tools.as_array().unwrap().is_empty() {
        body["tools"] = tools.clone();
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
}
