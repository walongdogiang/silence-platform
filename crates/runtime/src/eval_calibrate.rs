//! `silence-engine evals-calibrate`: find the cheapest model that passes each task and pin it
//! in `<suite>/models.yaml`. Hướng dẫn: `evals/README.md` → Hiệu chỉnh.
//!
//! Ladder Haiku → Sonnet → Opus; a model is pinned when it passes `repeat` attempts in a row.
//! An attempt that fails ends that model early (it can no longer pass every attempt).

use crate::eval_history::CALIBRATE_PROFILE;
use crate::eval_runner::{finish_run, is_fatal_error, RunMeta, RunMetrics, Status, Suite, UNSOLVED};
use anyhow::Result;
use std::path::Path;

/// Catalog ids, cheapest first.
pub const LADDER: [&str; 3] = ["claude-haiku", "claude-sonnet", "claude-opus"];

/// Attempts made on one model of the ladder.
#[derive(Debug, Clone)]
pub struct Tried {
    pub model: String,
    pub statuses: Vec<Status>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Pin {
    Model(String),
    /// Every model in the ladder failed.
    Unsolved,
    /// An infra error (or the budget) interrupted this model: no decision.
    Undecided(String),
}

/// Decision after the models tried so far; `None` = try the next model.
pub fn pick_model(tried: &[Tried], need: usize, ladder: &[&str]) -> Option<Pin> {
    for t in tried {
        if t.statuses.contains(&Status::Error) {
            return Some(Pin::Undecided(t.model.clone()));
        }
        if t.statuses.len() >= need.max(1) && t.statuses.iter().all(|s| *s == Status::Pass) {
            return Some(Pin::Model(t.model.clone()));
        }
    }
    let finished = tried
        .last()
        .is_some_and(|t| t.statuses.iter().any(|s| *s != Status::Pass));
    (finished && tried.len() >= ladder.len()).then_some(Pin::Unsolved)
}

/// `claude-haiku 0/1, claude-sonnet 2/2`.
pub fn reason(tried: &[Tried]) -> String {
    tried
        .iter()
        .map(|t| {
            let ok = t.statuses.iter().filter(|s| **s == Status::Pass).count();
            let err = if t.statuses.contains(&Status::Error) { " (lỗi hạ tầng)" } else { "" };
            format!("{} {ok}/{}{err}", t.model, t.statuses.len())
        })
        .collect::<Vec<_>>()
        .join(", ")
}

#[derive(Debug, Clone)]
pub struct CalibrateOptions {
    /// Calibrate only these ids (re-calibrates even if pinned).
    pub only: Vec<String>,
    /// Re-calibrate every task, pinned or not.
    pub all: bool,
    pub repeat: u32,
    pub max_cost: f64,
    pub history: bool,
}

pub async fn calibrate(dir: &Path, catalog_path: &Path, repo_root: &Path, opts: &CalibrateOptions) -> Result<i32> {
    let mut suite = Suite::load(dir, catalog_path, repo_root)?;
    let repeat = opts.repeat.max(1);
    let meta = RunMeta::now(&suite.name, CALIBRATE_PROFILE, repeat, repo_root);
    let mut rows = Vec::new();
    let mut spent = 0.0;
    let mut stopped: Option<String> = None;
    let mut decisions: Vec<String> = Vec::new();
    let mut changed = false;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();

    for task in &suite.manifest.tasks {
        let selected = if !opts.only.is_empty() {
            opts.only.contains(&task.id)
        } else {
            opts.all || !suite.pins.models.contains_key(&task.id)
        };
        if !selected {
            continue;
        }
        if task.model.is_some() {
            println!("SKIP {} (model ghim trong manifest)", task.id);
            continue;
        }
        if let Some(missing) = task.missing_env() {
            println!("SKIP {} ({missing} not set)", task.id);
            continue;
        }
        if stopped.is_some() {
            break;
        }
        let mut tried: Vec<Tried> = Vec::new();
        let mut pin = None;
        // Attempt folders `results/<id>/attempt-<n>/` number the whole ladder of this task.
        let mut n = 0;
        'ladder: for model in LADDER {
            let mut t = Tried { model: model.into(), statuses: Vec::new() };
            for _ in 0..repeat {
                if spent >= opts.max_cost {
                    stopped = Some(format!("đạt trần chi ${:.2}", opts.max_cost));
                    break 'ladder;
                }
                n += 1;
                let m = suite.attempt(task, model, n).await?;
                spent += m.cost_usd;
                println!("  {} {} {} ${:.4}", m.status.as_str(), task.id, model, m.cost_usd);
                let status = m.status;
                if let Some(code) = m.error_code.as_deref().filter(|c| is_fatal_error(c)) {
                    stopped = Some(format!("{code}: dừng hiệu chỉnh"));
                }
                rows.push(m);
                t.statuses.push(status);
                if status != Status::Pass {
                    break;
                }
            }
            tried.push(t);
            pin = pick_model(&tried, repeat as usize, &LADDER);
            if pin.is_some() || stopped.is_some() {
                break;
            }
        }
        let old = suite.pins.models.get(&task.id).cloned();
        let new = match &pin {
            Some(Pin::Model(m)) => Some(m.clone()),
            Some(Pin::Unsolved) => Some(UNSOLVED.to_string()),
            Some(Pin::Undecided(_)) | None => None,
        };
        let why = reason(&tried);
        match new {
            Some(new) => {
                println!("PIN {} → {new} ({why})", task.id);
                if old.as_deref() != Some(new.as_str()) {
                    decisions.push(format!(
                        "| {today} | {} | {} | {} → {new} | {why} | {} |",
                        suite.name,
                        task.id,
                        old.as_deref().unwrap_or("(chưa ghim)"),
                        meta.run_id
                    ));
                    suite.pins.models.insert(task.id.clone(), new);
                    changed = true;
                }
            }
            None => println!("UNDECIDED {} ({why}) — giữ nguyên ghim cũ", task.id),
        }
    }

