//! Eval runner: `silence-engine evals --dir evals/<suite>`. Hướng dẫn: `evals/README.md`.
//!
//! Each task runs on a fresh copy of the suite fixture with a pinned model (see
//! [`Suite::model_for`]); results land in `evals/results/` (gitignored) and, with `--history`,
//! one line in `evals/history/runs.jsonl` (committed; see `eval_history`).

use crate::agent::{self, AppCtx};
use crate::audit::AuditLog;
use crate::compact::estimate_tokens;
use crate::eval_history;
use crate::eval_trace::Trace;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use silence_protocol::{PermissionMode, SessionEvent, SessionMode};
use silence_router::Catalog;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

/// Set to stop a run: no new task starts and the running attempt is aborted.
pub type CancelFlag = Arc<AtomicBool>;

/// Per-attempt settings that are not part of the task: the source to run on, an effort
/// override, and the cancel flag.
#[derive(Debug, Clone, Default)]
pub struct AttemptOpts {
    /// Provider an `auto` task routes within (`session.set_model` source).
    pub source: Option<String>,
    /// Overrides the task's `effort`.
    pub effort: Option<String>,
    pub cancel: CancelFlag,
    /// USD left under `--max-cost`: the attempt is aborted once it has spent this much.
    pub cost_cap: Option<f64>,
}

/// Progress of a run, for the CLI printer and Studio (`eval.progress`).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EvalProgress {
    Started { run_id: String, suite: String, tasks: Vec<String> },
    TaskStarted { id: String, model: String, attempt: u32 },
    Skipped { id: String, model: String, reason: String },
    TaskDone { task: TaskMetrics },
    Finished { summary: Box<RunMetrics> },
    /// The run could not start or crashed (bad suite, IO error…).
    Failed { message: String },
}

/// Model for tasks with no pin anywhere: the cheapest tier (budget < $10/month).
pub const DEFAULT_MODEL: &str = "claude-haiku";
/// Pin value for a task no model in the ladder could pass; such tasks are skipped.
pub const UNSOLVED: &str = "unsolved";

#[derive(Debug, Deserialize)]
pub(crate) struct Manifest {
    workspace: String,
    #[serde(default)]
    verify_cmd: String,
    pub(crate) tasks: Vec<Task>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct Task {
    pub(crate) id: String,
    pub(crate) kind: String,
    prompt: String,
    #[serde(default)]
    plan_only: bool,
    /// Session mode for this task (agent/plan/ask/debug/review/multitask). Overrides `plan_only`.
    #[serde(default)]
    mode: Option<SessionMode>,
    #[serde(default)]
    verify_filter: Option<String>,
    /// Model fixed by the task author (e.g. `claude-sonnet@api` to exercise one source, or
    /// `auto` to test the router). Wins over `models.yaml`; calibration leaves it alone.
    #[serde(default)]
    pub(crate) model: Option<String>,
    /// Session effort (`auto` default).
    #[serde(default)]
    effort: Option<String>,
    /// Answer style (`default` | `concise` | `explanatory`), as Settings → Chat sets it.
    #[serde(default)]
    style: Option<String>,
    /// Env vars the task needs (e.g. `ANTHROPIC_API_KEY`); the task is skipped when one is unset.
    #[serde(default)]
    requires_env: Vec<String>,
    /// Permission mode of the session (default `yolo`: evals never prompt). `autonomous` runs
    /// the sandbox path: commands the sandbox contains run without asking, the rest asks.
    #[serde(default)]
    permission: Option<PermissionMode>,
    /// The task is skipped (not failed) unless the command sandbox is installed and Ready.
    #[serde(default)]
    requires_sandbox: bool,
    /// Answer to every permission card: `approve` or `deny` (default). Cards are recorded in
    /// the audit as `eval.asked` with their codes, so `audit_matches` can require / forbid them.
    #[serde(default)]
    on_ask: Option<String>,
    /// Efficiency guard: the attempt is aborted and fails once the agent goes over it.
    #[serde(default)]
    budget: Budget,
    pass_if: PassIf,
}

/// Per-task efficiency limits (manifest `budget:`). Like CursorBench reporting steps and tokens
/// next to correctness: a task that passes but takes 3× the calls is a regression too.
#[derive(Debug, Deserialize, Default, Clone, Copy)]
pub(crate) struct Budget {
    /// Model calls (agent steps, side calls included) allowed for one attempt.
    #[serde(default)]
    max_turns: Option<u32>,
    /// Input tokens (cached included) allowed for one attempt.
    #[serde(default)]
    max_input_tokens: Option<u64>,
}

/// `error_code` of an attempt aborted because the run's `--max-cost` was reached mid-task.
pub const MAX_COST_CODE: &str = "EVAL_MAX_COST";
/// Failed this many judged runs in a row (history): `--retry-failed` does not retry it.
pub const STABLE_FAIL_RUNS: usize = 3;

impl Task {
    /// Session mode the task runs in (`mode`, else Plan for plan tasks, else Agent).
    pub fn session_mode(&self) -> SessionMode {
        if let Some(m) = self.mode {
            m
        } else if self.plan_only || self.kind == "plan" {
            SessionMode::Plan
        } else {
            SessionMode::Agent
        }
    }

    /// Effort fixed by the task (`auto` when unset).
    pub fn effort(&self) -> Option<&str> {
        self.effort.as_deref()
    }

    /// First env var in `requires_env` that is unset or empty.
    pub(crate) fn missing_env(&self) -> Option<&str> {
        self.requires_env
            .iter()
            .find(|k| std::env::var(k.as_str()).map(|v| v.is_empty()).unwrap_or(true))
            .map(|s| s.as_str())
    }
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
    /// The final report must be at most this many characters (answer-style tasks).
    #[serde(default)]
    max_report_chars: Option<usize>,
    /// The final report must be written in this language (`vi` | `en`), as `lang::detect`
    /// reads it.
    #[serde(default)]
    report_lang: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GrepCheck {
    path: String,
    pattern: String,
}

/// `<suite>/models.yaml`: task id → pinned model, written by `evals-calibrate`.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct ModelPins {
    #[serde(default)]
    pub models: BTreeMap<String, String>,
}

impl ModelPins {
    pub fn load(path: &Path) -> Result<Self> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let text = std::fs::read_to_string(path).context("read models.yaml")?;
        Ok(serde_yaml::from_str::<Option<Self>>(&text)?.unwrap_or_default())
    }

    pub fn save(&self, path: &Path) -> Result<()> {
        let body = serde_yaml::to_string(self)?;
        let text = format!(
            "# Model đã ghim cho từng task. Sinh bởi `npm run evals:calibrate`; lý do ở evals/DECISIONS.md.\n\
             # `unsolved` = không model nào qua được: task bị bỏ qua cho tới khi sửa task/harness.\n\
             # Task có `model:` trong manifest thì manifest thắng (không ghi ở đây).\n{body}"
        );
        std::fs::write(path, text).context("write models.yaml")
    }
}

/// Model precedence: `--model` → `model:` in the manifest → `models.yaml` → [`DEFAULT_MODEL`].
/// `None` = the pin is [`UNSOLVED`] and nothing overrides it: skip the task.
pub fn resolve_model(cli: Option<&str>, task: Option<&str>, pinned: Option<&str>) -> Option<String> {
    if let Some(m) = cli.or(task) {
        return Some(m.to_string());
    }
    match pinned {
        Some(UNSOLVED) => None,
        Some(m) => Some(m.to_string()),
        None => Some(DEFAULT_MODEL.to_string()),
    }
}

/// Outcome of one task (or one attempt).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Status {
    Pass,
    #[default]
    Fail,
    /// The model could not be reached (credits, key, network…): not the agent's fault.
    Error,
    Skip,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Status::Pass => "PASS",
            Status::Fail => "FAIL",
            Status::Error => "ERROR",
            Status::Skip => "SKIP",
        }
    }
}

/// Error codes (`ErrorInfo.code`) meaning the model could not be reached.
pub fn is_infra_error(code: &str) -> bool {
    matches!(
        code,
        "PROVIDER_CREDITS"
            | "PROVIDER_AUTH"
            | "PROVIDER_RATE"
            | "PROVIDER_UNAVAILABLE"
            | "NETWORK"
            | "TIMEOUT"
            | "CLI_NOT_FOUND"
            | "CLI_AUTH"
            | "CLI_LIMIT"
            | MAX_COST_CODE
    )
}

