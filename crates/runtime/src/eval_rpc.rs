//! Evals from Studio (`eval.*` RPC): list suites and tasks, estimate cost, run in the
//! background with progress notifications, cancel, list past runs, open one task's result.
//!
//! The client only picks *what* to run (suite, task ids, source, model, effort, repeat, cap). It
//! never chooses a permission mode: the YOLO sessions are created inside `eval_runner`, on a copy
//! of the suite fixture under `evals/results/`, exactly as `silence-engine evals` does.

use crate::eval_history;
use crate::eval_runner::{self, attempt_dir, CancelFlag, EvalProgress, RunOptions, Suite};
use anyhow::{anyhow, bail, Result};
use serde::Deserialize;
use serde_json::{json, Value};
use silence_router::Catalog;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

/// Most attempts per task a Studio run may ask for.
const MAX_REPEAT: u32 = 5;
/// Files of a task's workspace diff returned to the UI, and the size of each side.
const MAX_DIFF_FILES: usize = 30;
const MAX_DIFF_BYTES: u64 = 64 * 1024;
const MAX_AUDIT_LINES: usize = 300;
const MAX_REPORT_BYTES: usize = 200 * 1024;

/// Where evals live and the one run allowed at a time.
pub struct EvalHost {
    pub repo_root: PathBuf,
    pub config_path: PathBuf,
    running: Mutex<Option<CancelFlag>>,
    /// Progress of the current run, or of the last one until the next `start`. `eval.status`
    /// returns it so a Studio window that closed the page or reloaded can rebuild the view.
    events: Mutex<Vec<EvalProgress>>,
}

/// `eval.estimate` / `eval.start` params.
#[derive(Debug, Clone, Deserialize)]
pub struct EvalConfig {
    pub suite: String,
    pub tasks: Vec<String>,
    /// Provider id; `None` = each task's own model (pins / manifest).
    #[serde(default)]
    pub source: Option<String>,
    /// Catalog id or `auto`; `None` = per task.
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<String>,
    #[serde(default = "one")]
    pub repeat: u32,
    #[serde(default)]
    pub retry_failed: bool,
    #[serde(default)]
    pub max_cost: Option<f64>,
    #[serde(default)]
    pub history: bool,
}

fn one() -> u32 {
    1
}

impl EvalHost {
    pub fn new(repo_root: PathBuf, config_path: PathBuf) -> Self {
        Self { repo_root, config_path, running: Mutex::new(None), events: Mutex::new(Vec::new()) }
    }

    fn evals_dir(&self) -> PathBuf {
        self.repo_root.join("evals")
    }

