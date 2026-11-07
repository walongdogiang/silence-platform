use serde_json::{json, Value};

pub fn estimate_tokens(text: &str) -> usize {
    (text.len() / 4).max(1)
}

pub fn messages_tokens(messages: &[Value]) -> usize {
    messages
        .iter()
        .map(|m| estimate_tokens(&m.to_string()))
        .sum()
}

pub fn compact_if_needed(messages: &mut Vec<Value>, context_window: u32) {
    let budget = (context_window as usize * 70) / 100;
    if messages_tokens(messages) < budget {
        return;
    }
    if messages.len() < 6 {
        return;
    }
    let system: Vec<Value> = messages
        .iter()
        .filter(|m| m.get("role").and_then(|r| r.as_str()) == Some("system"))
        .cloned()
        .collect();
    let last: Vec<Value> = messages.iter().rev().take(6).cloned().collect::<Vec<_>>();
    let last: Vec<Value> = last.into_iter().rev().collect();
    let mut compacted = system;
    compacted.push(json!({
        "role": "system",
        "content": "Older tool results were compacted. Prefer grep/read over assuming file contents."
    }));
    compacted.extend(last);
    *messages = compacted;
}
