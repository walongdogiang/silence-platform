use serde_json::{json, Value};
use std::collections::HashMap;
use std::future::Future;

pub fn estimate_tokens(text: &str) -> usize {
    (text.len() / 4).max(1)
}

pub fn messages_tokens(messages: &[Value]) -> usize {
    messages
        .iter()
        .map(crate::images::message_tokens)
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

/// Mở đầu của note tóm tắt các lượt đã bỏ (message `user` thay chỗ các lượt đó).
pub const SUMMARY_OPEN: &str = "<compacted_history>";
const SUMMARY_CLOSE: &str = "</compacted_history>";

/// Lịch sử đã vượt ngưỡng nén (70% cửa sổ ngữ cảnh) chưa.
pub fn needs_compaction(messages: &[Value], context_window: u32) -> bool {
    messages_tokens(messages) >= (context_window as usize * 70) / 100
}

/// Khi lịch sử vượt 70% cửa sổ ngữ cảnh:
/// 1. thay nội dung các message `tool` cũ (ngoài `KEEP_TAIL` message cuối) bằng một dòng tóm tắt,
///    giữ nguyên `system`, `user`, chữ của `assistant` và mọi cặp `tool_calls` ↔ `tool`;
/// 2. nếu vẫn vượt, bỏ dần các lượt cũ nhất theo đơn vị nguyên vẹn
///    (assistant có `tool_calls` cùng các message `tool` trả lời nó) cho tới dưới **50%**,
///    không bao giờ bỏ `system`, message `user` đầu tiên (đề bài) hay phần đuôi.
///
/// Ngưỡng trễ 70% → 50%: mỗi lần nén là một lần viết lại phần giữa lịch sử, tức prompt cache
/// trượt từ đó trở đi (Codex: compaction reset cache). Chỉ bỏ vừa đủ dưới 70% thì gần như call
/// nào sau đó cũng lại vượt và nén tiếp, cache trượt liên tục.
///
/// Đây là bản không tóm tắt (fallback): các lượt bị bỏ mất hẳn. Agent loop dùng
/// `compact_with_summary`. Trả `true` nếu đã chạm vào lịch sử (để ghi snapshot vào event log).
pub fn compact_if_needed(messages: &mut Vec<Value>, context_window: u32) -> bool {
    if !needs_compaction(messages, context_window) {
        return false;
    }
    let drop = prepare_drop(messages, context_window);
    apply_drop(messages, &drop, None);
    true
}

/// Như `compact_if_needed`, nhưng trước khi bỏ các lượt cũ thì đưa chúng cho `summarize`
/// (model rẻ) và chèn kết quả thành **một** message `user` (`<compacted_history>…`) đúng chỗ
/// các lượt đó, để mục tiêu, quyết định, file đã sửa và việc còn dở không mất theo.
/// `summarize` trả `None` (lỗi, rỗng) thì bỏ như cũ. Note tóm tắt cũ nằm trong khoảng bị bỏ
/// được đưa lại cho `summarize`, nên tóm tắt cuốn chiếu chứ không chồng nhiều note.
pub async fn compact_with_summary<F, Fut>(
    messages: &mut Vec<Value>,
    context_window: u32,
    summarize: F,
) -> bool
where
    F: FnOnce(Vec<Value>) -> Fut,
    Fut: Future<Output = Option<String>>,
{
    if !needs_compaction(messages, context_window) {
        return false;
    }
    let drop = prepare_drop(messages, context_window);
    let span: Vec<Value> = messages
        .iter()
        .zip(&drop)
        .filter(|(_, d)| **d)
        .map(|(m, _)| m.clone())
        .collect();
    let summary = if span.is_empty() {
        None
    } else {
        summarize(span)
            .await
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
    };
    apply_drop(messages, &drop, summary.as_deref());
    true
}

/// Bước 1 (lược tool cũ) rồi chọn các message sẽ bỏ ở bước 2; chưa bỏ gì.
fn prepare_drop(messages: &mut Vec<Value>, context_window: u32) -> Vec<bool> {
    ensure_note(messages);
    let tail_start = messages.len().saturating_sub(KEEP_TAIL);
    summarize_old_tool_results(messages, tail_start);
    if needs_compaction(messages, context_window) {
        pick_oldest_turns(messages, (context_window as usize * 50) / 100)
    } else {
        vec![false; messages.len()]
    }
}

/// Bỏ các message đánh dấu; có `summary` thì chèn note tóm tắt vào chỗ message bị bỏ đầu tiên.
fn apply_drop(messages: &mut Vec<Value>, drop: &[bool], summary: Option<&str>) {
    let first = drop.iter().position(|d| *d);
    let mut k = 0;
    messages.retain(|_| {
        let keep = !drop[k];
        k += 1;
        keep
    });
    if let (Some(at), Some(text)) = (first, summary) {
        messages.insert(at, summary_message(text));
    }
}

/// Message thay chỗ các lượt đã bỏ. Vai `user` (không phải `system`): `system` giữa lịch sử
/// bị một số provider từ chối, và các note `system` khác đều nằm liền nhau ở đầu.
pub fn summary_message(text: &str) -> Value {
    json!({
        "role": "user",
        "content": format!(
            "{SUMMARY_OPEN}\nEarlier turns of this session were removed to save context. \
Summary of what they contained:\n\n{}\n{SUMMARY_CLOSE}",
            clip(text.trim(), MAX_SUMMARY_CHARS)
        )
    })
}

pub fn is_summary(m: &Value) -> bool {
    role(m) == "user"
        && m.get("content")
            .and_then(|c| c.as_str())
            .is_some_and(|c| c.starts_with(SUMMARY_OPEN))
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

fn pick_oldest_turns(messages: &[Value], budget: usize) -> Vec<bool> {
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
            total -= crate::images::message_tokens(&messages[k]);
        }
    }
    drop
}

