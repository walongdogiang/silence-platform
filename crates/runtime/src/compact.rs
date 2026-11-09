use serde_json::{json, Value};
use std::collections::HashMap;

pub fn estimate_tokens(text: &str) -> usize {
    (text.len() / 4).max(1)
}

pub fn messages_tokens(messages: &[Value]) -> usize {
    messages
        .iter()
        .map(|m| estimate_tokens(&m.to_string()))
        .sum()
}

/// Số message cuối luôn giữ nguyên văn (không lược, không bỏ).
const KEEP_TAIL: usize = 6;
/// Kết quả tool ngắn hơn ngưỡng này thì giữ nguyên: dòng tóm tắt chẳng ngắn hơn bao nhiêu.
const MIN_SUMMARIZE_CHARS: usize = 200;
const COMPACT_NOTE: &str =
    "Older tool results were compacted. Prefer grep/read over assuming file contents.";

fn role(m: &Value) -> &str {
    m.get("role").and_then(|r| r.as_str()).unwrap_or("")
}

/// Khi lịch sử vượt 70% cửa sổ ngữ cảnh:
/// 1. thay nội dung các message `tool` cũ (ngoài `KEEP_TAIL` message cuối) bằng một dòng tóm tắt,
///    giữ nguyên `system`, `user`, chữ của `assistant` và mọi cặp `tool_calls` ↔ `tool`;
/// 2. nếu vẫn vượt, bỏ dần các lượt cũ nhất theo đơn vị nguyên vẹn
///    (assistant có `tool_calls` cùng các message `tool` trả lời nó), không bao giờ bỏ `system`,
///    message `user` đầu tiên (đề bài) hay phần đuôi.
pub fn compact_if_needed(messages: &mut Vec<Value>, context_window: u32) {
    let budget = (context_window as usize * 70) / 100;
    if messages_tokens(messages) < budget {
        return;
    }

    ensure_note(messages);
    let tail_start = messages.len().saturating_sub(KEEP_TAIL);
    summarize_old_tool_results(messages, tail_start);

    if messages_tokens(messages) >= budget {
        drop_oldest_turns(messages, budget);
    }
}

fn ensure_note(messages: &mut Vec<Value>) {
    let has_note = messages
        .iter()
        .any(|m| role(m) == "system" && m.get("content").and_then(|c| c.as_str()) == Some(COMPACT_NOTE));
    if has_note {
        return;
    }
    let at = messages.iter().take_while(|m| role(m) == "system").count();
    messages.insert(at, json!({"role": "system", "content": COMPACT_NOTE}));
}

fn summarize_old_tool_results(messages: &mut [Value], tail_start: usize) {
    // tool_call_id → (tên tool, arguments) từ các message assistant.
    let mut calls: HashMap<String, (String, Value)> = HashMap::new();
    for m in messages.iter() {
        if role(m) != "assistant" {
            continue;
        }
        for tc in m.get("tool_calls").and_then(|t| t.as_array()).into_iter().flatten() {
            let Some(id) = tc.get("id").and_then(|v| v.as_str()) else { continue };
            let f = tc.get("function").unwrap_or(&Value::Null);
            let name = f.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let args = match f.get("arguments") {
                Some(Value::String(s)) => serde_json::from_str(s).unwrap_or(Value::Null),
                Some(v) => v.clone(),
                None => Value::Null,
            };
            calls.insert(id.to_string(), (name, args));
        }
    }

    for m in messages[..tail_start].iter_mut() {
        if role(m) != "tool" {
            continue;
        }
        let content = m.get("content").and_then(|c| c.as_str()).unwrap_or("");
        if content.chars().count() <= MIN_SUMMARIZE_CHARS {
            continue;
        }
        let call = m
            .get("tool_call_id")
            .and_then(|v| v.as_str())
            .and_then(|id| calls.get(id));
        let summary = match call {
            Some((name, args)) if !name.is_empty() => summarize(name, args, content),
            _ => "[tool result elided]".to_string(),
        };
        m["content"] = Value::String(summary);
    }
}

fn clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(max).collect::<String>())
    }
}

