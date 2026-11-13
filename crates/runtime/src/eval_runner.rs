use crate::agent::{self, AppCtx};
use crate::audit::AuditLog;
use crate::compact::estimate_tokens;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use silence_protocol::{PermissionMode, SessionEvent, SessionMode};
use silence_router::Catalog;
use std::collections::BTreeMap;
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
    /// Model id for the session (default `auto`), e.g. `claude-sonnet@api` to exercise one source.
    #[serde(default)]
    model: Option<String>,
    /// Session effort (`auto` default).
    #[serde(default)]
    effort: Option<String>,
    /// Env vars the task needs (e.g. `ANTHROPIC_API_KEY`); the task is skipped when one is unset.
    #[serde(default)]
    requires_env: Vec<String>,
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
    /// Regexes that must match some line of the task's `audit.jsonl` (e.g. `tool\.blocked`).
    #[serde(default)]
    audit_matches: Vec<String>,
    /// Regexes that must match no line of `audit.jsonl` (e.g. an executed blocked command).
    #[serde(default)]
    audit_absent: Vec<String>,
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
    let mut all_metrics: Vec<TaskMetrics> = Vec::new();
    for task in &manifest.tasks {
        if let Some(missing) = task
            .requires_env
            .iter()
            .find(|k| std::env::var(k.as_str()).map(|v| v.is_empty()).unwrap_or(true))
        {
            println!("SKIP {} ({missing} not set)", task.id);
            continue;
        }
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
            Some(task.model.clone().unwrap_or_else(|| "auto".into())),
            mode,
            PermissionMode::Yolo,
        )
        .await?;
        if let Some(e) = &task.effort {
            agent::set_effort(&ctx, &sid, e).await?;
        }
        // Base context (system + rules + tool schemas): only used when the provider
        // returns no usage and input tokens have to be estimated.
        let base = agent::context_usage(&ctx, &sid, None, None)
            .await
            .map(|u| u.used as u64)
            .unwrap_or(0);
        let mut metrics = TaskMetrics::new(&task.id, &task.kind);
        metrics.start_context(base + estimate_tokens(&task.prompt) as u64);
        let mut rx = agent::subscribe(&ctx, &sid).await;
        agent::prompt(ctx.clone(), sid.clone(), task.prompt.clone()).await?;
        let mut report = String::new();
        let mut plan = String::new();
        let ok_run = wait_done(&mut rx, &mut report, &mut plan, &mut metrics).await;
        metrics.finish();
        let passed = if !ok_run {
            false
        } else {
            let audit_text = std::fs::read_to_string(results_dir.join(&task.id).join("audit.jsonl")).unwrap_or_default();
            check_pass(task, &ws, &fixture, &report, &plan, &manifest.verify_cmd)
                && audit_pass(&task.pass_if, &audit_text)
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
        metrics.passed = passed;
        all_metrics.push(metrics);
        let _ = task.read_only;
    }
    println!("{}/{} passed", ran - failed, ran);
    let summary = RunMetrics::new(all_metrics);
    println!();
    print!("{}", summary.table());
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let out = results_dir.join(format!("metrics-{stamp}.json"));
    std::fs::write(&out, serde_json::to_string_pretty(&summary)?)?;
    println!("metrics: {}", out.display());
    Ok(if failed > 0 { 1 } else { 0 })
}