    /// Suites = folders of `evals/` with a `manifest.yaml`, sorted by name.
    pub fn suites(&self) -> Vec<String> {
        let mut out: Vec<String> = std::fs::read_dir(self.evals_dir())
            .map(|d| {
                d.flatten()
                    .filter(|e| e.path().join("manifest.yaml").is_file())
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        out.sort();
        out
    }

    fn load(&self, suite: &str) -> Result<Suite> {
        // Only a discovered name: never a path from the client.
        if !self.suites().iter().any(|s| s == suite) {
            bail!("unknown eval suite {suite}");
        }
        Suite::load(&self.evals_dir().join(suite), &self.config_path, &self.repo_root)
    }

    pub fn is_running(&self) -> bool {
        self.running.lock().unwrap_or_else(|e| e.into_inner()).is_some()
    }

    /// Keep one progress event for `eval.status`.
    fn record(&self, p: &EvalProgress) {
        self.events.lock().unwrap_or_else(|e| e.into_inner()).push(p.clone());
    }

    /// `eval.status`: whether a run is going, and every progress event of the current (or last)
    /// run in order. The client replays them through the same reducer as `eval.progress`.
    pub fn status(&self) -> Value {
        let events = self.events.lock().unwrap_or_else(|e| e.into_inner()).clone();
        json!({"running": self.is_running(), "events": events})
    }

    /// `eval.catalog`: suites with their tasks and last results, plus the sources.
    pub async fn catalog(&self, catalog: &Catalog) -> Result<Value> {
        let suites = self.suites();
        if suites.is_empty() {
            return Ok(json!({"available": false, "suites": [], "sources": [], "running": false}));
        }
        let obs = eval_history::load_observations(&self.repo_root);
        let mut out = Vec::new();
        for name in &suites {
            let suite = match self.load(name) {
                Ok(s) => s,
                Err(e) => {
                    out.push(json!({"name": name, "error": format!("{e:#}"), "tasks": []}));
                    continue;
                }
            };
            let tasks: Vec<Value> = suite
                .manifest
                .tasks
                .iter()
                .map(|t| {
                    let last = eval_history::last_result(&obs, name, &t.id);
                    json!({
                        "id": t.id,
                        "kind": t.kind,
                        "mode": t.session_mode(),
                        "manifest_model": t.model,
                        "pinned": suite.pins.models.get(&t.id),
                        "effort": t.effort(),
                        "missing_env": t.missing_env(),
                        "last": last.map(|o| json!({
                            "run_id": o.run_id, "status": o.status, "model": o.model, "cost_usd": o.cost_usd,
                        })),
                    })
                })
                .collect();
            out.push(json!({"name": name, "tasks": tasks}));
        }
        let sources = crate::providers::status(catalog).await["providers"].clone();
        Ok(json!({"available": true, "suites": out, "sources": sources, "running": self.is_running()}))
    }

    /// `eval.config.get`: `evals/config.yaml` plus every source with whether it works on this PC
    /// right now (key set, or Claude CLI installed and logged in) and whether CI can use it.
    pub async fn config_get(&self, catalog: &Catalog) -> Result<Value> {
        let settings = crate::eval_config::load(&self.repo_root)?;
        let mut sources = Vec::new();
        for p in &catalog.raw.providers {
            let ready = crate::providers::source_ready(catalog, &p.id).await;
            sources.push(json!({
                "id": p.id,
                "label": p.display_label(),
                "env": p.api_key_env,
                "cli": p.is_cli(),
                "ready": ready.is_ok(),
                "reason": ready.err().unwrap_or_default(),
            }));
        }
        Ok(json!({
            "settings": settings,
            "sources": sources,
            "path": "evals/config.yaml",
            "exists": crate::eval_config::path(&self.repo_root).exists(),
            "max_cap_usd": crate::eval_config::MAX_CAP_USD,
        }))
    }

    /// `eval.config.set`: validate and write `evals/config.yaml`. Never a key.
    pub fn config_set(&self, params: Value, catalog: &Catalog) -> Result<Value> {
        let settings: crate::eval_config::EvalSettings = serde_json::from_value(params)?;
        let path = settings.save(&self.repo_root, catalog)?;
        Ok(json!({"ok": true, "path": path.to_string_lossy()}))
    }

    /// The config with its source resolved: no source = `source` of `evals/config.yaml`,
    /// `per-task` = each task's pinned model.
    fn resolved(&self, cfg: &EvalConfig) -> Result<EvalConfig> {
        let settings = crate::eval_config::load(&self.repo_root)?;
        let mut out = cfg.clone();
        out.source = crate::eval_config::resolve_source(cfg.source.as_deref(), &settings.source);
        Ok(out)
    }

    /// Check a config against the suite and catalog; returns the loaded suite.
    fn validate(&self, cfg: &EvalConfig, catalog: &Catalog) -> Result<Suite> {
        let suite = self.load(&cfg.suite)?;
        if cfg.tasks.is_empty() {
            bail!("pick at least one task");
        }
        for id in &cfg.tasks {
            if !suite.manifest.tasks.iter().any(|t| &t.id == id) {
                bail!("unknown task {id} in suite {}", cfg.suite);
            }
        }
        if let Some(src) = &cfg.source {
            catalog.provider(src)?;
        }
        if let Some(m) = cfg.model.as_deref().filter(|m| *m != "auto") {
            catalog.resolve(m)?;
        }
        if let Some(e) = cfg.effort.as_deref().filter(|e| *e != "auto") {
            if !silence_protocol::EFFORT_LEVELS.contains(&e) {
                bail!("unknown effort {e}");
            }
        }
        if cfg.repeat == 0 || cfg.repeat > MAX_REPEAT {
            bail!("repeat must be 1..={MAX_REPEAT}");
        }
        if cfg.max_cost.is_some_and(|c| !c.is_finite() || c < 0.0) {
            bail!("max_cost must be a positive number");
        }
        Ok(suite)
    }

    fn options(cfg: &EvalConfig) -> RunOptions {
        RunOptions {
            model: cfg.model.clone(),
            only: cfg.tasks.clone(),
            pinned: None,
            repeat: cfg.repeat,
            retry_failed: cfg.retry_failed,
            max_cost: cfg.max_cost,
            history: cfg.history,
            profile: "studio".into(),
            source: cfg.source.clone(),
            effort: cfg.effort.clone().filter(|e| e != "auto"),
            rotate: false,
            affected_since: None,
        }
    }

    /// `eval.estimate`: the model each task would use (or why it would be skipped) and the cost.
    pub fn estimate(&self, cfg: &EvalConfig, catalog: &Catalog) -> Result<Value> {
        let cfg = &self.resolved(cfg)?;
        let suite = self.validate(cfg, catalog)?;
        let mut planned = Vec::new();
        let mut skipped = Vec::new();
        for t in suite.manifest.tasks.iter().filter(|t| cfg.tasks.contains(&t.id)) {
            match suite.planned_model(t, cfg.model.as_deref(), cfg.source.as_deref()) {
                Ok(m) => planned.push((t.id.clone(), t.kind.clone(), m)),
                Err(reason) => skipped.push(json!({"id": t.id, "reason": reason})),
            }
        }
        let obs = eval_history::load_observations(&self.repo_root);
        let est = eval_history::estimate(&obs, &planned, cfg.repeat);
        Ok(json!({"estimate": est, "skipped": skipped}))
    }

    /// `eval.start`: run in the background; progress comes through the returned receiver.
    /// A second run while one is going is refused.
    pub fn start(self: &Arc<Self>, cfg: &EvalConfig, catalog: &Catalog) -> Result<mpsc::UnboundedReceiver<EvalProgress>> {
        let cfg = &self.resolved(cfg)?;
        let suite = self.validate(cfg, catalog)?;
        let cancel = CancelFlag::default();
        {
            let mut running = self.running.lock().unwrap_or_else(|e| e.into_inner());
            if running.is_some() {
                bail!("an eval run is already in progress");
            }
            *running = Some(cancel.clone());
        }
        self.events.lock().unwrap_or_else(|e| e.into_inner()).clear();
        let (tx, rx) = mpsc::unbounded_channel();
        let opts = Self::options(cfg);
        let repo_root = self.repo_root.clone();
        let host = Arc::clone(self);
        tokio::spawn(async move {
            let mut on = {
                let tx = tx.clone();
                let host = Arc::clone(&host);
                move |p: EvalProgress| {
                    host.record(&p);
                    let _ = tx.send(p);
                }
            };
            let result = eval_runner::run_with(&suite, &opts, &cancel, &mut on).await;
            match result.and_then(|summary| eval_runner::save_run(&summary, &repo_root, opts.history)) {
                Ok(_) => {}
                Err(e) => {
                    let p = EvalProgress::Failed { message: format!("{e:#}") };
                    host.record(&p);
                    let _ = tx.send(p);
                }
            }
            *host.running.lock().unwrap_or_else(|e| e.into_inner()) = None;
        });
        Ok(rx)
    }

    /// `eval.cancel`: stop the current run (no-op when idle).
    pub fn cancel(&self) -> bool {
        match self.running.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
            Some(flag) => {
                flag.store(true, Ordering::Relaxed);
                true
            }
            None => false,
        }
    }

    /// `eval.runs`: recent `results/metrics-*.json`, newest first.
    pub fn runs(&self, limit: usize) -> Value {
        let dir = self.repo_root.join("evals/results");
        let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
            .map(|d| {
                d.flatten()
                    .map(|e| e.path())
                    .filter(|p| {
                        p.file_name()
                            .and_then(|n| n.to_str())
                            .is_some_and(|n| n.starts_with("metrics-") && n.ends_with(".json"))
                    })
                    .collect()
            })
            .unwrap_or_default();
        files.sort();
        files.reverse();
        let runs: Vec<Value> = files
            .iter()
            .take(limit)
            .filter_map(|p| std::fs::read_to_string(p).ok())
            .filter_map(|t| serde_json::from_str::<Value>(&t).ok())
            .map(|v| {
                let failed: Vec<Value> = v["tasks"]
                    .as_array()
                    .map(|ts| {
                        ts.iter()
                            .filter(|t| matches!(t["status"].as_str(), Some("FAIL" | "ERROR")))
                            .map(|t| t["id"].clone())
                            .collect()
                    })
                    .unwrap_or_default();
                json!({
                    "run_id": v["run_id"], "suite": v["suite"], "profile": v["profile"],
                    "started_at": v["started_at"], "counts": v["counts"],
                    "total_cost_usd": v["total_cost_usd"], "stopped": v["stopped"],
                    "tasks": v["tasks"], "failed": failed,
                })
            })
            .collect();
        json!({"runs": runs})
    }

    /// `eval.task`: the latest attempt (or `attempt`) of one task: report, audit tail, files
    /// changed against the fixture.
    pub fn task_detail(&self, suite: &str, task_id: &str, attempt: Option<u32>) -> Result<Value> {
        let s = self.load(suite)?;
        if !s.manifest.tasks.iter().any(|t| t.id == task_id) {
            bail!("unknown task {task_id}");
        }
        let root = s.results_dir.join(task_id);
        let attempts = attempt_numbers(&root);
        let n = match attempt {
            Some(n) if attempts.contains(&n) => n,
            Some(n) => bail!("no attempt {n} for {task_id}"),
            None => *attempts.last().ok_or_else(|| anyhow!("{task_id} has not run yet"))?,
        };
        let dir = attempt_dir(&s.results_dir, task_id, n);
        let report = read_capped(&dir.join("report.md"), MAX_REPORT_BYTES);
        let audit: Vec<String> = std::fs::read_to_string(dir.join("audit.jsonl"))
            .unwrap_or_default()
            .lines()
            .rev()
            .take(MAX_AUDIT_LINES)
            .map(str::to_string)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        let ws = dir.join("workspace");
        let files = changed_files(&s.fixture, &ws);
        // Older attempts (before checks/trace were written) give null / [].
        let checks: Value = std::fs::read_to_string(dir.join("checks.json"))
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
            .unwrap_or(Value::Null);
        let trace = crate::eval_trace::read(&dir.join("trace.jsonl"));
        Ok(json!({
            "suite": suite, "task_id": task_id, "attempt": n, "attempts": attempts,
            "workspace": ws.to_string_lossy(), "report": report, "audit": audit, "files": files,
            "checks": checks, "trace": trace,
        }))
    }
}

/// `attempt-<n>` folders under a task's results, ascending.
fn attempt_numbers(root: &Path) -> Vec<u32> {
    let mut out: Vec<u32> = std::fs::read_dir(root)
        .map(|d| {
            d.flatten()
                .filter_map(|e| e.file_name().to_str()?.strip_prefix("attempt-")?.parse().ok())
                .collect()
        })
        .unwrap_or_default();
    out.sort_unstable();
    out
}

fn read_capped(path: &Path, max: usize) -> String {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    if text.len() <= max {
        return text;
    }
    let mut cut = max;
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{}\n…", &text[..cut])
}

/// Files that differ between the fixture and an attempt's workspace (added / modified /
/// deleted), with both sides for small text files. Caches and VCS folders are skipped.
fn changed_files(fixture: &Path, ws: &Path) -> Vec<Value> {
    let mut paths = std::collections::BTreeSet::new();
    collect(fixture, fixture, &mut paths);
    collect(ws, ws, &mut paths);
    let mut out = Vec::new();
    for rel in paths {
        let a = fixture.join(&rel);
        let b = ws.join(&rel);
        let (ba, bb) = (std::fs::read(&a).ok(), std::fs::read(&b).ok());
        if ba == bb {
            continue;
        }
        let status = match (&ba, &bb) {
            (None, Some(_)) => "added",
            (Some(_), None) => "deleted",
            _ => "modified",
        };
        let text = |p: &Path, bytes: &Option<Vec<u8>>| -> Option<String> {
            let len = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
            if len > MAX_DIFF_BYTES {
                return None;
            }
            bytes.as_ref().and_then(|b| String::from_utf8(b.clone()).ok())
        };
        out.push(json!({
            "path": rel.replace('\\', "/"),
            "status": status,
            "before": text(&a, &ba).unwrap_or_default(),
            "after": text(&b, &bb).unwrap_or_default(),
            "binary": (ba.is_some() && text(&a, &ba).is_none()) || (bb.is_some() && text(&b, &bb).is_none()),
        }));
        if out.len() >= MAX_DIFF_FILES {
            break;
        }
    }
    out
}

fn collect(base: &Path, dir: &Path, out: &mut std::collections::BTreeSet<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if matches!(name.as_str(), "__pycache__" | ".git" | "node_modules" | ".pytest_cache" | ".silence") {
            continue;
        }
        let p = e.path();
        if p.is_dir() {
            collect(base, &p, out);
        } else if let Ok(rel) = p.strip_prefix(base) {
            out.insert(rel.to_string_lossy().into_owned());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn host(_: &Path) -> EvalHost {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        EvalHost::new(repo.clone(), repo.join("config/models.yaml"))
    }

    fn cfg(suite: &str, tasks: &[&str]) -> EvalConfig {
        EvalConfig {
            suite: suite.into(),
            tasks: tasks.iter().map(|s| s.to_string()).collect(),
            source: None,
            model: None,
            effort: None,
            repeat: 1,
            retry_failed: false,
            max_cost: None,
            history: false,
        }
    }

    /// A host on a scratch repo (own `evals/`), so `eval.config.set` never touches the real file.
    fn scratch_host() -> (EvalHost, tempfile::TempDir, Catalog) {
        let real = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("evals")).unwrap();
        let catalog = Catalog::load(real.join("config/models.yaml")).unwrap();
        (EvalHost::new(dir.path().to_path_buf(), real.join("config/models.yaml")), dir, catalog)
    }

    #[tokio::test]
    async fn config_get_lists_every_source_and_set_round_trips() {
        let (h, dir, catalog) = scratch_host();
        let v = h.config_get(&catalog).await.unwrap();
        assert_eq!(v["exists"], false);
        assert_eq!(v["path"], "evals/config.yaml");
        let rows = v["sources"].as_array().unwrap();
        let cli = rows.iter().find(|r| r["id"] == "claude-cli").expect("the CLI is a local source");
        assert_eq!(cli["cli"], true);
        assert!(rows.iter().all(|r| r["ready"].is_boolean() && r["reason"].is_string()));

        let mut settings = v["settings"].clone();
        settings["source"] = json!("claude-cli");
        settings["profiles"]["smoke"]["max_cost"] = json!(0.2);
        h.config_set(settings, &catalog).unwrap();
        assert!(dir.path().join("evals/config.yaml").exists());
        let after = h.config_get(&catalog).await.unwrap();
        assert_eq!(after["settings"]["source"], "claude-cli");
        assert_eq!(after["settings"]["profiles"]["smoke"]["max_cost"], 0.2);
        // A Studio run without a source now uses the configured one; `per-task` keeps the pins.
        assert_eq!(h.resolved(&cfg("v0", &["E01-edit-add-pow"])).unwrap().source.as_deref(), Some("claude-cli"));
        let mut per_task = cfg("v0", &["E01-edit-add-pow"]);
        per_task.source = Some("per-task".into());
        assert_eq!(h.resolved(&per_task).unwrap().source, None);
    }

    #[test]
    fn config_set_refuses_the_cli_for_ci_and_writes_nothing() {
        let (h, dir, catalog) = scratch_host();
        let mut bad = serde_json::to_value(crate::eval_config::EvalSettings::default()).unwrap();
        bad["ci"]["source"] = json!("claude-cli");
        assert!(h.config_set(bad, &catalog).is_err());
        assert!(!dir.path().join("evals/config.yaml").exists());
        assert!(h.config_set(json!({"source": 5}), &catalog).is_err());
    }

    #[tokio::test]
    async fn catalog_lists_shipped_suites_and_sources() {
        let h = host(Path::new("."));
        let catalog = Catalog::load(&h.config_path).unwrap();
        let v = h.catalog(&catalog).await.unwrap();
        assert_eq!(v["available"], true);
        let names: Vec<&str> = v["suites"].as_array().unwrap().iter().map(|s| s["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"v0") && names.contains(&"modes"), "{names:?}");
        assert!(v["sources"].as_array().unwrap().len() >= 3);
    }

    #[test]
    fn status_replays_the_current_run_until_the_next_start() {
        let h = Arc::new(host(Path::new(".")));
        assert_eq!(h.status(), json!({"running": false, "events": []}));
        h.record(&EvalProgress::Started { run_id: "r1".into(), suite: "v0".into(), tasks: vec!["A".into()] });
        h.record(&EvalProgress::TaskStarted { id: "A".into(), model: "claude-haiku".into(), attempt: 1 });
        let v = h.status();
        assert_eq!(v["running"], false);
        let kinds: Vec<&str> = v["events"].as_array().unwrap().iter().map(|e| e["type"].as_str().unwrap()).collect();
        assert_eq!(kinds, ["started", "task_started"]);
        assert_eq!(v["events"][0]["run_id"], "r1");

        // A refused start (bad config) keeps the last run's events.
        let catalog = Catalog::load(&h.config_path).unwrap();
        assert!(h.start(&cfg("v0", &["NOPE"]), &catalog).is_err());
        assert_eq!(h.status()["events"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn config_is_checked_before_anything_runs() {
        let h = host(Path::new("."));
        let catalog = Catalog::load(&h.config_path).unwrap();
        assert!(h.validate(&cfg("../config", &["x"]), &catalog).is_err(), "no paths from the client");
        assert!(h.validate(&cfg("v0", &[]), &catalog).is_err(), "at least one task");
        assert!(h.validate(&cfg("v0", &["NOPE"]), &catalog).is_err());
        let mut c = cfg("v0", &["E01-edit-add-pow"]);
        c.source = Some("nope".into());
        assert!(h.validate(&c, &catalog).is_err());
        c.source = Some("claude-api".into());
        c.repeat = 9;
        assert!(h.validate(&c, &catalog).is_err());
        c.repeat = 2;
        assert!(h.validate(&c, &catalog).is_ok());
    }

    #[test]
    fn estimate_maps_models_to_the_source() {
        let h = host(Path::new("."));
        let catalog = Catalog::load(&h.config_path).unwrap();
        let mut c = cfg("v0", &["E01-edit-add-pow"]);
        c.source = Some("claude-api".into());
        let v = h.estimate(&c, &catalog).unwrap();
        let model = v["estimate"]["tasks"][0]["model"].as_str().unwrap().to_string();
        assert!(model.ends_with("@api"), "{model}");
        c.source = Some("claude-cli".into());
        let v = h.estimate(&c, &catalog).unwrap();
        assert!(v["estimate"]["tasks"][0]["model"].as_str().unwrap().ends_with("@cli"));
    }

    #[test]
    fn diff_lists_added_modified_deleted() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        std::fs::write(a.path().join("same.txt"), "x").unwrap();
        std::fs::write(b.path().join("same.txt"), "x").unwrap();
        std::fs::write(a.path().join("mod.txt"), "old").unwrap();
        std::fs::write(b.path().join("mod.txt"), "new").unwrap();
        std::fs::write(a.path().join("gone.txt"), "x").unwrap();
        std::fs::write(b.path().join("new.txt"), "y").unwrap();
        std::fs::create_dir(b.path().join("__pycache__")).unwrap();
        std::fs::write(b.path().join("__pycache__/c.pyc"), "z").unwrap();
        let files = changed_files(a.path(), b.path());
        let got: Vec<(String, String)> = files
            .iter()
            .map(|f| (f["path"].as_str().unwrap().to_string(), f["status"].as_str().unwrap().to_string()))
            .collect();
        assert_eq!(
            got,
            vec![
                ("gone.txt".into(), "deleted".into()),
                ("mod.txt".into(), "modified".into()),
                ("new.txt".into(), "added".into())
            ]
        );
        assert_eq!(files[1]["before"], "old");
    }

    #[test]
    fn attempts_are_found_in_order() {
        let d = tempfile::tempdir().unwrap();
        for n in [2, 1, 10] {
            std::fs::create_dir_all(d.path().join(format!("attempt-{n}"))).unwrap();
        }
        assert_eq!(attempt_numbers(d.path()), vec![1, 2, 10]);
    }
}