/// Infra errors every later task would hit too: stop the run instead of burning through it.
pub fn is_fatal_error(code: &str) -> bool {
    matches!(code, "PROVIDER_CREDITS" | "PROVIDER_AUTH" | "CLI_NOT_FOUND" | "CLI_AUTH" | "CLI_LIMIT" | MAX_COST_CODE)
}

/// Status of one attempt: infra error code → `Error`, else pass/fail by the checks.
pub fn attempt_status(passed: bool, error_code: Option<&str>) -> Status {
    if error_code.is_some_and(is_infra_error) {
        Status::Error
    } else if passed {
        Status::Pass
    } else {
        Status::Fail
    }
}

/// Options of `silence-engine evals`.
#[derive(Debug, Clone)]
pub struct RunOptions {
    /// Override the model of every task.
    pub model: Option<String>,
    /// Run only these task ids (empty = all).
    pub only: Vec<String>,
    /// Run only tasks whose resolved model is this one (nightly: `claude-haiku`).
    pub pinned: Option<String>,
    /// Attempts per task; the task passes only if every attempt passes.
    pub repeat: u32,
    /// One extra attempt for a failed task; a pass then marks it `flaky` (not failed).
    pub retry_failed: bool,
    /// Stop starting attempts once this much (USD) has been spent.
    pub max_cost: Option<f64>,
    /// Append the run to `evals/history/runs.jsonl` and regenerate `SUMMARY.md`.
    pub history: bool,
    /// Label stored in history (`manual`, `nightly`, `weekly`…).
    pub profile: String,
    /// Run every task on this source (same model family or tier there; `auto` routes within it).
    pub source: Option<String>,
    /// Effort for every task (overrides the manifest's `effort`).
    pub effort: Option<String>,
    /// Least recently run tasks first (from history), so a run cut short by `--max-cost`
    /// does not always skip the same tail of the manifest (nightly).
    pub rotate: bool,
    /// Only tasks a change since this commit can affect (`evals/affects.yaml`, CLI only).
    pub affected_since: Option<String>,
}

impl Default for RunOptions {
    fn default() -> Self {
        Self {
            model: None,
            only: Vec::new(),
            pinned: None,
            repeat: 1,
            retry_failed: false,
            max_cost: None,
            history: false,
            profile: "manual".into(),
            source: None,
            effort: None,
            rotate: false,
            affected_since: None,
        }
    }
}

/// A loaded suite: manifest, pins, catalog and paths.
pub struct Suite {
    pub(crate) name: String,
    pub(crate) manifest: Manifest,
    pub(crate) pins: ModelPins,
    pub(crate) pins_path: PathBuf,
    catalog: Catalog,
    pub(crate) results_dir: PathBuf,
    pub(crate) fixture: PathBuf,
    pub(crate) repo_root: PathBuf,
}

impl Suite {
    pub(crate) fn load(dir: &Path, catalog_path: &Path, repo_root: &Path) -> Result<Self> {
        let manifest_path = if dir.join("manifest.yaml").exists() {
            dir.join("manifest.yaml")
        } else {
            dir.to_path_buf()
        };
        let suite_dir = manifest_path.parent().unwrap_or(Path::new(".")).to_path_buf();
        let name = suite_dir
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "suite".into());
        let text = std::fs::read_to_string(&manifest_path).context("read eval manifest")?;
        let manifest: Manifest = serde_yaml::from_str(&text)?;
        let pins_path = suite_dir.join("models.yaml");
        let pins = ModelPins::load(&pins_path)?;
        let catalog = Catalog::load(catalog_path)?;
        let results_dir = repo_root.join("evals/results");
        std::fs::create_dir_all(&results_dir)?;
        let fixture = repo_root.join("evals").join(&manifest.workspace);
        Ok(Self {
            name,
            manifest,
            pins,
            pins_path,
            catalog,
            results_dir,
            fixture,
            repo_root: repo_root.to_path_buf(),
        })
    }

    /// Model a run will use for `task`: [`Suite::model_for`], then moved to `source` (same
    /// family or tier there). `Err` = the task would be skipped, with the reason.
    pub(crate) fn planned_model(&self, task: &Task, cli: Option<&str>, source: Option<&str>) -> std::result::Result<String, String> {
        let model = self
            .model_for(task, cli)
            .ok_or_else(|| "unsolved: chưa model nào qua được".to_string())?;
        match source {
            Some(src) => self.catalog.same_model_on(src, &model).map_err(|e| format!("{e}")),
            None => Ok(model),
        }
    }

    /// `model` moved to `source` (same family or tier there); `None` = unchanged.
    pub(crate) fn model_on(&self, model: &str, source: Option<&str>) -> std::result::Result<String, String> {
        match source {
            Some(src) => self.catalog.same_model_on(src, model).map_err(|e| format!("{e}")),
            None => Ok(model.to_string()),
        }
    }

    pub(crate) fn model_for(&self, task: &Task, cli: Option<&str>) -> Option<String> {
        resolve_model(
            cli,
            task.model.as_deref(),
            self.pins.models.get(&task.id).map(|s| s.as_str()),
        )
    }

    /// Attempt `n` (1-based) of `task` on `model`, in `results/<id>/attempt-<n>/` (workspace,
    /// audit, report). Attempt 1 clears `results/<id>/`, so a task keeps only its latest run, but
    /// every attempt of that run (a failed one in the middle of `--repeat` stays inspectable).
    pub(crate) async fn attempt(&self, task: &Task, model: &str, n: u32, opts: &AttemptOpts) -> Result<TaskMetrics> {
        let root = self.results_dir.join(&task.id);
        if n <= 1 && root.exists() {
            // Old audit lines would leak into `audit_matches` / `audit_absent`.
            let _ = std::fs::remove_dir_all(&root);
        }
        let task_dir = attempt_dir(&self.results_dir, &task.id, n.max(1));
        let ws = task_dir.join("workspace");
        copy_dir(&self.fixture, &ws)?;
        let audit = AuditLog::open(&task_dir)?;
        let ctx = Arc::new(AppCtx::new(self.catalog.clone(), audit));
        let mode = task.session_mode();
        let effort = opts.effort.clone().or_else(|| task.effort.clone());
        let started = std::time::Instant::now();
        let mut metrics = TaskMetrics::new(&task.id, &task.kind);
        metrics.model = model.to_string();
        metrics.effort = effort.clone().unwrap_or_else(|| "auto".into());
        let sid = agent::create_session(
            &ctx,
            &ws.to_string_lossy(),
            Some(model.to_string()),
            mode,
            task.permission.unwrap_or(PermissionMode::Yolo),
        )
        .await?;
        if model == "auto" {
            if let Some(src) = &opts.source {
                // Auto on the chosen source (the CLI included).
                agent::set_model(&ctx, &sid, "auto", Some(src)).await?;
            }
        }
        if let Some(e) = &effort {
            agent::set_effort(&ctx, &sid, e).await?;
        }
        if let Some(s) = &task.style {
            agent::set_style(&ctx, &sid, s).await?;
        }
        // Base context (system + rules + tool schemas): only used when the provider
        // returns no usage and input tokens have to be estimated.
        let base = agent::context_usage(&ctx, &sid, None, None)
            .await
            .map(|u| u.used as u64)
            .unwrap_or(0);
        metrics.start_context(base + estimate_tokens(&task.prompt) as u64);
        let mut rx = agent::subscribe(&ctx, &sid).await;
        agent::prompt(ctx.clone(), sid.clone(), task.prompt.clone()).await?;
        let mut report = String::new();
        let mut plan = String::new();
        let approve = task.on_ask.as_deref() == Some("approve");
        let mut trace = Trace::new();
        let limits = Limits { budget: task.budget, cost_cap: opts.cost_cap };
        let ok_run = wait_done(&mut rx, &mut report, &mut plan, &mut metrics, &mut trace, &opts.cancel, &limits, &ctx, &sid, approve).await;
        metrics.finish();
        let _ = std::fs::write(task_dir.join("report.md"), &report);
        let _ = std::fs::write(task_dir.join("trace.jsonl"), trace.finish());
        if opts.cancel.load(Ordering::Relaxed) {
            metrics.status = Status::Skip;
            metrics.error = Some("cancelled".into());
            metrics.attempts = 1;
            metrics.duration_secs = started.elapsed().as_secs_f64();
            return Ok(metrics);
        }
        // Every check runs (even after a failed run) so the UI can say what went wrong.
        let audit_text = std::fs::read_to_string(task_dir.join("audit.jsonl")).unwrap_or_default();
        let mut checks = Vec::new();
        if !ok_run {
            checks.push(CheckResult::fail("run", "", metrics.error.as_deref().unwrap_or("the agent did not finish the turn")));
        }
        checks.extend(check_all(task, &ws, &self.fixture, &report, &plan, &self.manifest.verify_cmd));
        checks.extend(audit_checks(&task.pass_if, &audit_text));
        if let Ok(j) = serde_json::to_string_pretty(&checks) {
            let _ = std::fs::write(task_dir.join("checks.json"), j);
        }
        let passed = ok_run && checks.iter().all(|c| c.ok);
        metrics.status = attempt_status(passed, metrics.error_code.as_deref());
        metrics.attempts = 1;
        metrics.passes = u32::from(metrics.status == Status::Pass);
        metrics.errors = u32::from(metrics.status == Status::Error);
        metrics.duration_secs = started.elapsed().as_secs_f64();
        let catalog = &self.catalog;
        metrics.finalize_cost(|m| catalog.resolve(m).ok().map(|e| (e.input_cost_per_1m, e.output_cost_per_1m)));
        Ok(metrics)
    }
}

