use crate::agent::{self, AppCtx};
use crate::audit::AuditLog;
use anyhow::{Context, Result};
use serde::Deserialize;
use silence_protocol::{PermissionMode, SessionEvent, SessionMode};
use silence_router::Catalog;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::mpsc;

#[derive(Debug, Deserialize)]
struct Manifest {
    workspace: String,
    #[serde(default)]
    verify_cmd: String,
    tasks: Vec<Task>,
}

#[derive(Debug, Deserialize)]
struct Task {
    id: String,
    kind: String,
    prompt: String,
    #[serde(default)]
    read_only: bool,
    #[serde(default)]
    plan_only: bool,
    /// Session mode for this task (agent/plan/ask/debug/review/multitask). Overrides `plan_only`.
    #[serde(default)]
    mode: Option<SessionMode>,
    #[serde(default)]
    verify_filter: Option<String>,
    pass_if: PassIf,
}

#[derive(Debug, Deserialize, Default)]
struct PassIf {
    #[serde(default)]
    grep: Vec<GrepCheck>,
    #[serde(default)]
    test: Option<String>,
    #[serde(default)]
    report_mentions: Vec<String>,
    #[serde(default)]
    plan_mentions: Vec<String>,
    /// Paths that must be byte-identical to the fixture afterwards (read-only modes).
    #[serde(default)]
    unchanged: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct GrepCheck {
    path: String,
    pattern: String,
}

pub async fn run(dir: &Path, catalog_path: &Path, repo_root: &Path) -> Result<i32> {
    let manifest_path = if dir.join("manifest.yaml").exists() {
        dir.join("manifest.yaml")
    } else {
        dir.to_path_buf()
    };
    let text = std::fs::read_to_string(&manifest_path).context("read eval manifest")?;
    let manifest: Manifest = serde_yaml::from_str(&text)?;
    let catalog = Catalog::load(catalog_path)?;
    let results_dir = repo_root.join("evals/results");
    std::fs::create_dir_all(&results_dir)?;
    let fixture = repo_root.join("evals").join(&manifest.workspace);
    let mut failed = 0;
    let mut ran = 0;
    for task in &manifest.tasks {
        ran += 1;
        let ws = results_dir.join(&task.id).join("workspace");
        if ws.exists() {
            let _ = std::fs::remove_dir_all(&ws);
        }
        copy_dir(&fixture, &ws)?;
        let audit = AuditLog::open(&results_dir.join(&task.id))?;
        let ctx = Arc::new(AppCtx::new(catalog.clone(), audit));
        let mode = if let Some(m) = task.mode {
            m
        } else if task.plan_only || task.kind == "plan" {
            SessionMode::Plan
        } else {
            SessionMode::Agent
        };
        let sid = agent::create_session(
            &ctx,
            &ws.to_string_lossy(),
            Some("auto".into()),
            mode,
            PermissionMode::Yolo,
        )
        .await?;
        let mut rx = agent::subscribe(&ctx, &sid).await;
        agent::prompt(ctx.clone(), sid.clone(), task.prompt.clone()).await?;
        let mut report = String::new();
        let mut plan = String::new();
        let ok_run = wait_done(&mut rx, &mut report, &mut plan).await;
        let passed = if !ok_run {
            false
        } else {
            check_pass(task, &ws, &fixture, &report, &plan, &manifest.verify_cmd)
        };
        println!(
            "{} {} {}",
            if passed { "PASS" } else { "FAIL" },
            task.id,
            task.kind
        );
        if !passed {
            failed += 1;
        }
        let _ = task.read_only;
    }
    println!("{}/{} passed", ran - failed, ran);
    Ok(if failed > 0 { 1 } else { 0 })
}

async fn wait_done(
    rx: &mut mpsc::UnboundedReceiver<SessionEvent>,
    report: &mut String,
    plan: &mut String,
) -> bool {
    let deadline = tokio::time::Duration::from_secs(180);
    let start = tokio::time::Instant::now();
    loop {
        if start.elapsed() > deadline {
            return false;
        }
        match tokio::time::timeout(tokio::time::Duration::from_secs(120), rx.recv()).await {
            Ok(Some(SessionEvent::Token { text })) => report.push_str(&text),
            Ok(Some(SessionEvent::Plan { markdown })) => {
                plan.push_str(&markdown);
                report.push_str(&markdown);
            }
            // Marker so a task can require the event via `report_mentions: ["[event:mode_suggestion]"]`.
            Ok(Some(SessionEvent::ModeSuggestion { .. })) => report.push_str("\n[event:mode_suggestion]\n"),
            Ok(Some(SessionEvent::Done { .. })) => return true,
            Ok(Some(SessionEvent::Error { .. })) => return false,
            Ok(Some(_)) => {}
            Ok(None) => return false,
            Err(_) => return false,
        }
    }
}

fn check_pass(
    task: &Task,
    ws: &Path,
    fixture: &Path,
    report: &str,
    plan: &str,
    verify_cmd: &str,
) -> bool {
    let hay = format!("{report}\n{plan}").to_lowercase();
    for rel in &task.pass_if.unchanged {
        if std::fs::read(ws.join(rel)).ok() != std::fs::read(fixture.join(rel)).ok() {
            return false;
        }
    }
    for g in &task.pass_if.grep {
        let path = ws.join(&g.path);
        let Ok(text) = std::fs::read_to_string(&path) else {
            return false;
        };
        let re = match regex::Regex::new(&g.pattern) {
            Ok(r) => r,
            Err(_) => return false,
        };
        if !re.is_match(&text) {
            return false;
        }
    }
    if let Some(filter) = task
        .pass_if
        .test
        .as_deref()
        .or(task.verify_filter.as_deref())
    {
        if !run_verify(ws, verify_cmd, filter) {
            return false;
        }
    }
    for n in &task.pass_if.report_mentions {
        if !hay.contains(&n.to_lowercase()) {
            return false;
        }
    }
    for n in &task.pass_if.plan_mentions {
        if !hay.contains(&n.to_lowercase()) {
            return false;
        }
    }
    true
}

fn run_verify(ws: &Path, cmd: &str, filter: &str) -> bool {
    if cmd.is_empty() {
        return true;
    }
    let mut c = std::process::Command::new("python");
    // verify_cmd is like `python -m tests.runner`
    let mut parts = cmd.split_whitespace();
    if let Some(bin) = parts.next() {
        c = std::process::Command::new(bin);
        for a in parts {
            c.arg(a);
        }
    }
    c.arg(filter).current_dir(ws);
    c.status().map(|s| s.success()).unwrap_or(false)
}

fn copy_dir(src: &Path, dst: &Path) -> Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &to)?;
        } else {
            std::fs::copy(entry.path(), to)?;
        }
    }
    Ok(())
}
