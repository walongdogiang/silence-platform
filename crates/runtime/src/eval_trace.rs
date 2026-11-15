//! Per-attempt transcript of an eval task: `results/<task>/attempt-<n>/trace.jsonl`.
//!
//! One JSON line per `SessionEvent` (same `type` tag as the protocol), plus `t_ms` since the
//! attempt started. Consecutive `token` / `thinking` deltas are merged into one `text` /
//! `thinking` line. Every string is capped and passed through `redact`, and the whole file is
//! capped, so a runaway tool output cannot fill the disk or the Studio view.

use crate::redact::redact;
use serde_json::{json, Value};
use silence_protocol::SessionEvent;
use std::path::Path;
use std::time::Instant;

/// Longest string kept in one field (tool output, diff side, text segment).
pub const MAX_FIELD_BYTES: usize = 16 * 1024;
/// Largest trace file; past it one `{"type":"truncated"}` line ends the trace.
pub const MAX_TRACE_BYTES: usize = 2 * 1024 * 1024;

pub struct Trace {
    start: Instant,
    lines: Vec<String>,
    bytes: usize,
    /// Text being merged: (`text` | `thinking`, content, t_ms of the first delta).
    pending: Option<(&'static str, String, u64)>,
    full: bool,
}

impl Default for Trace {
    fn default() -> Self {
        Self::new()
    }
}

impl Trace {
    pub fn new() -> Self {
        Self { start: Instant::now(), lines: Vec::new(), bytes: 0, pending: None, full: false }
    }

    fn now_ms(&self) -> u64 {
        self.start.elapsed().as_millis() as u64
    }

    pub fn push(&mut self, ev: &SessionEvent) {
        match ev {
            SessionEvent::Token { text } => self.append("text", text),
            SessionEvent::Thinking { text } => self.append("thinking", text),
            _ => {
                self.flush();
                if let Ok(v) = serde_json::to_value(ev) {
                    let t = self.now_ms();
                    self.line(v, t);
                }
            }
        }
    }

    fn append(&mut self, kind: &'static str, text: &str) {
        if self.pending.as_ref().is_some_and(|(k, _, _)| *k != kind) {
            self.flush();
        }
        let t = self.now_ms();
        let (_, buf, _) = self.pending.get_or_insert_with(|| (kind, String::new(), t));
        // Keep a little over the cap so `clean` can mark the cut.
        if buf.len() <= MAX_FIELD_BYTES {
            buf.push_str(text);
        }
    }

    fn flush(&mut self) {
        if let Some((kind, text, t)) = self.pending.take() {
            self.line(json!({"type": kind, "text": text}), t);
        }
    }

    fn line(&mut self, mut v: Value, t_ms: u64) {
        if self.full {
            return;
        }
        clean(&mut v);
        if let Value::Object(m) = &mut v {
            m.insert("t_ms".into(), json!(t_ms));
        }
        let s = v.to_string();
        if self.bytes + s.len() + 1 > MAX_TRACE_BYTES {
            self.full = true;
            self.lines.push(json!({"type": "truncated", "t_ms": t_ms}).to_string());
            return;
        }
        self.bytes += s.len() + 1;
        self.lines.push(s);
    }

    /// Flush merged text and return the JSONL content.
    pub fn finish(mut self) -> String {
        self.flush();
        let mut out = self.lines.join("\n");
        if !out.is_empty() {
            out.push('\n');
        }
        out
    }
}

/// Cap and redact every string inside `v`.
fn clean(v: &mut Value) {
    match v {
        Value::String(s) => {
            let mut t = redact(s);
            if t.len() > MAX_FIELD_BYTES {
                let mut cut = MAX_FIELD_BYTES;
                while !t.is_char_boundary(cut) {
                    cut -= 1;
                }
                let dropped = t.len() - cut;
                t.truncate(cut);
                t.push_str(&format!("\n… [{dropped} bytes cut]"));
            }
            *s = t;
        }
        Value::Array(xs) => xs.iter_mut().for_each(clean),
        Value::Object(m) => m.values_mut().for_each(clean),
        _ => {}
    }
}

/// Lines of a trace file; unparsable lines are skipped. Missing file = empty.
pub fn read(path: &Path) -> Vec<Value> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(s: &str) -> Vec<String> {
        s.lines()
            .map(|l| serde_json::from_str::<Value>(l).unwrap()["type"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn trace_merges_text_and_keeps_tool_calls() {
        let mut t = Trace::new();
        t.push(&SessionEvent::Token { text: "Let me ".into() });
        t.push(&SessionEvent::Token { text: "look.".into() });
        t.push(&SessionEvent::ToolStart { call_id: "c1".into(), name: "read_file".into(), input: json!({"path": "a.py"}) });
        t.push(&SessionEvent::ToolEnd { call_id: "c1".into(), name: "read_file".into(), ok: true, output: "x = 1".into() });
        t.push(&SessionEvent::Thinking { text: "hmm".into() });
        t.push(&SessionEvent::Token { text: "Done.".into() });
        t.push(&SessionEvent::Done { stop: "end_turn".into() });
        let s = t.finish();
        assert_eq!(kinds(&s), ["text", "tool_start", "tool_end", "thinking", "text", "done"]);
        let first: Value = serde_json::from_str(s.lines().next().unwrap()).unwrap();
        assert_eq!(first["text"], "Let me look.");
        assert!(first["t_ms"].is_u64());
    }

    #[test]
    fn trace_is_redacted_and_capped() {
        let mut t = Trace::new();
        let big = "y".repeat(MAX_FIELD_BYTES * 2);
        t.push(&SessionEvent::ToolEnd {
            call_id: "c".into(),
            name: "shell".into(),
            ok: true,
            output: format!("api_key=sk-abcdefghijklmnopqrstuv\n{big}"),
        });
        let s = t.finish();
        let v: Value = serde_json::from_str(s.trim()).unwrap();
        let out = v["output"].as_str().unwrap();
        assert!(!out.contains("sk-abcdefghijklmnop"), "secret kept");
        assert!(out.len() < MAX_FIELD_BYTES + 64 && out.contains("bytes cut"));

        let mut t = Trace::new();
        for i in 0..400 {
            t.push(&SessionEvent::ToolEnd { call_id: format!("{i}"), name: "shell".into(), ok: true, output: big.clone() });
        }
        let s = t.finish();
        assert!(s.len() <= MAX_TRACE_BYTES + 64);
        assert_eq!(kinds(&s).last().map(String::as_str), Some("truncated"));
    }
}