/// Run metadata stored with every run (metrics JSON and history line).
#[derive(Debug, Clone, Default, Serialize)]
pub struct RunMeta {
    pub run_id: String,
    pub started_at: String,
    pub git_sha: String,
    pub suite: String,
    pub profile: String,
    pub repeat: u32,
}

impl RunMeta {
    pub fn now(suite: &str, profile: &str, repeat: u32, repo_root: &Path) -> Self {
        let now = chrono::Local::now();
        Self {
            run_id: now.format("%Y%m%d-%H%M%S").to_string(),
            started_at: now.to_rfc3339(),
            git_sha: git_sha(repo_root),
            suite: suite.into(),
            profile: profile.into(),
            repeat,
        }
    }
}

/// `results/<task id>/attempt-<n>/`.
pub fn attempt_dir(results_dir: &Path, task_id: &str, n: u32) -> PathBuf {
    results_dir.join(task_id).join(format!("attempt-{n}"))
}

fn git_sha(repo_root: &Path) -> String {
    std::process::Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .current_dir(repo_root)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("GITHUB_SHA").ok().map(|s| s.chars().take(7).collect()))
        .unwrap_or_else(|| "unknown".into())
}

fn skipped(task: &Task, model: &str, reason: String) -> TaskMetrics {
    let mut m = TaskMetrics::new(&task.id, &task.kind);
    m.model = model.into();
    m.status = Status::Skip;
    m.error = Some(reason);
    m
}

pub async fn run(dir: &Path, catalog_path: &Path, repo_root: &Path, opts: &RunOptions) -> Result<i32> {
    let suite = Suite::load(dir, catalog_path, repo_root)?;
    let mut opts = opts.clone();
    if let Some(since) = &opts.affected_since {
        match affected_tasks(&suite, repo_root, since, &opts.only) {
            Ok(ids) if ids.is_empty() => {
                println!("không có thay đổi liên quan tới bộ {} kể từ {since}: không chạy task nào", suite.name);
                return Ok(0);
            }
            Ok(ids) => {
                println!("thay đổi kể từ {since} ảnh hưởng {} task: {}", ids.len(), ids.join(","));
                opts.only = ids;
            }
            // Unknown commit (force-push, shallow clone…): run what was asked rather than skip.
            Err(e) => println!("không xác định được thay đổi ({e:#}); chạy như không có --affected-since"),
        }
    }
    let cancel = CancelFlag::default();
    let summary = run_with(&suite, &opts, &cancel, &mut print_progress).await?;
    finish_run(&summary, repo_root, opts.history)
}

/// Ids of the suite's tasks (within `only` when given) that files changed since `since` affect.
fn affected_tasks(suite: &Suite, repo_root: &Path, since: &str, only: &[String]) -> Result<Vec<String>> {
    let affects = crate::eval_affects::Affects::load(&repo_root.join("evals/affects.yaml"))?;
    let changed = crate::eval_affects::changed_files(repo_root, since)?;
    let sel = affects.select(&changed)?;
    Ok(suite
        .manifest
        .tasks
        .iter()
        .map(|t| t.id.clone())
        .filter(|id| only.is_empty() || only.contains(id))
        .filter(|id| sel.keeps(id))
        .collect())
}

/// CLI output of a run (same lines as before the progress callback existed).
pub fn print_progress(p: EvalProgress) {
    match p {
        EvalProgress::Skipped { id, reason, .. } => println!("SKIP {id} ({reason})"),
        EvalProgress::TaskDone { task: t } => println!(
            "{} {} {} {} {}/{}{} ${:.4}",
            t.status.as_str(),
            t.id,
            t.kind,
            t.model,
            t.passes,
            t.attempts,
            if t.flaky { " flaky" } else { "" },
            t.cost_usd
        ),
        _ => {}
    }
}

/// The run itself: every selected task in manifest order, reported through `on`. The caller
/// writes the results (`finish_run`). `cancel` stops it between tasks and aborts the attempt in
/// flight; the rest become SKIP ("cancelled").
pub async fn run_with(
    suite: &Suite,
    opts: &RunOptions,
    cancel: &CancelFlag,
    on: &mut (dyn FnMut(EvalProgress) + Send),
) -> Result<RunMetrics> {
    let meta = RunMeta::now(&suite.name, &opts.profile, opts.repeat.max(1), &suite.repo_root);
    let mut selected: Vec<&Task> = suite
        .manifest
        .tasks
        .iter()
        .filter(|t| opts.only.is_empty() || opts.only.contains(&t.id))
        .collect();
    let observations = if opts.rotate || opts.retry_failed {
        eval_history::load_observations(&suite.repo_root)
    } else {
        Vec::new()
    };
    if opts.rotate {
        // Never run first, then oldest last run (run ids sort by time). Stable: ties keep
        // manifest order.
        selected.sort_by_cached_key(|t| eval_history::last_run(&observations, &suite.name, &t.id));
    }
    on(EvalProgress::Started {
        run_id: meta.run_id.clone(),
        suite: suite.name.clone(),
        tasks: selected.iter().map(|t| t.id.clone()).collect(),
    });
    let mut attempt_opts = AttemptOpts {
        source: opts.source.clone(),
        effort: opts.effort.clone(),
        cancel: cancel.clone(),
        cost_cap: None,
    };
    let mut rows: Vec<TaskMetrics> = Vec::new();
    let mut spent = 0.0;
    let mut stopped: Option<String> = None;
    let over_budget = |spent: f64| opts.max_cost.is_some_and(|cap| spent >= cap);
    for task in selected {
        let Some(model) = suite.model_for(task, opts.model.as_deref()) else {
            if opts.pinned.is_none() {
                skip_task(on, &mut rows, task, UNSOLVED, "unsolved: chưa model nào qua được".into());
            }
            continue;
        };
        if opts.pinned.as_ref().is_some_and(|p| p != &model) {
            continue;
        }
        // "Run on source X": same family or tier there; `auto` routes within X.
        let model = match &opts.source {
            Some(src) => match suite.catalog.same_model_on(src, &model) {
                Ok(m) => m,
                Err(e) => {
                    skip_task(on, &mut rows, task, &model, format!("{e}"));
                    continue;
                }
            },
            None => model,
        };
        if let Some(missing) = task.missing_env() {
            skip_task(on, &mut rows, task, &model, format!("{missing} not set"));
            continue;
        }
        if task.requires_sandbox {
            let status = tokio::task::spawn_blocking(silence_sandbox::status).await.unwrap_or(silence_sandbox::SandboxStatus::Unsupported);
            if status != silence_sandbox::SandboxStatus::Ready {
                skip_task(on, &mut rows, task, &model, format!("sandbox not ready ({status:?})"));
                continue;
            }
        }
        if stopped.is_none() && cancel.load(Ordering::Relaxed) {
            stopped = Some("cancelled".into());
        }
        if stopped.is_none() && over_budget(spent) {
            stopped = Some(format!("đạt trần chi ${:.2}", opts.max_cost.unwrap_or_default()));
        }
        if let Some(reason) = &stopped {
            skip_task(on, &mut rows, task, &model, reason.clone());
            continue;
        }
        let mut agg = TaskMetrics::new(&task.id, &task.kind);
        agg.model = model.clone();
        let mut n = 0;
        for _ in 0..opts.repeat.max(1) {
            n += 1;
            on(EvalProgress::TaskStarted { id: task.id.clone(), model: model.clone(), attempt: n });
            attempt_opts.cost_cap = opts.max_cost.map(|cap| (cap - spent).max(0.0));
            let m = suite.attempt(task, &model, n, &attempt_opts).await?;
            spent += m.cost_usd;
            agg.merge_attempt(&m);
            if m.error.as_deref() == Some("cancelled") {
                stopped = Some("cancelled".into());
            }
            if let Some(code) = m.error_code.as_deref().filter(|c| is_fatal_error(c)) {
                stopped = Some(format!("{code}: dừng lượt chạy"));
            }
            if m.status == Status::Error || stopped.is_some() || over_budget(spent) {
                break;
            }
        }
        agg.status = agg.aggregate_status();
        // A task that keeps failing is broken (task or harness), not flaky: retrying it only
        // burns money (Anthropic: a steady 0% usually means a broken task).
        let streak = eval_history::fail_streak(&observations, &suite.name, &task.id);
        let stable_fail = streak >= STABLE_FAIL_RUNS;
        if agg.status == Status::Fail && opts.retry_failed && stable_fail && agg.error.is_none() {
            agg.error = Some(format!("không chạy lại: đã trượt {streak} lượt liền"));
        }
        if agg.status == Status::Fail && opts.retry_failed && !stable_fail && stopped.is_none() && !over_budget(spent) {
            on(EvalProgress::TaskStarted { id: task.id.clone(), model: model.clone(), attempt: n + 1 });
            attempt_opts.cost_cap = opts.max_cost.map(|cap| (cap - spent).max(0.0));
            let m = suite.attempt(task, &model, n + 1, &attempt_opts).await?;
            spent += m.cost_usd;
            agg.add_usage(&m);
            if m.status == Status::Pass {
                agg.status = Status::Pass;
                agg.flaky = true;
            }
        }
        if agg.error.as_deref() == Some("cancelled") {
            agg.status = Status::Skip;
        }
        on(EvalProgress::TaskDone { task: agg.clone() });
        rows.push(agg);
    }
    let summary = RunMetrics::new(meta, rows, stopped);
    on(EvalProgress::Finished { summary: Box::new(summary.clone()) });
    Ok(summary)
}

