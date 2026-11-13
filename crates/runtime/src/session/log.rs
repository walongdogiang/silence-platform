use crate::redact::redact;
use anyhow::{anyhow, Result};
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::Value;
use silence_protocol::{LogBody, LogRecord, SessionEvent, SessionSummary, EVENT_LOG_VERSION};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use uuid::Uuid;

/// `<dir>/<session_id>/events.jsonl`. The Engine is the only writer.
pub struct SessionStore {
    dir: PathBuf,
    /// Last `seq` written per session; filled lazily from disk the first time a session is touched.
    seq: Mutex<HashMap<String, u64>>,
}

/// Session ids come from clients (`session.resume`), so only UUIDs may reach the file system.
fn check_id(id: &str) -> Result<()> {
    Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| anyhow!("invalid session id"))
}

fn redact_value(v: &mut Value) {
    match v {
        Value::String(s) => *s = redact(s),
        Value::Array(a) => a.iter_mut().for_each(redact_value),
        Value::Object(o) => o.values_mut().for_each(redact_value),
        _ => {}
    }
}

/// Parse a log file. A line that does not parse (a write cut short by a crash) is skipped.
fn read_records(path: &Path) -> Vec<LogRecord> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|l| serde_json::from_str::<LogRecord>(l).ok())
        .collect()
}

/// Events worth keeping. Streaming deltas and terminal output are noise, and a diff carries whole
/// files (the staged edit is lost on restart anyway).
pub fn persisted_event(ev: &SessionEvent) -> bool {
    !matches!(
        ev,
        SessionEvent::Token { .. }
            | SessionEvent::Thinking { .. }
            | SessionEvent::Terminal { .. }
            | SessionEvent::Diff { .. }
    )
}

impl SessionStore {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            dir,
            seq: Mutex::new(HashMap::new()),
        }
    }

    fn path(&self, id: &str) -> PathBuf {
        self.dir.join(id).join("events.jsonl")
    }

    pub async fn append(&self, session_id: &str, body: LogBody) -> Result<()> {
        check_id(session_id)?;
        let path = self.path(session_id);
        let mut seqs = self.seq.lock().await;
        let last = match seqs.get(session_id) {
            Some(n) => *n,
            None => read_records(&path).iter().map(|r| r.seq).max().unwrap_or(0),
        };
        let seq = last + 1;
        let record = LogRecord {
            v: EVENT_LOG_VERSION,
            seq,
            ts: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            session_id: session_id.to_string(),
            body,
        };
        let mut value = serde_json::to_value(&record)?;
        redact_value(&mut value);
        let mut line = serde_json::to_string(&value)?;
        line.push('\n');
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let mut f = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .await?;
        f.write_all(line.as_bytes()).await?;
        // tokio::fs buffers on a blocking thread: without flush the line can be lost on drop.
        f.flush().await?;
        seqs.insert(session_id.to_string(), seq);
        Ok(())
    }

    pub fn load(&self, session_id: &str) -> Result<Vec<LogRecord>> {
        check_id(session_id)?;
        Ok(read_records(&self.path(session_id)))
    }

    /// Newest first. Folders without a readable `session_start` are ignored.
    pub fn list(&self) -> Result<Vec<SessionSummary>> {
        let mut out = Vec::new();
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return Ok(out);
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if check_id(&name).is_err() {
                continue;
            }
            if let Some(s) = summarize(&read_records(&self.path(&name))) {
                out.push(s);
            }
        }
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(out)
    }

    /// Delete one session's log folder. The audit log is not touched. `false` = nothing there.
    pub async fn delete(&self, session_id: &str) -> Result<bool> {
        check_id(session_id)?;
        let dir = self.dir.join(session_id);
        self.seq.lock().await.remove(session_id);
        if !dir.exists() {
            return Ok(false);
        }
        std::fs::remove_dir_all(&dir)?;
        Ok(true)
    }

    /// Delete sessions whose last event is older than `cutoff`, except ids in `keep`.
    /// A log without a readable timestamp is kept. Returns the deleted ids.
    pub async fn prune(&self, cutoff: DateTime<Utc>, keep: &HashSet<String>) -> Result<Vec<String>> {
        let mut deleted = Vec::new();
        for s in self.list()? {
            if keep.contains(&s.session_id) {
                continue;
            }
            let Ok(updated) = DateTime::parse_from_rfc3339(&s.updated_at) else {
                continue;
            };
            if updated.with_timezone(&Utc) < cutoff && self.delete(&s.session_id).await? {
                deleted.push(s.session_id);
            }
        }
        Ok(deleted)
    }
}