// ---- Tóm tắt các lượt bị bỏ bằng model rẻ ----------------------------------------------------

const SUMMARY_SYSTEM: &str = "You compact the history of a coding-agent session. \
The messages below are about to be removed from the agent's context; write the note that replaces them. \
Write in English, as terse Markdown with these sections (skip a section if empty):\n\
## Goal: what the user wants, including later changes of plan.\n\
## Decisions: choices made and constraints set by the user, with the reason if given.\n\
## Files changed: path, then what changed (created / edited / deleted).\n\
## Findings: facts learned about the code (where things are, causes of bugs, commands that work).\n\
## Open items: what is unfinished or was promised next.\n\
When the user's own wording matters (requirements, names, preferences), quote it verbatim; \
keep quotes in Vietnamese or any other language as is, do not translate them. \
If the input contains an earlier <compacted_history> note, merge it in and keep what is still true. \
Do not invent anything. No preamble, output only the note.";

/// Ngân sách chữ cho bản chép đưa model tóm tắt (~15k token) và cho từng message.
const SPAN_CHARS: usize = 60_000;
const MSG_CHARS: usize = 3_000;
const TOOL_CHARS: usize = 600;
const MAX_SUMMARY_CHARS: usize = 8_000;
const SUMMARY_MAX_TOKENS: u32 = 1_500;