async fn wait_done(
    rx: &mut mpsc::UnboundedReceiver<SessionEvent>,
    report: &mut String,
    plan: &mut String,
    metrics: &mut TaskMetrics,
) -> bool {
    let deadline = tokio::time::Duration::from_secs(180);
    let start = tokio::time::Instant::now();
    loop {
        if start.elapsed() > deadline {
            return false;
        }
        let ev = tokio::time::timeout(tokio::time::Duration::from_secs(120), rx.recv()).await;
        if let Ok(Some(e)) = &ev {
            metrics.observe(e);
        }
        match ev {
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

/// Per-task numbers collected from `SessionEvent`s (no change to the agent loop needed).
///
/// Tokens come from `SessionEvent::Cost` (the provider's usage, see `gateway::ChatResult`).
/// When a model call reports 0/0 the provider sent no usage: input is then estimated as the
/// running context size (base + everything streamed so far, chars/4) and output as the text
/// plus tool-call arguments of that call; such calls are counted in `estimated_calls`.
#[derive(Debug, Clone, Default, Serialize)]
pub struct TaskMetrics {
    pub id: String,
    pub kind: String,
    pub passed: bool,
    pub model_calls: u32,
    pub estimated_calls: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub tool_calls: u32,
    pub tool_calls_by_name: BTreeMap<String, u32>,
    pub tool_output_bytes: u64,
    /// `SessionEvent::Error` of the task (already secret-filtered by the Engine).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Estimated size of the next request (chars/4), for calls without usage.
    #[serde(skip)]
    context_est: u64,
    /// Text streamed since the last `Cost` (output of the *next* call to report).
    #[serde(skip)]
    text_since_cost: u64,
    /// Tool-call args seen since the last `Cost` (output of the *previous* call).
    #[serde(skip)]
    args_since_cost: u64,
    /// The previous call reported no usage: its tool-call args still count as its output.
    #[serde(skip)]
    prev_call_estimated: bool,
}

impl TaskMetrics {
    pub fn new(id: &str, kind: &str) -> Self {
        Self {
            id: id.into(),
            kind: kind.into(),
            ..Default::default()
        }
    }

    /// Estimated tokens of the first request (system + rules + tools + prompt).
    pub fn start_context(&mut self, tokens: u64) {
        self.context_est = tokens;
    }

    pub fn observe(&mut self, ev: &SessionEvent) {
        match ev {
            SessionEvent::Token { text } => {
                let t = estimate_tokens(text) as u64;
                self.context_est += t;
                self.text_since_cost += t;
            }
            // `run_turn` emits Cost after the call's text streamed and before its tools run.
            SessionEvent::Cost {
                input_tokens,
                output_tokens,
                ..
            } => {
                self.close_prev_call();
                self.model_calls += 1;
                let text = std::mem::take(&mut self.text_since_cost);
                if *input_tokens == 0 && *output_tokens == 0 {
                    self.estimated_calls += 1;
                    self.input_tokens += self.context_est.saturating_sub(text);
                    self.output_tokens += text;
                    self.prev_call_estimated = true;
                } else {
                    self.input_tokens += *input_tokens as u64;
                    self.output_tokens += *output_tokens as u64;
                }
            }
            SessionEvent::ToolStart { input, .. } => {
                let t = estimate_tokens(&input.to_string()) as u64;
                self.context_est += t;
                self.args_since_cost += t;
            }
            SessionEvent::ToolEnd { name, output, .. } => {
                self.tool_calls += 1;
                *self.tool_calls_by_name.entry(name.clone()).or_default() += 1;
                self.tool_output_bytes += output.len() as u64;
                self.context_est += estimate_tokens(output) as u64;
            }
            SessionEvent::Error { message, error } => {
                let code = error.as_ref().map(|e| e.code.as_str()).unwrap_or("ERROR");
                self.error = Some(format!("{code}: {message}"));
            }
            _ => {}
        }
    }

    /// Flush the estimated output of the last call without usage.
    pub fn finish(&mut self) {
        self.close_prev_call();
    }

    fn close_prev_call(&mut self) {
        let args = std::mem::take(&mut self.args_since_cost);
        if std::mem::take(&mut self.prev_call_estimated) {
            self.output_tokens += args;
        }
    }

    fn add(&mut self, o: &TaskMetrics) {
        self.model_calls += o.model_calls;
        self.estimated_calls += o.estimated_calls;
        self.input_tokens += o.input_tokens;
        self.output_tokens += o.output_tokens;
        self.tool_calls += o.tool_calls;
        self.tool_output_bytes += o.tool_output_bytes;
        for (k, v) in &o.tool_calls_by_name {
            *self.tool_calls_by_name.entry(k.clone()).or_default() += v;
        }
    }
}

/// Whole-run summary, written to `evals/results/metrics-<time>.json`.
#[derive(Debug, Clone, Serialize)]
pub struct RunMetrics {
    pub tasks: Vec<TaskMetrics>,
    pub total: TaskMetrics,
}

impl RunMetrics {
    pub fn new(tasks: Vec<TaskMetrics>) -> Self {
        let mut total = TaskMetrics::new("TOTAL", "");
        total.passed = tasks.iter().all(|t| t.passed);
        for t in &tasks {
            total.add(t);
        }
        Self { tasks, total }
    }

    pub fn table(&self) -> String {
        let row = |a: &str, b: &str, c: &str, d: &str, e: &str, f: &str, g: &str, h: &str| {
            format!("{a:<28} {b:>4} {c:>6} {d:>10} {e:>9} {f:>6} {g:>11}  {h}\n")
        };
        let mut s = row(
            "task", "ok", "calls", "in_tok", "out_tok", "tools", "tool_bytes", "tools_by_name",
        );
        for t in self.tasks.iter().chain(std::iter::once(&self.total)) {
            let calls = if t.estimated_calls > 0 {
                format!("{}~{}", t.model_calls, t.estimated_calls)
            } else {
                t.model_calls.to_string()
            };
            let by_name = t
                .tool_calls_by_name
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join(" ");
            s.push_str(&row(
                &t.id,
                if t.passed { "PASS" } else { "FAIL" },
                &calls,
                &t.input_tokens.to_string(),
                &t.output_tokens.to_string(),
                &t.tool_calls.to_string(),
                &t.tool_output_bytes.to_string(),
                &by_name,
            ));
        }
        for t in self.tasks.iter().filter(|t| t.error.is_some()) {
            let e = t.error.as_deref().unwrap_or_default();
            s.push_str(&format!("  {} error: {}\n", t.id, e.chars().take(160).collect::<String>()));
        }
        if self.total.estimated_calls > 0 {
            s.push_str("(calls N~M: M calls had no provider usage, their tokens are chars/4 estimates)\n");
        }
        s
    }
}

/// `audit_matches` must each hit a line; `audit_absent` must hit none. Bad regex = fail.
fn audit_pass(p: &PassIf, audit: &str) -> bool {
    let hit = |pat: &str| match regex::Regex::new(pat) {
        Ok(re) => Some(audit.lines().any(|l| re.is_match(l))),
        Err(_) => None,
    };
    p.audit_matches.iter().all(|pat| hit(pat) == Some(true))
        && p.audit_absent.iter().all(|pat| hit(pat) == Some(false))
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn cost(i: u32, o: u32) -> SessionEvent {
        SessionEvent::Cost {
            input_tokens: i,
            output_tokens: o,
            usd: 0.0,
            slot: String::new(),
            baseline_usd: 0.0,
        }
    }

    fn tool(name: &str, out: &str) -> [SessionEvent; 2] {
        [
            SessionEvent::ToolStart {
                call_id: "c".into(),
                name: name.into(),
                input: json!({"path": "a.rs"}),
            },
            SessionEvent::ToolEnd {
                call_id: "c".into(),
                name: name.into(),
                ok: true,
                output: out.into(),
            },
        ]
    }

    #[test]
    fn audit_checks_match_real_audit_lines() {
        let line = |kind: &str, codes: &[&str]| {
            serde_json::to_string(&crate::audit::now_event(
                "s", kind, "", "shell", "", 0, 0, 0.0,
                serde_json::json!({"ok": true, "tier": "logged", "codes": codes}),
            ))
            .unwrap()
        };
        let audit = format!("{}\n{}", line("tool", &["BUILD_TEST"]), line("tool.blocked", &["NET_DOWNLOAD_EXEC"]));
        let p = PassIf {
            audit_matches: vec![r#""kind":"tool",.*"tool":"shell".*"codes":\[[^\]]*"BUILD_TEST""#.into()],
            audit_absent: vec![r#""kind":"tool",.*"codes":\[[^\]]*"NET_DOWNLOAD_EXEC""#.into()],
            ..Default::default()
        };
        assert!(audit_pass(&p, &audit), "{audit}");
        let executed = line("tool", &["NET_DOWNLOAD_EXEC"]);
        assert!(!audit_pass(&p, &format!("{audit}\n{executed}")));
    }

    #[test]
    fn sums_provider_usage_and_tools() {
        let mut m = TaskMetrics::new("t1", "edit");
        m.start_context(1000);
        m.observe(&cost(1200, 50));
        for e in tool("grep", "hello").iter().chain(tool("read", "0123456789").iter()) {
            m.observe(e);
        }
        m.observe(&cost(1500, 30));
        for e in &tool("grep", "x") {
            m.observe(e);
        }
        m.observe(&SessionEvent::Token { text: "done".into() });
        m.observe(&cost(1600, 10));
        m.observe(&SessionEvent::Done { stop: "stop".into() });
        m.finish();
        assert_eq!(m.model_calls, 3);
        assert_eq!(m.estimated_calls, 0);
        assert_eq!(m.input_tokens, 4300);
        assert_eq!(m.output_tokens, 90);
        assert_eq!(m.tool_calls, 3);
        assert_eq!(m.tool_calls_by_name["grep"], 2);
        assert_eq!(m.tool_calls_by_name["read"], 1);
        assert_eq!(m.tool_output_bytes, 16);
    }

    #[test]
    fn estimates_when_provider_sends_no_usage() {
        let mut m = TaskMetrics::new("t2", "ask");
        m.start_context(100);
        let args = estimate_tokens(&json!({"path": "a.rs"}).to_string()) as u64;
        // Call 1: no text, one tool call; tool output 400 bytes (~100 tok).
        m.observe(&cost(0, 0));
        for e in &tool("read", &"x".repeat(400)) {
            m.observe(e);
        }
        // Call 2: streams 40 chars (~10 tok), then reports no usage.
        m.observe(&SessionEvent::Token { text: "y".repeat(40) });
        m.observe(&cost(0, 0));
        m.finish();
        assert_eq!(m.model_calls, 2);
        assert_eq!(m.estimated_calls, 2);
        // Input: 100 (call 1) + 100 + args + 100 (call 2; its own streamed text excluded).
        assert_eq!(m.input_tokens, 100 + 100 + args + 100);
        // Output: tool-call args (call 1) + 10 (call 2).
        assert_eq!(m.output_tokens, args + 10);
        assert_eq!(m.tool_output_bytes, 400);
    }

    #[test]
    fn run_totals_table_and_json() {
        let mut a = TaskMetrics::new("a", "edit");
        a.passed = true;
        a.observe(&cost(10, 2));
        for e in &tool("grep", "abc") {
            a.observe(e);
        }
        let mut b = TaskMetrics::new("b", "ask");
        b.observe(&SessionEvent::Error {
            message: "rate limited".into(),
            error: None,
        });
        assert_eq!(b.error.as_deref(), Some("ERROR: rate limited"));
        b.observe(&cost(20, 3));
        for e in &tool("outline", "abcd") {
            b.observe(e);
        }
        let run = RunMetrics::new(vec![a, b]);
        assert!(!run.total.passed);
        assert_eq!(run.total.input_tokens, 30);
        assert_eq!(run.total.output_tokens, 5);
        assert_eq!(run.total.tool_calls, 2);
        assert_eq!(run.total.tool_output_bytes, 7);
        assert_eq!(run.total.tool_calls_by_name.len(), 2);
        let table = run.table();
        assert!(table.contains("TOTAL"));
        assert!(table.contains("outline=1"));
        let js = serde_json::to_value(&run).unwrap();
        assert_eq!(js["total"]["input_tokens"], 30);
        assert!(js["tasks"][0].get("context_est").is_none());
    }
}
