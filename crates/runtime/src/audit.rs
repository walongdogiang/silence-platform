use anyhow::Result;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub ts: String,
    pub session_id: String,
    pub kind: String,
    pub model: String,
    pub tool: String,
    pub path: String,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub usd: f64,
    pub detail: Value,
}

pub struct AuditLog {
    path: PathBuf,
    lock: Mutex<()>,
}

impl AuditLog {
    pub fn open(dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(dir)?;
        Ok(Self {
            path: dir.join("audit.jsonl"),
            lock: Mutex::new(()),
        })
    }

    /// Folder holding `audit.jsonl`; sessions live under `<dir>/sessions`.
    pub fn dir(&self) -> &Path {
        self.path.parent().unwrap_or_else(|| Path::new("."))
    }

    pub async fn append(&self, event: AuditEvent) -> Result<()> {
        let _g = self.lock.lock().await;
        let mut line = serde_json::to_string(&event)?;
        line.push('\n');
        let mut f = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .await?;
        f.write_all(line.as_bytes()).await?;
        Ok(())
    }

    pub fn query(&self, session_id: Option<&str>, limit: usize) -> Result<Vec<AuditEvent>> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        let text = std::fs::read_to_string(&self.path)?;
        let mut events: Vec<AuditEvent> = text
            .lines()
            .filter_map(|l| serde_json::from_str(l).ok())
            .filter(|e: &AuditEvent| match session_id {
                Some(id) => e.session_id == id,
                None => true,
            })
            .collect();
        if events.len() > limit {
            events = events.split_off(events.len() - limit);
        }
        Ok(events)
    }

    pub fn cost_summary(&self) -> Result<Value> {
        let events = self.query(None, 10_000)?;
        let usd: f64 = events.iter().map(|e| e.usd).sum();
        let input: u32 = events.iter().map(|e| e.input_tokens).sum();
        let output: u32 = events.iter().map(|e| e.output_tokens).sum();
        Ok(serde_json::json!({
            "events": events.len(),
            "input_tokens": input,
            "output_tokens": output,
            "usd": usd
        }))
    }
}

pub fn now_event(
    session_id: &str,
    kind: &str,
    model: &str,
    tool: &str,
    path: &str,
    input_tokens: u32,
    output_tokens: u32,
    usd: f64,
    detail: Value,
) -> AuditEvent {
    AuditEvent {
        ts: Utc::now().to_rfc3339(),
        session_id: session_id.into(),
        kind: kind.into(),
        model: model.into(),
        tool: tool.into(),
        path: path.into(),
        input_tokens,
        output_tokens,
        usd,
        detail,
    }
}