fn text_of(m: &Value) -> String {
    match m.get("content") {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .map(|p| match p.get("text").and_then(|t| t.as_str()) {
                Some(t) => t.to_string(),
                None => "[image]".to_string(),
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn render_message(m: &Value) -> String {
    let r = role(m);
    let text = text_of(m);
    let body = if is_summary(m) {
        text
    } else if r == "tool" {
        clip(text.trim(), TOOL_CHARS)
    } else {
        clip(text.trim(), MSG_CHARS)
    };
    let mut b = format!("[{r}]");
    if !body.is_empty() {
        b.push('\n');
        b.push_str(&body);
    }
    for tc in m.get("tool_calls").and_then(|t| t.as_array()).into_iter().flatten() {
        let f = tc.get("function").unwrap_or(&Value::Null);
        let name = f.get("name").and_then(|v| v.as_str()).unwrap_or("?");
        let args = match f.get("arguments") {
            Some(Value::String(s)) => s.clone(),
            Some(v) => v.to_string(),
            None => String::new(),
        };
        b.push_str(&format!("\n-> {name} {}", clip(&args, 300)));
    }
    b
}

/// Chép khoảng lịch sử bị bỏ thành văn bản cho model tóm tắt: mỗi message một khối có nhãn vai,
/// mỗi khối bị cắt; vượt `SPAN_CHARS` thì lược phần giữa (giữ đầu, nơi có tóm tắt cũ, và cuối).
fn render_span(span: &[Value]) -> String {
    let blocks: Vec<String> = span.iter().map(render_message).collect();
    let total: usize = blocks.iter().map(|b| b.chars().count() + 2).sum();
    if total <= SPAN_CHARS {
        return blocks.join("\n\n");
    }
    let (mut head, mut tail) = (Vec::new(), Vec::new());
    let (mut i, mut j) = (0usize, blocks.len());
    let mut used = 0;
    let mut from_head = true;
    while i < j {
        let b = if from_head { &blocks[i] } else { &blocks[j - 1] };
        let n = b.chars().count() + 2;
        if used + n > SPAN_CHARS {
            break;
        }
        used += n;
        if from_head {
            head.push(b.clone());
            i += 1;
        } else {
            tail.push(b.clone());
            j -= 1;
        }
        from_head = !from_head;
    }
    tail.reverse();
    let mut out = head;
    if j > i {
        out.push(format!("[... {} messages omitted ...]", j - i));
    }
    out.extend(tail);
    out.join("\n\n")
}

/// Gọi slot Small của Auto (như tiêu đề chat, `title.rs`) để tóm tắt `span`; chi phí tính vào
/// phiên qua `record_aux_cost`. Không gọi khi đang giữ khoá session (`record_aux_cost` khoá lại).
pub async fn summarize_span(
    ctx: &crate::agent::AppCtx,
    session_id: &str,
    span: &[Value],
) -> anyhow::Result<String> {
    use crate::gateway;
    let transcript = crate::redact::redact(&render_span(span));
    let pick = crate::agent::title_pick(ctx, session_id).await?;
    let model = pick.model_id.clone();
    let msgs = vec![
        json!({"role": "system", "content": SUMMARY_SYSTEM}),
        json!({"role": "user", "content": format!("<history>\n{transcript}\n</history>")}),
    ];
    let result = gateway::chat_short(&ctx.catalog, &model, &msgs, SUMMARY_MAX_TOKENS).await?;
    let usd = ctx
        .catalog
        .model(&model)
        .map(|m| gateway::chat_cost_usd(m, &result))
        .unwrap_or(0.0);
    crate::agent::record_aux_cost(ctx, session_id, &pick, &result, usd).await;
    let _ = ctx
        .audit
        .append(crate::audit::now_event(
            session_id,
            "compact",
            &model,
            "",
            "",
            result.input_tokens,
            result.output_tokens,
            usd,
            json!({"messages": span.len()}),
        ))
        .await;
    let text = result.content.trim().to_string();
    if text.is_empty() {
        anyhow::bail!("model returned an empty summary");
    }
    Ok(text)
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
    fn drops_down_to_half_not_just_under_the_trigger() {
        // Hysteresis: one rewrite of the middle of the history (one prompt-cache miss), then
        // room for many calls before the next one.
        let mut m = vec![
            json!({"role": "system", "content": "SYSTEM"}),
            json!({"role": "user", "content": "đề bài"}),
        ];
        for i in 0..30 {
            m.push(json!({"role": "assistant", "content": "nghĩ ".repeat(300)}));
            m.push(assistant_call(&format!("c{i}"), "read", json!({"path": format!("f{i}.rs")})));
            m.push(tool(&format!("c{i}"), "ok"));
        }
        let window = (messages_tokens(&m) as u32 * 100) / 75; // history at 75% of the window
        assert!(compact_if_needed(&mut m, window));
        let after = messages_tokens(&m);
        assert!(after < window as usize / 2, "{after} of {window}");
        assert_pairs_intact(&m);
        // The next call (one more short step) does not compact again.
        m.push(json!({"role": "assistant", "content": "tiếp"}));
        let before = m.clone();
        assert!(!compact_if_needed(&mut m, window));
        assert_eq!(m, before);
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

        // The protected tail alone is over 50% here: drop as far as allowed, under the trigger.
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

    fn long_session() -> Vec<Value> {
        let mut m = vec![
            json!({"role": "system", "content": "SYSTEM"}),
            json!({"role": "user", "content": "đề bài"}),
        ];
        for i in 0..10 {
            m.push(json!({"role": "assistant", "content": "nghĩ ".repeat(300)}));
            m.push(assistant_call(&format!("c{i}"), "read", json!({"path": format!("f{i}.rs")})));
            m.push(tool(&format!("c{i}"), &big(40)));
        }
        m.insert(5, json!({"role": "user", "content": "Đừng đổi API public nhé"}));
        m
    }

    fn block_on<F: Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread().build().unwrap().block_on(f)
    }

    #[test]
    fn dropped_turns_are_replaced_by_one_summary_note() {
        let mut m = long_session();
        let tail: Vec<Value> = m[m.len() - KEEP_TAIL..].to_vec();
        let mut seen: Vec<Value> = Vec::new();
        let changed = block_on(compact_with_summary(&mut m, 4_000, |span| {
            seen = span;
            async { Some("## Goal\nfix it".to_string()) }
        }));
        assert!(changed);
        // The summarizer got the dropped turns, user wording included, never system/task/tail.
        assert!(!seen.is_empty());
        assert!(seen.iter().any(|x| x["content"] == "Đừng đổi API public nhé"));
        assert!(!seen.iter().any(|x| role(x) == "system" || x["content"] == "đề bài"));
        assert!(seen.iter().any(|x| x.get("tool_call_id").and_then(|v| v.as_str()) == Some("c0")));

        assert_pairs_intact(&m);
        assert_eq!(content(&m[0]), "SYSTEM");
        assert_eq!(content(&m[1]), COMPACT_NOTE);
        assert_eq!(content(&m[2]), "đề bài");
        // Exactly one note, right where the dropped turns were.
        assert!(is_summary(&m[3]), "{}", m[3]);
        assert!(content(&m[3]).contains("## Goal\nfix it"));
        assert_eq!(m.iter().filter(|x| is_summary(x)).count(), 1);
        assert_eq!(&m[m.len() - KEEP_TAIL..], &tail[..]);
        assert!(messages_tokens(&m) < 4_000 * 70 / 100);
    }

    #[test]
    fn failed_summary_falls_back_to_plain_drop() {
        let mut plain = long_session();
        compact_if_needed(&mut plain, 4_000);
        let mut m = long_session();
        assert!(block_on(compact_with_summary(&mut m, 4_000, |_| async { None })));
        assert_eq!(m, plain);
        // A blank answer counts as a failure too.
        let mut m = long_session();
        block_on(compact_with_summary(&mut m, 4_000, |_| async { Some("  \n".into()) }));
        assert_eq!(m, plain);
    }

    #[test]
    fn summarizer_not_called_when_nothing_is_dropped() {
        // Over 70% but eliding tool output is enough: no turn dropped, no model call.
        let mut m = history();
        let window = messages_tokens(&m) as u32;
        let mut called = false;
        block_on(compact_with_summary(&mut m, window, |_| {
            called = true;
            async { Some("x".into()) }
        }));
        assert!(!called);
        assert!(!m.iter().any(is_summary));
        // Under budget: untouched.
        let mut m = history();
        let before = m.clone();
        assert!(!block_on(compact_with_summary(&mut m, 1_000_000, |_| async { Some("x".into()) })));
        assert_eq!(m, before);
    }

    #[test]
    fn older_summary_is_resummarized_not_stacked() {
        let mut m = long_session();
        block_on(compact_with_summary(&mut m, 4_000, |_| async { Some("first".into()) }));
        // Grow the session again past the trigger.
        for i in 10..20 {
            m.push(json!({"role": "assistant", "content": "nghĩ ".repeat(300)}));
            m.push(assistant_call(&format!("c{i}"), "read", json!({"path": format!("f{i}.rs")})));
            m.push(tool(&format!("c{i}"), &big(40)));
        }
        let mut seen = Vec::new();
        block_on(compact_with_summary(&mut m, 4_000, |span| {
            seen = span;
            async { Some("second".into()) }
        }));
        assert!(seen.iter().any(is_summary), "old note goes to the summarizer");
        let notes: Vec<&Value> = m.iter().filter(|x| is_summary(x)).collect();
        assert_eq!(notes.len(), 1);
        assert!(content(notes[0]).contains("second"));
        assert_pairs_intact(&m);
    }

    #[test]
    fn render_span_labels_roles_and_clips() {
        let span = vec![
            json!({"role": "user", "content": "Đừng đổi API public nhé"}),
            assistant_call("c1", "edit", json!({"path": "src/a.rs"})),
            tool("c1", &"y".repeat(5_000)),
            summary_message("old summary"),
        ];
        let out = render_span(&span);
        assert!(out.contains("[user]\nĐừng đổi API public nhé"));
        assert!(out.contains("-> edit {\"path\":\"src/a.rs\"}"));
        assert!(out.contains(&format!("[tool]\n{}…", "y".repeat(TOOL_CHARS))));
        assert!(out.contains("old summary"));

        // Over budget: head and tail kept, middle omitted.
        let many: Vec<Value> = (0..200)
            .map(|i| json!({"role": "assistant", "content": format!("m{i} {}", "z".repeat(1_000))}))
            .collect();
        let out = render_span(&many);
        assert!(out.chars().count() <= SPAN_CHARS + 100);
        assert!(out.contains("m0 ") && out.contains("m199 "));
        assert!(out.contains("messages omitted"));
    }
}
