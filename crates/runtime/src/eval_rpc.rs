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
        Self { repo_root, config_path, running: Mutex::new(None) }
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
        }
    }

    /// `eval.estimate`: the model each task would use (or why it would be skipped) and the cost.
    pub fn estimate(&self, cfg: &EvalConfig, catalog: &Catalog) -> Result<Value> {
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
        let suite = self.validate(cfg, catalog)?;
        let cancel = CancelFlag::default();
        {
            let mut running = self.running.lock().unwrap_or_else(|e| e.into_inner());
            if running.is_some() {
                bail!("an eval run is already in progress");
            }
            *running = Some(cancel.clone());
        }
        let (tx, rx) = mpsc::unbounded_channel();
        let opts = Self::options(cfg);
        let repo_root = self.repo_root.clone();
        let host = Arc::clone(self);
        tokio::spawn(async move {
            let mut on = {
                let tx = tx.clone();
                move |p: EvalProgress| {
                    let _ = tx.send(p);
                }
            };
            let result = eval_runner::run_with(&suite, &opts, &cancel, &mut on).await;
            match result.and_then(|summary| eval_runner::save_run(&summary, &repo_root, opts.history)) {
                Ok(_) => {}
                Err(e) => {
                    let _ = tx.send(EvalProgress::Failed { message: format!("{e:#}") });
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
        Ok(json!({
            "suite": suite, "task_id": task_id, "attempt": n, "attempts": attempts,
            "workspace": ws.to_string_lossy(), "report": report, "audit": audit, "files": files,
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
    fn config_is_checked_before_anything_runs() {
        let h = host(Path::new("."));
        let catalog = Catalog::load(&h.config_path).unwrap();
        assert!(h.validate(&cfg("../config", &["x"]), &catalog).is_err(), "no paths from the client");
        assert!(h.validate(&cfg("v0", &[]), &catalog).is_err(), "at least one task");
        assert!(h.validate(&cfg("v0", &["NOPE"]), &catalog).is_err());
        let mut c = cfg("v0", &["E01-edit-add-pow"]);
        c.source = Some("nope".into());
        assert!(h.validate(&c, &catalog).is_err());
        c.source = Some("anthropic".into());
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
        c.source = Some("anthropic".into());
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