fn skip_task(
    on: &mut (dyn FnMut(EvalProgress) + Send),
    rows: &mut Vec<TaskMetrics>,
    task: &Task,
    model: &str,
    reason: String,
) {
    on(EvalProgress::Skipped { id: task.id.clone(), model: model.into(), reason: reason.clone() });
    rows.push(skipped(task, model, reason));
}

/// Print the table, write `results/metrics-<run_id>.json`, optionally record history.
/// Exit code: 1 = some task failed; 2 = no failure but infra errors / stopped early; 0 = clean.
pub(crate) fn finish_run(summary: &RunMetrics, repo_root: &Path, history: bool) -> Result<i32> {
    let c = &summary.counts;
    println!(
        "{} pass · {} fail · {} error · {} skip · ${:.4}",
        c.pass, c.fail, c.error, c.skip, summary.total_cost_usd
    );
    if let Some(s) = &summary.stopped {
        println!("dừng sớm: {s}");
    }
    println!();
    print!("{}", summary.table());
    let out = save_run(summary, repo_root, history)?;
    println!("metrics: {}", out.display());
    if history {
        println!("history: {}", eval_history::history_dir(repo_root).join("SUMMARY.md").display());
    }
    Ok(summary.exit_code())
}

/// Write `results/metrics-<run_id>.json` and, with `history`, the history line + SUMMARY.md.
/// No console output (Studio runs use this).
pub fn save_run(summary: &RunMetrics, repo_root: &Path, history: bool) -> Result<PathBuf> {
    let out = repo_root
        .join("evals/results")
        .join(format!("metrics-{}.json", summary.meta.run_id));
    std::fs::write(&out, serde_json::to_string_pretty(summary)?)?;
    if history {
        eval_history::append(repo_root, summary)?;
        eval_history::write_summary(repo_root)?;
    }
    Ok(out)
}

async fn wait_done(
    rx: &mut mpsc::UnboundedReceiver<SessionEvent>,
    report: &mut String,
    plan: &mut String,
    metrics: &mut TaskMetrics,
    trace: &mut Trace,
    cancel: &CancelFlag,
    limits: &Limits,
    ctx: &Arc<AppCtx>,
    sid: &str,
    approve: bool,
) -> bool {
    let deadline = tokio::time::Duration::from_secs(180);
    let start = tokio::time::Instant::now();
    let mut idle = tokio::time::Duration::ZERO;
    let tick = tokio::time::Duration::from_millis(500);
    loop {
        if start.elapsed() > deadline {
            metrics.error = Some("eval deadline 180s".into());
            return false;
        }
        if cancel.load(Ordering::Relaxed) {
            let _ = agent::abort(ctx, sid).await;
            return false;
        }
        // Short waits so a cancel is seen within half a second; 120s with no event = stuck.
        let ev = match tokio::time::timeout(tick, rx.recv()).await {
            Err(_) => {
                idle += tick;
                if idle < tokio::time::Duration::from_secs(120) {
                    continue;
                }
                Err(())
            }
            Ok(v) => {
                idle = tokio::time::Duration::ZERO;
                Ok(v)
            }
        };
        if let Ok(Some(e)) = &ev {
            metrics.observe(e);
            trace.push(e);
            if matches!(e, SessionEvent::Cost { .. }) {
                if let Some((code, why)) = metrics.over_limits(limits) {
                    let _ = agent::abort(ctx, sid).await;
                    metrics.error = Some(why);
                    metrics.error_code = code;
                    return false;
                }
            }
        }
        match ev {
            Ok(Some(SessionEvent::Token { text })) => report.push_str(&text),
            Ok(Some(SessionEvent::Plan { markdown })) => {
                plan.push_str(&markdown);
                report.push_str(&markdown);
            }
            // Marker so a task can require the event via `report_mentions: ["[event:mode_suggestion]"]`.
            Ok(Some(SessionEvent::ModeSuggestion { .. })) => report.push_str("\n[event:mode_suggestion]\n"),
            Ok(Some(SessionEvent::Permission { request_id, name, input, risk, .. })) => {
                // Eval sessions have no user: record the card, then answer it as the task says.
                let codes: Vec<String> = risk
                    .as_ref()
                    .map(|r| r.reasons.iter().map(|x| x.code.clone()).collect())
                    .unwrap_or_default();
                let hosts = risk.as_ref().map(|r| r.hosts.clone()).unwrap_or_default();
                let escalation = risk.as_ref().and_then(|r| r.escalation.as_ref()).is_some();
                let _ = ctx
                    .audit
                    .append(crate::audit::now_event(
                        sid,
                        "eval.asked",
                        "",
                        &name,
                        "",
                        0,
                        0,
                        0.0,
                        serde_json::json!({"codes": codes, "hosts": hosts, "escalation": escalation, "input": input, "approved": approve}),
                    ))
                    .await;
                let _ = agent::decide_permission(ctx, sid, &request_id, approve, false).await;
            }
            Ok(Some(SessionEvent::Done { .. })) => return true,
            Ok(Some(SessionEvent::Error { .. })) => return false,
            Ok(Some(_)) => {}
            Ok(None) => return false,
            Err(_) => {
                metrics.error = Some("no event for 120s".into());
                return false;
            }
        }
    }
}