    if changed {
        suite.pins.save(&suite.pins_path)?;
        println!("models.yaml: {}", suite.pins_path.display());
    }
    if !decisions.is_empty() {
        let draft = suite.results_dir.join(format!("decisions-{}.md", meta.run_id));
        std::fs::write(&draft, decisions.join("\n") + "\n")?;
        println!("\nDán vào evals/DECISIONS.md (nháp: {}):", draft.display());
        for d in &decisions {
            println!("{d}");
        }
    }
    // One row per attempt; the summary grid ignores calibration runs.
    let summary = RunMetrics::new(meta, rows, stopped);
    let code = finish_run(&summary, repo_root, opts.history)?;
    // Failed attempts are the point of a ladder: only infra problems make the exit non-zero.
    Ok(if code == 1 { 0 } else { code })
}

#[cfg(test)]
mod tests {
    use super::*;
    use Status::*;

    fn t(model: &str, s: &[Status]) -> Tried {
        Tried { model: model.into(), statuses: s.to_vec() }
    }

    #[test]
    fn haiku_passing_twice_is_pinned() {
        let tried = [t("claude-haiku", &[Pass, Pass])];
        assert_eq!(pick_model(&tried, 2, &LADDER), Some(Pin::Model("claude-haiku".into())));
        // Only one pass so far: keep going on the same model.
        assert_eq!(pick_model(&[t("claude-haiku", &[Pass])], 2, &LADDER), None);
    }

    #[test]
    fn climbs_the_ladder_on_failure() {
        let tried = [t("claude-haiku", &[Pass, Fail])];
        assert_eq!(pick_model(&tried, 2, &LADDER), None);
        let tried = [t("claude-haiku", &[Fail]), t("claude-sonnet", &[Fail]), t("claude-opus", &[Pass, Pass])];
        assert_eq!(pick_model(&tried, 2, &LADDER), Some(Pin::Model("claude-opus".into())));
        assert_eq!(reason(&tried), "claude-haiku 0/1, claude-sonnet 0/1, claude-opus 2/2");
    }

    #[test]
    fn unsolved_when_every_model_fails() {
        let tried = [t("claude-haiku", &[Fail]), t("claude-sonnet", &[Fail]), t("claude-opus", &[Pass, Fail])];
        assert_eq!(pick_model(&tried, 2, &LADDER), Some(Pin::Unsolved));
    }

    #[test]
    fn infra_error_leaves_task_undecided() {
        let tried = [t("claude-haiku", &[Fail]), t("claude-sonnet", &[Error])];
        assert_eq!(pick_model(&tried, 2, &LADDER), Some(Pin::Undecided("claude-sonnet".into())));
        assert!(reason(&tried).contains("claude-sonnet 0/1 (lỗi hạ tầng)"));
    }
}