fn summarize(name: &str, args: &Value, content: &str) -> String {
    let s = |k: &str| args.get(k).and_then(|v| v.as_str()).map(|v| clip(v, 80));
    let n = |k: &str| args.get(k).and_then(|v| v.as_u64());
    let lines = content.lines().filter(|l| !l.trim().is_empty()).count();
    match name {
        "read" => {
            let path = s("path").unwrap_or_else(|| "?".into());
            match (n("offset"), n("limit")) {
                (o, Some(l)) => {
                    let start = o.unwrap_or(1);
                    format!("[read {path} L{start}–{}, elided]", start + l.saturating_sub(1))
                }
                (Some(o), None) => format!("[read {path} L{o}–, elided]"),
                (None, None) => format!("[read {path}: {lines} lines, elided]"),
            }
        }
        "grep" | "glob" => {
            let pat = s("pattern").unwrap_or_default();
            format!("[{name} \"{pat}\": {lines} lines, elided]")
        }
        "shell" => {
            let cmd = s("command").unwrap_or_default();
            format!("[shell `{cmd}`: {lines} lines, elided]")
        }
        _ => match s("path") {
            Some(path) => format!("[{name} {path}, elided]"),
            None => format!("[{name}: {lines} lines, elided]"),
        },
    }
}

/// Chia `messages` thành các đơn vị bỏ được: assistant có `tool_calls` cùng các `tool` ngay sau nó
/// là một đơn vị; mọi message khác đứng riêng. Trả về các khoảng `[start, end)`.
fn units(messages: &[Value]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < messages.len() {
        let mut end = i + 1;
        let has_calls = role(&messages[i]) == "assistant"
            && messages[i]
                .get("tool_calls")
                .and_then(|t| t.as_array())
                .is_some_and(|a| !a.is_empty());
        if has_calls {
            while end < messages.len() && role(&messages[end]) == "tool" {
                end += 1;
            }
        }
        out.push((i, end));
        i = end;
    }
    out
}