/// Rebuild the model-visible history from the log.
pub fn replay_messages(records: &[LogRecord]) -> Vec<Value> {
    let mut messages: Vec<Value> = Vec::new();
    for r in records {
        match &r.body {
            LogBody::Message { message } => messages.push(message.clone()),
            LogBody::MessagePopped {} => {
                messages.pop();
            }
            LogBody::MessagesReplaced { messages: m } => messages = m.clone(),
            _ => {}
        }
    }
    messages
}

/// The user's words without the `<ui_context>` block the Studio appends.
fn user_text(m: &Value) -> String {
    let content = crate::images::content_text(m);
    content
        .split("\n\n<ui_context>")
        .next()
        .unwrap_or("")
        .trim()
        .to_string()
}

pub fn summarize(records: &[LogRecord]) -> Option<SessionSummary> {
    let first = records.first()?;
    let LogBody::SessionStart {
        workspace,
        mode,
        model,
        ..
    } = &first.body
    else {
        return None;
    };
    let (mut mode, mut model) = (*mode, model.clone());
    for r in records {
        match &r.body {
            LogBody::ModeChanged { mode: m } => mode = *m,
            LogBody::ModelChanged { model: m } => model = m.clone(),
            _ => {}
        }
    }
    let users: Vec<Value> = replay_messages(records)
        .into_iter()
        .filter(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
        // `view_image` results ride in user messages; they are not turns the user typed.
        .filter(|m| !crate::images::content_text(m).starts_with(crate::agent::VIEW_IMAGE_TAG))
        .collect();
    let title: String = users
        .first()
        .map(user_text)
        .unwrap_or_default()
        .lines()
        .next()
        .unwrap_or("")
        .chars()
        .take(80)
        .collect();
    Some(SessionSummary {
        session_id: first.session_id.clone(),
        workspace: workspace.clone(),
        mode,
        model,
        title,
        created_at: first.ts.clone(),
        updated_at: records.last().map(|r| r.ts.clone()).unwrap_or_default(),
        turns: users.len() as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use silence_protocol::{PermissionMode, SessionMode};

    fn start() -> LogBody {
        LogBody::SessionStart {
            workspace: "C:/w".into(),
            mode: SessionMode::Agent,
            model: "auto".into(),
            permission: PermissionMode::Ask,
        }
    }

    fn msg(role: &str, content: &str) -> LogBody {
        LogBody::Message {
            message: json!({"role": role, "content": content}),
        }
    }

    #[tokio::test]
    async fn append_then_load_roundtrip_with_increasing_seq() {
        let dir = tempfile::tempdir().unwrap();
        let store = SessionStore::new(dir.path().to_path_buf());
        let id = Uuid::new_v4().to_string();
        store.append(&id, start()).await.unwrap();
        store.append(&id, msg("user", "hi")).await.unwrap();
        let recs = store.load(&id).unwrap();
        assert_eq!(recs.len(), 2);
        assert_eq!(recs.iter().map(|r| r.seq).collect::<Vec<_>>(), vec![1, 2]);
        assert!(recs.iter().all(|r| r.v == EVENT_LOG_VERSION && r.session_id == id));
    }

    #[tokio::test]
    async fn seq_continues_after_restart() {
        let dir = tempfile::tempdir().unwrap();
        let id = Uuid::new_v4().to_string();
        let a = SessionStore::new(dir.path().to_path_buf());
        a.append(&id, start()).await.unwrap();
        a.append(&id, msg("user", "one")).await.unwrap();
        let b = SessionStore::new(dir.path().to_path_buf());
        b.append(&id, msg("user", "two")).await.unwrap();
        let seqs: Vec<u64> = b.load(&id).unwrap().iter().map(|r| r.seq).collect();
        assert_eq!(seqs, vec![1, 2, 3]);
    }

    #[tokio::test]
    async fn non_uuid_ids_never_touch_the_file_system() {
        let dir = tempfile::tempdir().unwrap();
        let store = SessionStore::new(dir.path().to_path_buf());
        for bad in ["..", "../x", "a/b", "", "not-a-uuid"] {
            assert!(store.append(bad, start()).await.is_err(), "{bad}");
            assert!(store.load(bad).is_err(), "{bad}");
        }
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn torn_last_line_is_skipped() {
        let dir = tempfile::tempdir().unwrap();
        let store = SessionStore::new(dir.path().to_path_buf());
        let id = Uuid::new_v4().to_string();
        store.append(&id, start()).await.unwrap();
        let path = dir.path().join(&id).join("events.jsonl");
        let mut text = std::fs::read_to_string(&path).unwrap();
        text.push_str("{\"v\":1,\"seq\":2,\"ts\":\"20");
        std::fs::write(&path, text).unwrap();
        assert_eq!(store.load(&id).unwrap().len(), 1);
    }

    #[tokio::test]
    async fn secrets_are_redacted_before_hitting_disk() {
        let dir = tempfile::tempdir().unwrap();
        let store = SessionStore::new(dir.path().to_path_buf());
        let id = Uuid::new_v4().to_string();
        store
            .append(&id, msg("tool", "api_key = sk-abcdefghijklmnop1234"))
            .await
            .unwrap();
        let raw = std::fs::read_to_string(dir.path().join(&id).join("events.jsonl")).unwrap();
        assert!(!raw.contains("abcdefghijklmnop"), "{raw}");
        assert_eq!(store.load(&id).unwrap().len(), 1, "line must stay valid JSON: {raw}");
    }

    #[tokio::test]
    async fn replay_applies_pop_and_replace() {
        let dir = tempfile::tempdir().unwrap();
        let store = SessionStore::new(dir.path().to_path_buf());
        let id = Uuid::new_v4().to_string();
        store.append(&id, start()).await.unwrap();
        store.append(&id, msg("system", "sys")).await.unwrap();
        store.append(&id, msg("user", "lost")).await.unwrap();
        store.append(&id, LogBody::MessagePopped {}).await.unwrap();
        store.append(&id, msg("user", "kept")).await.unwrap();
        let m = replay_messages(&store.load(&id).unwrap());
        assert_eq!(m.len(), 2);
        assert_eq!(m[1]["content"], "kept");

        store
            .append(
                &id,
                LogBody::MessagesReplaced {
                    messages: vec![json!({"role": "system", "content": "compact"})],
                },
            )
            .await
            .unwrap();
        let m = replay_messages(&store.load(&id).unwrap());
        assert_eq!(m.len(), 1);
        assert_eq!(m[0]["content"], "compact");
    }

    #[tokio::test]
    async fn list_summarizes_title_turns_and_latest_mode_newest_first() {
        let dir = tempfile::tempdir().unwrap();
        let store = SessionStore::new(dir.path().to_path_buf());
        let old = Uuid::new_v4().to_string();
        store.append(&old, start()).await.unwrap();
        store.append(&old, msg("user", "first question")).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        let new = Uuid::new_v4().to_string();
        store.append(&new, start()).await.unwrap();
        store
            .append(&new, msg("user", "Fix the bug\n\n<ui_context>\nlogs\n</ui_context>"))
            .await
            .unwrap();
        store.append(&new, msg("assistant", "ok")).await.unwrap();
        store
            .append(&new, LogBody::ModeChanged { mode: SessionMode::Plan })
            .await
            .unwrap();
        // A stray folder must not break listing.
        std::fs::create_dir(dir.path().join("junk")).unwrap();

        let list = store.list().unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].session_id, new);
        assert_eq!(list[0].title, "Fix the bug");
        assert_eq!(list[0].turns, 1);
        assert_eq!(list[0].mode, SessionMode::Plan);
        assert_eq!(list[1].title, "first question");
    }

    #[test]
    fn heavy_events_are_not_persisted() {
        assert!(!persisted_event(&SessionEvent::Token { text: "x".into() }));
        assert!(!persisted_event(&SessionEvent::Diff {
            path: "a".into(),
            before: "".into(),
            after: "".into(),
            applied: false,
        }));
        assert!(persisted_event(&SessionEvent::Done { stop: "stop".into() }));
    }

    #[tokio::test]
    async fn delete_and_prune_keep_what_they_should() {
        let dir = tempfile::tempdir().unwrap();
        let store = SessionStore::new(dir.path().to_path_buf());
        let (a, b, c) = (Uuid::new_v4().to_string(), Uuid::new_v4().to_string(), Uuid::new_v4().to_string());
        for id in [&a, &b, &c] {
            store.append(id, start()).await.unwrap();
        }
        // Everything is "now": a cutoff in the past deletes nothing.
        let past = Utc::now() - chrono::Duration::days(1);
        assert!(store.prune(past, &HashSet::new()).await.unwrap().is_empty());
        // A cutoff in the future deletes all but the kept id.
        let keep: HashSet<String> = [b.clone()].into();
        let future = Utc::now() + chrono::Duration::days(1);
        let mut gone = store.prune(future, &keep).await.unwrap();
        gone.sort();
        let mut want = vec![a.clone(), c.clone()];
        want.sort();
        assert_eq!(gone, want);
        assert_eq!(store.list().unwrap().len(), 1);
        assert!(store.delete(&b).await.unwrap());
        assert!(!store.delete(&b).await.unwrap());
        assert!(store.delete("../etc").await.is_err());
    }

}