/// Limits checked while an attempt runs (`wait_done`).
pub(crate) struct Limits {
    budget: Budget,
    cost_cap: Option<f64>,
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
    pub status: Status,
    /// Model the task ran on (the last `Route` decision when the engine reports one).
    pub model: String,
    pub effort: String,
    pub attempts: u32,
    pub passes: u32,
    pub errors: u32,
    /// Failed, then passed on the `--retry-failed` attempt.
    pub flaky: bool,
    pub duration_secs: f64,
    /// Provider-reported USD when every call had usage; else tokens × catalog price.
    pub cost_usd: f64,
    pub model_calls: u32,
    pub estimated_calls: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// Part of `input_tokens` read from the provider's prompt cache (0 = none or unknown).
    pub cache_read_tokens: u64,
    /// Part of `input_tokens` written to the prompt cache.
    pub cache_write_tokens: u64,
    pub tool_calls: u32,
    pub tool_calls_by_name: BTreeMap<String, u32>,
    pub tool_output_bytes: u64,
    /// Auto slots of the main turn's `Route`s, in order (empty on an explicit model).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub slots: Vec<String>,
    /// Auto escalated during the task (effort or Frontier).
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub escalated: bool,
    /// Reported USD per Auto slot (`frontier|strong|small`).
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub usd_by_slot: BTreeMap<String, f64>,
    /// `SessionEvent::Error` of the task (already secret-filtered by the Engine), or why it
    /// was skipped / timed out.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// `ErrorInfo.code` of that error (`PROVIDER_CREDITS`…), decides `Error` vs `Fail`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    /// Sum of `Cost.usd` (0 for calls without usage).
    #[serde(skip)]
    usd_reported: f64,
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
    /// Estimated (input, output) tokens of calls without usage, per model that made them.
    /// Auto can switch models inside one task, so each call is priced on its own model.
    #[serde(skip)]
    est_tokens: BTreeMap<String, (u64, u64)>,
    /// Model of the previous estimated call (its tool-call args are added later).
    #[serde(skip)]
    est_model: String,
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
            // Side calls (sub-agents, titles) route too; the task's model is the main turn's.
            SessionEvent::Route { task_class, model_id, slot, escalated, .. } => {
                if !task_class.starts_with("subagent:") && task_class != "title" {
                    self.model = model_id.clone();
                    if !slot.is_empty() && self.slots.last() != Some(slot) {
                        self.slots.push(slot.clone());
                    }
                }
                self.escalated |= *escalated;
            }
            // `run_turn` emits Cost after the call's text streamed and before its tools run.
            SessionEvent::Cost {
                input_tokens,
                output_tokens,
                usd,
                slot,
                cache_read_tokens,
                cache_write_tokens,
                ..
            } => {
                self.cache_read_tokens += *cache_read_tokens as u64;
                self.cache_write_tokens += *cache_write_tokens as u64;
                if !slot.is_empty() {
                    *self.usd_by_slot.entry(slot.clone()).or_default() += usd;
                }
                self.close_prev_call();
                self.model_calls += 1;
                self.usd_reported += usd;
                let text = std::mem::take(&mut self.text_since_cost);
                if *input_tokens == 0 && *output_tokens == 0 {
                    let input = self.context_est.saturating_sub(text);
                    self.estimated_calls += 1;
                    self.input_tokens += input;
                    self.output_tokens += text;
                    self.prev_call_estimated = true;
                    self.est_model = self.model.clone();
                    let e = self.est_tokens.entry(self.est_model.clone()).or_default();
                    e.0 += input;
                    e.1 += text;
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
                self.error_code = error.as_ref().map(|e| e.code.clone());
            }
            _ => {}
        }
    }

    /// First limit of `l` this attempt went over: (`error_code`, message). Checked after each
    /// model call, so the call that crosses a limit has already been paid for.
    fn over_limits(&self, l: &Limits) -> Option<(Option<String>, String)> {
        if let Some(cap) = l.cost_cap {
            if self.usd_reported >= cap {
                return Some((
                    Some(MAX_COST_CODE.into()),
                    format!("{MAX_COST_CODE}: đạt trần chi của lượt chạy giữa task (${:.4})", self.usd_reported),
                ));
            }
        }
        if let Some(n) = l.budget.max_turns {
            if self.model_calls > n {
                return Some((None, format!("budget: {} lần gọi model > max_turns {n}", self.model_calls)));
            }
        }
        if let Some(n) = l.budget.max_input_tokens {
            if self.input_tokens > n {
                return Some((None, format!("budget: {} input token > max_input_tokens {n}", self.input_tokens)));
            }
        }
        None
    }

    /// Share of input tokens served from the prompt cache (0.0 … 1.0).
    pub fn cache_hit_rate(&self) -> f64 {
        if self.input_tokens == 0 {
            0.0
        } else {
            self.cache_read_tokens as f64 / self.input_tokens as f64
        }
    }

    /// Flush the estimated output of the last call without usage.
    pub fn finish(&mut self) {
        self.close_prev_call();
    }

    /// `cost_usd`: what the provider reported, plus calls without usage priced from their
    /// estimated tokens on the model that made each of them (`price_of(model)` = USD per 1M
    /// input, output; an upper bound, cache discounts unknown). A model without a price adds 0.
    pub fn finalize_cost(&mut self, price_of: impl Fn(&str) -> Option<(f64, f64)>) {
        let estimated: f64 = self
            .est_tokens
            .iter()
            .filter_map(|(model, (i, o))| {
                price_of(model).map(|(pi, po)| (*i as f64 * pi + *o as f64 * po) / 1_000_000.0)
            })
            .sum();
        self.cost_usd = self.usd_reported + estimated;
    }

    fn close_prev_call(&mut self) {
        let args = std::mem::take(&mut self.args_since_cost);
        if std::mem::take(&mut self.prev_call_estimated) {
            self.output_tokens += args;
            self.est_tokens.entry(self.est_model.clone()).or_default().1 += args;
        }
    }

    /// Tokens, tools, cost and time of `o` (no attempt counting).
    fn add_usage(&mut self, o: &TaskMetrics) {
        self.model_calls += o.model_calls;
        self.estimated_calls += o.estimated_calls;
        self.input_tokens += o.input_tokens;
        self.output_tokens += o.output_tokens;
        self.cache_read_tokens += o.cache_read_tokens;
        self.cache_write_tokens += o.cache_write_tokens;
        self.tool_calls += o.tool_calls;
        self.tool_output_bytes += o.tool_output_bytes;
        self.cost_usd += o.cost_usd;
        self.duration_secs += o.duration_secs;
        for (k, v) in &o.tool_calls_by_name {
            *self.tool_calls_by_name.entry(k.clone()).or_default() += v;
        }
    }

    /// Fold one attempt into this task row.
    pub fn merge_attempt(&mut self, o: &TaskMetrics) {
        self.add_usage(o);
        self.attempts += o.attempts;
        self.passes += o.passes;
        self.errors += o.errors;
        if !o.model.is_empty() {
            self.model = o.model.clone();
        }
        self.effort = o.effort.clone();
        if o.error.is_some() {
            self.error = o.error.clone();
            self.error_code = o.error_code.clone();
        }
    }

    /// Any infra error → `Error`; every attempt passed → `Pass`; else `Fail`.
    pub fn aggregate_status(&self) -> Status {
        if self.errors > 0 {
            Status::Error
        } else if self.attempts > 0 && self.passes == self.attempts {
            Status::Pass
        } else {
            Status::Fail
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Counts {
    pub pass: u32,
    pub fail: u32,
    pub error: u32,
    pub skip: u32,
}

/// Whole-run summary, written to `evals/results/metrics-<run_id>.json`.
#[derive(Debug, Clone, Serialize)]
pub struct RunMetrics {
    #[serde(flatten)]
    pub meta: RunMeta,
    /// Why the run stopped before the end (fatal provider error, budget).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stopped: Option<String>,
    pub counts: Counts,
    pub total_cost_usd: f64,
    pub tasks: Vec<TaskMetrics>,
    pub total: TaskMetrics,
}

impl RunMetrics {
    pub fn new(meta: RunMeta, tasks: Vec<TaskMetrics>, stopped: Option<String>) -> Self {
        let mut total = TaskMetrics::new("TOTAL", "");
        let mut counts = Counts::default();
        for t in &tasks {
            total.add_usage(t);
            match t.status {
                Status::Pass => counts.pass += 1,
                Status::Fail => counts.fail += 1,
                Status::Error => counts.error += 1,
                Status::Skip => counts.skip += 1,
            }
        }
        total.status = if counts.fail > 0 {
            Status::Fail
        } else if counts.error > 0 {
            Status::Error
        } else {
            Status::Pass
        };
        Self {
            meta,
            stopped,
            counts,
            total_cost_usd: total.cost_usd,
            tasks,
            total,
        }
    }

    pub fn exit_code(&self) -> i32 {
        if self.counts.fail > 0 {
            1
        } else if self.counts.error > 0 || self.stopped.is_some() {
            2
        } else {
            0
        }
    }

    pub fn table(&self) -> String {
        let row = |cols: [&str; 10], h: &str| {
            let [a, b, c, d, e, f, k, g, i, j] = cols;
            format!("{a:<28} {b:>5} {c:<16} {d:>5} {e:>6} {f:>9} {k:>6} {g:>8} {i:>8} {j:>6}  {h}\n")
        };
        let mut s = row(
            ["task", "ok", "model", "n", "calls", "in_tok", "cache", "out_tok", "usd", "secs"],
            "tools_by_name",
        );
        for t in self.tasks.iter().chain(std::iter::once(&self.total)) {
            let calls = if t.estimated_calls > 0 {
                format!("{}~{}", t.model_calls, t.estimated_calls)
            } else {
                t.model_calls.to_string()
            };
            let n = if t.flaky {
                format!("{}/{}~", t.passes, t.attempts)
            } else {
                format!("{}/{}", t.passes, t.attempts)
            };
            let by_name = t
                .tool_calls_by_name
                .iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join(" ");
            s.push_str(&row(
                [
                    &t.id,
                    t.status.as_str(),
                    &t.model,
                    &n,
                    &calls,
                    &t.input_tokens.to_string(),
                    &format!("{:.0}%", t.cache_hit_rate() * 100.0),
                    &t.output_tokens.to_string(),
                    &format!("{:.4}", t.cost_usd),
                    &format!("{:.0}", t.duration_secs),
                ],
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

/// Result of one `pass_if` check, written to `checks.json` and shown in Studio (tab Checks).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CheckResult {
    /// `run`, `grep`, `test`, `unchanged`, `report_mentions`, `plan_mentions`, `max_report_chars`,
    /// `report_lang`, `audit_matches`, `audit_absent`.
    pub kind: String,
    /// What was checked: a path, a pattern, a test filter, a phrase.
    pub target: String,
    pub ok: bool,
    /// Why it failed (or the matching line, for `audit_absent`). Empty when there is nothing to add.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub detail: String,
}

impl CheckResult {
    fn new(kind: &str, target: &str, ok: bool, detail: impl Into<String>) -> Self {
        Self { kind: kind.into(), target: target.into(), ok, detail: detail.into() }
    }
    fn pass(kind: &str, target: &str) -> Self {
        Self::new(kind, target, true, "")
    }
    fn fail(kind: &str, target: &str, detail: impl Into<String>) -> Self {
        Self::new(kind, target, false, detail)
    }
}

fn clip(s: &str, n: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= n {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(n).collect::<String>())
    }
}

/// `audit_matches` must each hit a line; `audit_absent` must hit none. Bad regex = fail.
fn audit_checks(p: &PassIf, audit: &str) -> Vec<CheckResult> {
    let first_hit = |pat: &str| regex::Regex::new(pat).map(|re| audit.lines().find(|l| re.is_match(l)));
    let mut out = Vec::new();
    for pat in &p.audit_matches {
        out.push(match first_hit(pat) {
            Ok(Some(_)) => CheckResult::pass("audit_matches", pat),
            Ok(None) => CheckResult::fail("audit_matches", pat, "no audit line matches"),
            Err(e) => CheckResult::fail("audit_matches", pat, format!("bad regex: {e}")),
        });
    }
    for pat in &p.audit_absent {
        out.push(match first_hit(pat) {
            Ok(None) => CheckResult::pass("audit_absent", pat),
            Ok(Some(line)) => CheckResult::fail("audit_absent", pat, format!("matched: {}", clip(line, 300))),
            Err(e) => CheckResult::fail("audit_absent", pat, format!("bad regex: {e}")),
        });
    }
    out
}

#[cfg(test)]
fn audit_pass(p: &PassIf, audit: &str) -> bool {
    audit_checks(p, audit).iter().all(|c| c.ok)
}

/// Every non-audit check of `pass_if`. All of them run, so a failure lists every reason.
fn check_all(
    task: &Task,
    ws: &Path,
    fixture: &Path,
    report: &str,
    plan: &str,
    verify_cmd: &str,
) -> Vec<CheckResult> {
    let p = &task.pass_if;
    let mut out = Vec::new();
    let hay = format!("{report}\n{plan}").to_lowercase();
    if let Some(n) = p.max_report_chars {
        let len = report.trim().chars().count();
        let detail = if len > n { format!("report has {len} chars") } else { String::new() };
        out.push(CheckResult::new("max_report_chars", &n.to_string(), len <= n, detail));
    }
    if let Some(code) = &p.report_lang {
        let want = crate::lang::ReplyLang::from_code(code);
        let got = crate::lang::detect(report);
        let detail = match got {
            Some(l) if Some(l) != want => format!("report is in {}", l.name()),
            None => "report language unclear".to_string(),
            _ => String::new(),
        };
        out.push(CheckResult::new("report_lang", code, want.is_some() && got == want, detail));
    }
    for rel in &p.unchanged {
        let now = std::fs::read(ws.join(rel)).ok();
        let before = std::fs::read(fixture.join(rel)).ok();
        out.push(if now == before {
            CheckResult::pass("unchanged", rel)
        } else if now.is_none() {
            CheckResult::fail("unchanged", rel, "file was deleted")
        } else {
            CheckResult::fail("unchanged", rel, "file differs from the fixture")
        });
    }
    for g in &p.grep {
        let target = format!("{}: {}", g.path, g.pattern);
        let check = match (std::fs::read_to_string(ws.join(&g.path)), regex::Regex::new(&g.pattern)) {
            (_, Err(e)) => CheckResult::fail("grep", &target, format!("bad regex: {e}")),
            (Err(_), _) => CheckResult::fail("grep", &target, "file not found"),
            (Ok(text), Ok(re)) if re.is_match(&text) => CheckResult::pass("grep", &target),
            (Ok(_), Ok(_)) => CheckResult::fail("grep", &target, "pattern not found in the file"),
        };
        out.push(check);
    }
    if let Some(filter) = p.test.as_deref().or(task.verify_filter.as_deref()) {
        let (ok, tail) = run_verify(ws, verify_cmd, filter);
        out.push(CheckResult::new("test", filter, ok, if ok { String::new() } else { tail }));
    }
    for n in &p.report_mentions {
        let ok = hay.contains(&n.to_lowercase());
        out.push(CheckResult::new("report_mentions", n, ok, if ok { "" } else { "not mentioned in the answer" }));
    }
    for n in &p.plan_mentions {
        let ok = hay.contains(&n.to_lowercase());
        out.push(CheckResult::new("plan_mentions", n, ok, if ok { "" } else { "not mentioned in the plan" }));
    }
    out
}

/// Run the fixture's tests; on failure also return the exit code and last lines of the output.
fn run_verify(ws: &Path, cmd: &str, filter: &str) -> (bool, String) {
    let mut parts = cmd.split_whitespace();
    let Some(bin) = parts.next() else {
        return (true, String::new());
    };
    // verify_cmd is like `python -m tests.runner`
    let mut c = std::process::Command::new(bin);
    c.args(parts).arg(filter).current_dir(ws);
    match c.output() {
        Ok(o) => {
            let text = format!("{}\n{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr));
            let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
            let tail = lines[lines.len().saturating_sub(12)..].join("\n");
            let code = o.status.code().map(|c| c.to_string()).unwrap_or_else(|| "signal".into());
            (o.status.success(), format!("exit {code}\n{}", clip(&tail, 2000)))
        }
        Err(e) => (false, format!("could not run `{cmd}`: {e}")),
    }
}

#[cfg(test)]
mod check_tests {
    use super::*;

    fn task(pass_if: PassIf) -> Task {
        Task {
            id: "T".into(),
            kind: "edit".into(),
            prompt: String::new(),
            plan_only: false,
            mode: None,
            verify_filter: None,
            model: None,
            effort: None,
            style: None,
            requires_env: vec![],
            permission: None,
            requires_sandbox: false,
            on_ask: None,
            budget: Budget::default(),
            pass_if,
        }
    }

    #[test]
    fn checks_explain_each_failure() {
        let fx = tempfile::tempdir().unwrap();
        let ws = tempfile::tempdir().unwrap();
        std::fs::write(fx.path().join("a.py"), "x = 1\n").unwrap();
        std::fs::write(ws.path().join("a.py"), "x = 2\n").unwrap();
        std::fs::write(fx.path().join("keep.md"), "same").unwrap();
        std::fs::write(ws.path().join("keep.md"), "same").unwrap();
        let t = task(PassIf {
            grep: vec![
                GrepCheck { path: "a.py".into(), pattern: r"x = 2".into() },
                GrepCheck { path: "a.py".into(), pattern: r"y = \d".into() },
                GrepCheck { path: "missing.py".into(), pattern: "z".into() },
            ],
            unchanged: vec!["keep.md".into(), "a.py".into()],
            report_mentions: vec!["calc.py".into(), "BUG".into()],
            max_report_chars: Some(10),
            ..Default::default()
        });
        let report = "Found a bug in calc.py, fixed it.";
        let checks = check_all(&t, ws.path(), fx.path(), report, "", "");
        let summary: Vec<(&str, bool, &str)> = checks.iter().map(|c| (c.kind.as_str(), c.ok, c.detail.as_str())).collect();
        assert_eq!(
            summary,
            [
                ("max_report_chars", false, "report has 33 chars"),
                ("unchanged", true, ""),
                ("unchanged", false, "file differs from the fixture"),
                ("grep", true, ""),
                ("grep", false, "pattern not found in the file"),
                ("grep", false, "file not found"),
                ("report_mentions", true, ""),
                ("report_mentions", true, ""),
            ]
        );
        let json = serde_json::to_value(&checks[1]).unwrap();
        assert!(json.get("detail").is_none(), "empty detail is not written: {json}");

        let audit = r#"{"kind":"tool","tool":"shell"}"#;
        let p = PassIf { audit_matches: vec!["tool\\.blocked".into()], audit_absent: vec!["shell".into(), "(".into()], ..Default::default() };
        let a = audit_checks(&p, audit);
        assert_eq!(a[0].detail, "no audit line matches");
        assert!(a[1].detail.starts_with("matched: {\"kind\":\"tool\""));
        assert!(a[2].detail.starts_with("bad regex"));
    }

    #[test]
    fn report_lang_check() {
        let (ws, fx) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let t = task(PassIf { report_lang: Some("vi".into()), ..Default::default() });
        let kinds = |report: &str| {
            check_all(&t, ws.path(), fx.path(), report, "", "")
                .into_iter()
                .map(|c| (c.ok, c.detail))
                .collect::<Vec<_>>()
        };
        assert_eq!(kinds("`mean([])` chia cho 0 nên ném ZeroDivisionError."), [(true, String::new())]);
        assert_eq!(
            kinds("`mean([])` divides by zero, so it raises ZeroDivisionError and the test fails."),
            [(false, "report is in English".to_string())]
        );
        assert_eq!(kinds("ok"), [(false, "report language unclear".to_string())]);
    }

    #[test]
    fn failed_verify_returns_the_output_tail() {
        let ws = tempfile::tempdir().unwrap();
        let (ok, tail) = run_verify(ws.path(), "", "x");
        assert!(ok && tail.is_empty(), "no verify_cmd = pass");
        let (ok, tail) = run_verify(ws.path(), "definitely-not-a-binary-5ilence", "x");
        assert!(!ok && tail.starts_with("could not run"), "{tail}");
    }
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
            cache_read_tokens: 0,
            cache_write_tokens: 0,
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

    fn provider_error(code: &str) -> SessionEvent {
        SessionEvent::Error {
            message: format!("turn failed: {code}"),
            error: Some(silence_protocol::ErrorInfo {
                code: code.into(),
                status: None,
                retryable: false,
                detail: String::new(),
            }),
        }
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
    fn budget_and_cost_cap_stop_an_attempt() {
        let ev = |i: u32, usd: f64| SessionEvent::Cost {
            input_tokens: i,
            output_tokens: 10,
            usd,
            slot: String::new(),
            baseline_usd: 0.0,
            cache_read_tokens: i / 2,
            cache_write_tokens: 0,
        };
        let budget: Budget = serde_yaml::from_str("max_turns: 2\nmax_input_tokens: 5000").unwrap();
        let limits = Limits { budget, cost_cap: Some(0.05) };
        let mut m = TaskMetrics::new("T", "edit");
        m.observe(&ev(1000, 0.01));
        m.observe(&ev(1000, 0.01));
        assert!(m.over_limits(&limits).is_none());
        assert_eq!(m.cache_read_tokens, 1000);
        assert!((m.cache_hit_rate() - 0.5).abs() < 1e-9);
        m.observe(&ev(1000, 0.01));
        let (code, why) = m.over_limits(&limits).unwrap();
        assert!(code.is_none() && why.contains("max_turns 2"), "{why}");

        let no_turn_cap = Limits { budget: Budget { max_turns: None, ..budget }, cost_cap: Some(0.05) };
        m.observe(&ev(4000, 0.01));
        let (_, why) = m.over_limits(&no_turn_cap).unwrap();
        assert!(why.contains("max_input_tokens"), "{why}");

        let only_cost = Limits { budget: Budget::default(), cost_cap: Some(0.05) };
        m.observe(&ev(10, 0.02));
        let (code, _) = m.over_limits(&only_cost).unwrap();
        assert_eq!(code.as_deref(), Some(MAX_COST_CODE));
        // Infra error (not an agent failure), and it stops the run.
        assert_eq!(attempt_status(false, code.as_deref()), Status::Error);
        assert!(is_fatal_error(MAX_COST_CODE));
    }

    #[test]
    fn shipped_manifests_parse_budgets() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        for suite in ["v0", "modes"] {
            let text = std::fs::read_to_string(repo.join("evals").join(suite).join("manifest.yaml")).unwrap();
            let m: Manifest = serde_yaml::from_str(&text).unwrap();
            assert!(!m.tasks.is_empty());
        }
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
        a.status = Status::Pass;
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
        assert_eq!(b.error_code, None);
        b.observe(&cost(20, 3));
        for e in &tool("outline", "abcd") {
            b.observe(e);
        }
        let run = RunMetrics::new(RunMeta { run_id: "r1".into(), ..Default::default() }, vec![a, b], None);
        assert_eq!(run.total.status, Status::Fail);
        assert_eq!(run.counts, Counts { pass: 1, fail: 1, error: 0, skip: 0 });
        assert_eq!(run.exit_code(), 1);
        assert_eq!(run.total.input_tokens, 30);
        assert_eq!(run.total.output_tokens, 5);
        assert_eq!(run.total.tool_calls, 2);
        assert_eq!(run.total.tool_output_bytes, 7);
        assert_eq!(run.total.tool_calls_by_name.len(), 2);
        let table = run.table();
        assert!(table.contains("TOTAL"));
        assert!(table.contains("outline=1"));
        let js = serde_json::to_value(&run).unwrap();
        assert_eq!(js["run_id"], "r1");
        assert_eq!(js["total"]["input_tokens"], 30);
        assert_eq!(js["tasks"][0]["status"], "PASS");
        assert!(js["tasks"][0].get("context_est").is_none());
    }

    #[test]
    fn infra_errors_are_error_not_fail() {
        let mut m = TaskMetrics::new("t", "edit");
        m.observe(&provider_error("PROVIDER_CREDITS"));
        assert_eq!(m.error_code.as_deref(), Some("PROVIDER_CREDITS"));
        assert_eq!(attempt_status(false, m.error_code.as_deref()), Status::Error);
        assert!(is_fatal_error("PROVIDER_CREDITS"));
        assert!(!is_fatal_error("PROVIDER_RATE"));
        assert_eq!(attempt_status(false, Some("PROVIDER_RATE")), Status::Error);
        // A refusal or unknown error is the agent's outcome, not infra.
        assert_eq!(attempt_status(false, Some("PROVIDER_REFUSAL")), Status::Fail);
        assert_eq!(attempt_status(false, None), Status::Fail);
        assert_eq!(attempt_status(true, None), Status::Pass);

        let mut e = TaskMetrics::new("e", "edit");
        e.status = Status::Error;
        let run = RunMetrics::new(RunMeta::default(), vec![e], Some("PROVIDER_CREDITS: dừng".into()));
        assert_eq!(run.total.status, Status::Error);
        assert_eq!(run.exit_code(), 2);
        let clean = RunMetrics::new(RunMeta::default(), vec![], None);
        assert_eq!(clean.exit_code(), 0);
    }

    #[test]
    fn model_precedence() {
        assert_eq!(resolve_model(Some("claude-opus"), Some("auto"), Some("claude-sonnet")).as_deref(), Some("claude-opus"));
        assert_eq!(resolve_model(None, Some("auto"), Some("claude-sonnet")).as_deref(), Some("auto"));
        assert_eq!(resolve_model(None, None, Some("claude-sonnet")).as_deref(), Some("claude-sonnet"));
        assert_eq!(resolve_model(None, None, None).as_deref(), Some(DEFAULT_MODEL));
        assert_eq!(resolve_model(None, None, Some(UNSOLVED)), None);
        assert_eq!(resolve_model(Some("claude-opus"), None, Some(UNSOLVED)).as_deref(), Some("claude-opus"));
    }

    #[test]
    fn cost_prefers_provider_usd_else_catalog_price() {
        let mut m = TaskMetrics::new("t", "edit");
        m.observe(&SessionEvent::Cost { input_tokens: 1_000_000, output_tokens: 100_000, usd: 0.123, slot: String::new(), baseline_usd: 0.0, cache_read_tokens: 0, cache_write_tokens: 0 });
        m.finish();
        m.finalize_cost(|_| Some((0.10, 0.50)));
        assert!((m.cost_usd - 0.123).abs() < 1e-9);

        let mut est = TaskMetrics::new("t", "edit");
        est.est_tokens.insert("m".into(), (2_000_000, 200_000));
        est.finalize_cost(|_| Some((2.0, 10.0)));
        assert!((est.cost_usd - 6.0).abs() < 1e-9);

        let mut cli = TaskMetrics::new("t", "edit");
        cli.observe(&SessionEvent::Cost { input_tokens: 10, output_tokens: 1, usd: 0.5, slot: String::new(), baseline_usd: 0.0, cache_read_tokens: 0, cache_write_tokens: 0 });
        cli.finalize_cost(|_| Some((0.0, 0.0)));
        assert!((cli.cost_usd - 0.5).abs() < 1e-9);
    }

    #[test]
    fn calls_without_usage_are_priced_on_their_own_model() {
        let route = |model: &str| SessionEvent::Route {
            task_class: "agent".into(),
            model_id: model.into(),
            reason: String::new(),
            slot: "strong".into(),
            escalated: false,
        };
        let mut m = TaskMetrics::new("t", "bugfix");
        m.model = "auto".into();
        m.start_context(1_000_000);
        // Call 1 on Sonnet without usage, call 2 on Opus with usage, call 3 on Opus without.
        m.observe(&route("sonnet"));
        m.observe(&cost(0, 0));
        m.observe(&route("opus"));
        m.observe(&SessionEvent::Cost { input_tokens: 5, output_tokens: 5, usd: 0.25, slot: "frontier".into(), baseline_usd: 0.25, cache_read_tokens: 0, cache_write_tokens: 0 });
        m.observe(&cost(0, 0));
        m.finish();
        let price = |model: &str| match model {
            "sonnet" => Some((1.0, 0.0)),
            "opus" => Some((2.0, 0.0)),
            _ => None,
        };
        m.finalize_cost(price);
        // 1M estimated input on Sonnet ($1) + 1M on Opus ($2) + the reported $0.25.
        assert!((m.cost_usd - 3.25).abs() < 1e-9, "{}", m.cost_usd);
    }

    fn shipped_suite(name: &str) -> (Suite, tempfile::TempDir) {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        // Results go to a temp repo root so tests never touch evals/results.
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("evals")).unwrap();
        let mut s = Suite::load(&repo.join("evals").join(name), &repo.join("config/models.yaml"), tmp.path()).unwrap();
        s.fixture = repo.join("evals").join(&s.manifest.workspace);
        (s, tmp)
    }

    #[tokio::test]
    async fn run_with_reports_progress_without_calling_a_model() {
        let (suite, _tmp) = shipped_suite("v0");
        let opts = RunOptions {
            only: vec!["E01-edit-add-pow".into(), "B06-bugfix-mul".into()],
            max_cost: Some(0.0),
            source: Some("claude-api".into()),
            ..Default::default()
        };
        let mut seen = Vec::new();
        let summary = run_with(&suite, &opts, &CancelFlag::default(), &mut |p| seen.push(p)).await.unwrap();
        assert!(matches!(&seen[0], EvalProgress::Started { tasks, .. } if tasks.len() == 2));
        let skipped: Vec<(String, String)> = seen
            .iter()
            .filter_map(|p| match p {
                EvalProgress::Skipped { id, model, .. } => Some((id.clone(), model.clone())),
                _ => None,
            })
            .collect();
        assert_eq!(skipped.len(), 2, "a $0 cap starts nothing");
        assert!(skipped.iter().all(|(_, m)| m.ends_with("@api")), "models moved to the source: {skipped:?}");
        assert!(matches!(seen.last(), Some(EvalProgress::Finished { .. })));
        assert_eq!(summary.counts.skip, 2);

        let cancel = CancelFlag::default();
        cancel.store(true, Ordering::Relaxed);
        let opts = RunOptions { only: vec!["E01-edit-add-pow".into()], ..Default::default() };
        let mut seen = Vec::new();
        let summary = run_with(&suite, &opts, &cancel, &mut |p| seen.push(p)).await.unwrap();
        assert_eq!(summary.stopped.as_deref(), Some("cancelled"));
        assert!(seen.iter().any(|p| matches!(p, EvalProgress::Skipped { reason, .. } if reason == "cancelled")));
    }

    #[test]
    fn attempts_get_their_own_folder() {
        let p = attempt_dir(Path::new("r"), "B06", 2);
        assert!(p.ends_with("B06/attempt-2") || p.ends_with("B06\\attempt-2"));
    }

    #[test]
    fn auto_routes_record_main_slots_only() {
        let route = |class: &str, slot: &str, esc: bool| SessionEvent::Route {
            task_class: class.into(),
            model_id: format!("m-{slot}"),
            reason: String::new(),
            slot: slot.into(),
            escalated: esc,
        };
        let mut m = TaskMetrics::new("t", "edit");
        m.observe(&route("agent", "strong", false));
        m.observe(&route("subagent:explore", "small", false));
        m.observe(&route("agent", "frontier", true));
        m.observe(&SessionEvent::Cost { input_tokens: 1, output_tokens: 1, usd: 0.2, slot: "frontier".into(), baseline_usd: 0.2, cache_read_tokens: 0, cache_write_tokens: 0 });
        assert_eq!(m.slots, vec!["strong", "frontier"]);
        assert_eq!(m.model, "m-frontier");
        assert!(m.escalated);
        assert!((m.usd_by_slot["frontier"] - 0.2).abs() < 1e-9);
    }

    #[test]
    fn attempts_aggregate() {
        let attempt = |s: Status| {
            let mut m = TaskMetrics::new("t", "edit");
            m.status = s;
            m.attempts = 1;
            m.passes = u32::from(s == Status::Pass);
            m.errors = u32::from(s == Status::Error);
            m.cost_usd = 0.01;
            m
        };
        let mut agg = TaskMetrics::new("t", "edit");
        agg.merge_attempt(&attempt(Status::Pass));
        agg.merge_attempt(&attempt(Status::Pass));
        assert_eq!(agg.aggregate_status(), Status::Pass);
        assert!((agg.cost_usd - 0.02).abs() < 1e-9);
        agg.merge_attempt(&attempt(Status::Fail));
        assert_eq!(agg.aggregate_status(), Status::Fail);
        agg.merge_attempt(&attempt(Status::Error));
        assert_eq!(agg.aggregate_status(), Status::Error);
        assert_eq!(TaskMetrics::new("x", "").aggregate_status(), Status::Fail);
    }

    #[test]
    fn model_pins_roundtrip() {
        let dir = std::env::temp_dir().join(format!("silence-pins-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("models.yaml");
        assert!(ModelPins::load(&path).unwrap().models.is_empty());
        let mut pins = ModelPins::default();
        pins.models.insert("B06".into(), "claude-sonnet".into());
        pins.models.insert("E01".into(), "claude-haiku".into());
        pins.save(&path).unwrap();
        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("# Model đã ghim"));
        assert_eq!(ModelPins::load(&path).unwrap().models["B06"], "claude-sonnet");
        std::fs::write(&path, "# trống\n").unwrap();
        assert!(ModelPins::load(&path).unwrap().models.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