fn drop_oldest_turns(messages: &mut Vec<Value>, budget: usize) {
    let tail_start = messages.len().saturating_sub(KEEP_TAIL);
    let first_user = messages.iter().position(|m| role(m) == "user");
    let mut total = messages_tokens(messages);
    let mut drop = vec![false; messages.len()];
    for (start, end) in units(messages) {
        if total < budget {
            break;
        }
        // Đơn vị chạm vào phần đuôi thì giữ cả đơn vị (để không tách cặp tool_calls ↔ tool).
        if end > tail_start {
            break;
        }
        if role(&messages[start]) == "system" || Some(start) == first_user {
            continue;
        }
        for k in start..end {
            drop[k] = true;
            total -= estimate_tokens(&messages[k].to_string());
        }
    }
    let mut k = 0;
    messages.retain(|_| {
        let keep = !drop[k];
        k += 1;
        keep
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assistant_call(id: &str, name: &str, args: Value) -> Value {
        json!({
            "role": "assistant",
            "content": "",
            "tool_calls": [{
                "id": id,
                "type": "function",
                "function": {"name": name, "arguments": args.to_string()}
            }]
        })
    }

    fn tool(id: &str, content: &str) -> Value {
        json!({"role": "tool", "tool_call_id": id, "content": content})
    }

    fn big(lines: usize) -> String {
        (0..lines).map(|i| format!("line {i} {}\n", "x".repeat(40))).collect()
    }

    fn content(m: &Value) -> &str {
        m["content"].as_str().unwrap()
    }

    /// Mọi tool_call có đúng một message tool trả lời ngay sau, và không có tool mồ côi.
    fn assert_pairs_intact(messages: &[Value]) {
        let mut pending: Vec<String> = Vec::new();
        for m in messages {
            match role(m) {
                "tool" => {
                    let id = m["tool_call_id"].as_str().unwrap().to_string();
                    let pos = pending.iter().position(|p| *p == id);
                    assert!(pos.is_some(), "tool mồ côi: {id}");
                    pending.remove(pos.unwrap());
                }
                _ => {
                    assert!(pending.is_empty(), "thiếu tool cho {pending:?}");
                    if let Some(tcs) = m.get("tool_calls").and_then(|t| t.as_array()) {
                        pending = tcs.iter().map(|t| t["id"].as_str().unwrap().to_string()).collect();
                    }
                }
            }
        }
        assert!(pending.is_empty(), "thiếu tool cho {pending:?}");
    }

    fn history() -> Vec<Value> {
        vec![
            json!({"role": "system", "content": "SYSTEM"}),
            json!({"role": "user", "content": "Tìm và sửa bug trong parser"}),
            assistant_call("c1", "grep", json!({"pattern": "fn parse"})),
            tool("c1", &big(12)),
            assistant_call("c2", "read", json!({"path": "src/a.rs", "offset": 10, "limit": 71})),
            tool("c2", &big(71)),
            tool("orphan", &big(5)),
            json!({"role": "assistant", "content": "Bug nằm ở parse_line."}),
            assistant_call("c3", "shell", json!({"command": "cargo test"})),
            tool("c3", &big(30)),
            json!({"role": "user", "content": "tiếp đi"}),
            assistant_call("c4", "read", json!({"path": "src/b.rs"})),
            tool("c4", &big(20)),
            json!({"role": "assistant", "content": "Xong."}),
        ]
    }

    #[test]
    fn under_budget_is_untouched() {
        let mut m = history();
        let before = m.clone();
        compact_if_needed(&mut m, 1_000_000);
        assert_eq!(m, before);
    }

    #[test]
    fn old_tool_results_are_summarized_and_rest_kept() {
        let mut m = history();
        let n = m.len();
        let budget_window = (messages_tokens(&m) as u32) / 2; // vượt ngân sách trước, đủ sau khi lược
        compact_if_needed(&mut m, budget_window * 2);
        // Có thêm đúng một note, không bỏ message nào.
        assert_eq!(m.len(), n + 1);
        assert_eq!(content(&m[1]), COMPACT_NOTE);
        assert_eq!(content(&m[2]), "Tìm và sửa bug trong parser");
        assert_eq!(content(&m[4]), "[grep \"fn parse\": 12 lines, elided]");
        assert_eq!(content(&m[6]), "[read src/a.rs L10–80, elided]");
        // tool không khớp tool_call nào → tóm tắt chung.
        assert_eq!(content(&m[7]), "[tool result elided]");
        assert_eq!(content(&m[8]), "Bug nằm ở parse_line.");
        // 6 message cuối (từ c3 trở đi) giữ nguyên văn.
        assert_eq!(content(&m[10]), big(30));
        assert_eq!(content(&m[13]), big(20));
        // Gọi lần nữa không thêm note thứ hai.
        compact_if_needed(&mut m, 1);
        let notes = m.iter().filter(|x| x.get("content").and_then(|c| c.as_str()) == Some(COMPACT_NOTE)).count();
        assert_eq!(notes, 1);
    }

    #[test]
    fn summaries_keep_tool_call_pairs() {
        let mut m = history();
        m.remove(6); // bỏ tool mồ côi để lịch sử ban đầu hợp lệ
        assert_pairs_intact(&m);
        let window = messages_tokens(&m) as u32;
        compact_if_needed(&mut m, window);
        assert_pairs_intact(&m);
        // Mọi tool_call_id vẫn còn trên assistant.
        let ids: Vec<&str> = m
            .iter()
            .filter_map(|x| x.get("tool_calls").and_then(|t| t.as_array()))
            .flatten()
            .map(|t| t["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, ["c1", "c2", "c3", "c4"]);
    }

    #[test]
    fn still_over_budget_drops_oldest_whole_turns() {
        let mut m = vec![
            json!({"role": "system", "content": "SYSTEM"}),
            json!({"role": "user", "content": "đề bài"}),
        ];
        // Nhiều lượt mà chữ của assistant lớn: lược tool không đủ.
        for i in 0..10 {
            m.push(json!({"role": "assistant", "content": "nghĩ ".repeat(300)}));
            m.push(assistant_call(&format!("c{i}"), "read", json!({"path": format!("f{i}.rs")})));
            m.push(tool(&format!("c{i}"), &big(40)));
        }
        let tail: Vec<Value> = m[m.len() - KEEP_TAIL..].to_vec();
        let window = 4_000;
        compact_if_needed(&mut m, window);

        assert!(messages_tokens(&m) < window as usize * 70 / 100, "{}", messages_tokens(&m));
        assert_pairs_intact(&m);
        assert_eq!(content(&m[0]), "SYSTEM");
        assert_eq!(content(&m[1]), COMPACT_NOTE);
        assert_eq!(content(&m[2]), "đề bài");
        assert_eq!(&m[m.len() - KEEP_TAIL..], &tail[..]);
        // Lượt cũ nhất đã bị bỏ, không còn tool_call c0.
        assert!(!m.iter().any(|x| x.get("tool_call_id").and_then(|v| v.as_str()) == Some("c0")));
    }

    #[test]
    fn tail_starting_mid_tool_group_is_not_split() {
        let mut m = vec![
            json!({"role": "system", "content": "SYSTEM"}),
            json!({"role": "user", "content": "đề bài"}),
            json!({"role": "assistant", "content": "a".repeat(4000)}),
        ];
        m.push(json!({
            "role": "assistant",
            "content": "",
            "tool_calls": (0..6).map(|i| json!({
                "id": format!("p{i}"), "type": "function",
                "function": {"name": "grep", "arguments": json!({"pattern": "x"}).to_string()}
            })).collect::<Vec<_>>()
        }));
        for i in 0..6 {
            m.push(tool(&format!("p{i}"), "ok"));
        }
        compact_if_needed(&mut m, 100);
        assert_pairs_intact(&m);
        assert!(m.iter().any(|x| x.get("tool_calls").is_some()));
    }
}
