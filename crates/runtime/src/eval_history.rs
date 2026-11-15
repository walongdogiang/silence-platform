//! Eval history: one JSON line per run in `evals/history/runs.jsonl` (committed) and a
//! generated `evals/history/SUMMARY.md`. Hướng dẫn: `evals/README.md`.

use crate::eval_runner::{RunMetrics, Status};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Runs with this profile are calibration ladders: counted in cost, not in task status.
pub const CALIBRATE_PROFILE: &str = "calibrate";
/// Statuses shown per task in the summary grid.
const GRID_RUNS: usize = 10;
/// Rows in the "recent runs" table.
const RECENT_RUNS: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HistoryTask {
    pub id: String,
    pub kind: String,
    pub model: String,
    pub status: Status,
    pub passes: u32,
    pub attempts: u32,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub flaky: bool,
    pub input_tokens: u64,
    pub output_tokens: u64,
    /// Part of `input_tokens` read from the prompt cache (absent in older lines).
    #[serde(default, skip_serializing_if = "is_zero")]
    pub cache_read_tokens: u64,
    /// Model calls (agent steps) of the task (absent in older lines).
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub model_calls: u32,
    pub cost_usd: f64,
    pub duration_secs: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

fn is_zero(n: &u64) -> bool {
    *n == 0
}

fn is_zero_u32(n: &u32) -> bool {
    *n == 0
}

impl HistoryLine {
    /// Share of the run's input tokens served from the prompt cache.
    pub fn cache_hit_rate(&self) -> f64 {
        let input: u64 = self.tasks.iter().map(|t| t.input_tokens).sum();
        let read: u64 = self.tasks.iter().map(|t| t.cache_read_tokens).sum();
        if input == 0 {
            0.0
        } else {
            read as f64 / input as f64
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HistoryLine {
    pub run_id: String,
    pub started_at: String,
    pub git_sha: String,
    pub suite: String,
    pub profile: String,
    pub repeat: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stopped: Option<String>,
    pub total_cost_usd: f64,
    pub pass: u32,
    pub fail: u32,
    pub error: u32,
    pub skip: u32,
    pub tasks: Vec<HistoryTask>,
}

fn round(x: f64, places: i32) -> f64 {
    let f = 10f64.powi(places);
    (x * f).round() / f
}

impl From<&RunMetrics> for HistoryLine {
    fn from(r: &RunMetrics) -> Self {
        Self {
            run_id: r.meta.run_id.clone(),
            started_at: r.meta.started_at.clone(),
            git_sha: r.meta.git_sha.clone(),
            suite: r.meta.suite.clone(),
            profile: r.meta.profile.clone(),
            repeat: r.meta.repeat,
            stopped: r.stopped.clone(),
            total_cost_usd: round(r.total_cost_usd, 4),
            pass: r.counts.pass,
            fail: r.counts.fail,
            error: r.counts.error,
            skip: r.counts.skip,
            tasks: r
                .tasks
                .iter()
                .map(|t| HistoryTask {
                    id: t.id.clone(),
                    kind: t.kind.clone(),
                    model: t.model.clone(),
                    status: t.status,
                    passes: t.passes,
                    attempts: t.attempts,
                    flaky: t.flaky,
                    input_tokens: t.input_tokens,
                    output_tokens: t.output_tokens,
                    cache_read_tokens: t.cache_read_tokens,
                    model_calls: t.model_calls,
                    cost_usd: round(t.cost_usd, 4),
                    duration_secs: round(t.duration_secs, 1),
                    error_code: t.error_code.clone(),
                })
                .collect(),
        }
    }
}

pub fn history_dir(repo_root: &Path) -> PathBuf {
    repo_root.join("evals/history")
}

pub fn append(repo_root: &Path, run: &RunMetrics) -> Result<()> {
    let dir = history_dir(repo_root);
    std::fs::create_dir_all(&dir)?;
    let line = serde_json::to_string(&HistoryLine::from(run))?;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("runs.jsonl"))
        .context("open runs.jsonl")?;
    writeln!(f, "{line}")?;
    Ok(())
}

/// All parseable lines of `runs.jsonl` (a bad line is reported and skipped).
pub fn load(repo_root: &Path) -> Result<Vec<HistoryLine>> {
    let path = history_dir(repo_root).join("runs.jsonl");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(&path)?;
    Ok(parse_lines(&text))
}

fn parse_lines(text: &str) -> Vec<HistoryLine> {
    text.lines()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty())
        .filter_map(|(i, l)| match serde_json::from_str(l) {
            Ok(h) => Some(h),
            Err(e) => {
                eprintln!("runs.jsonl line {}: {e}", i + 1);
                None
            }
        })
        .collect()
}

pub fn write_summary(repo_root: &Path) -> Result<PathBuf> {
    let lines = load(repo_root)?;
    let dir = history_dir(repo_root);
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("SUMMARY.md");
    std::fs::write(&path, render_summary(&lines))?;
    Ok(path)
}

fn mark(t: &HistoryTask) -> &'static str {
    match t.status {
        Status::Pass if t.flaky => "~",
        Status::Pass => "✓",
        Status::Fail => "✗",
        Status::Error => "⚠",
        Status::Skip => "–",
    }
}

/// `20261113-101500` → `2026-11`.
fn month(run_id: &str) -> String {
    if run_id.len() >= 6 {
        format!("{}-{}", &run_id[..4], &run_id[4..6])
    } else {
        "?".into()
    }
}

pub fn render_summary(lines: &[HistoryLine]) -> String {
    let mut s = String::from(
        "# Eval: tổng hợp\n\n\
         > Sinh tự động từ `runs.jsonl` bởi `npm run evals:report` (và mỗi lần chạy `--history`). Không sửa tay.\n\n",
    );
    let Some(last) = lines.last() else {
        s.push_str("Chưa có lần chạy nào.\n");
        return s;
    };
    let total: f64 = lines.iter().map(|l| l.total_cost_usd).sum();
    s.push_str(&format!(
        "Đến lần chạy `{}`: {} lần chạy, tổng chi ${:.2}.\n\n",
        last.run_id,
        lines.len(),
        total
    ));

    s.push_str("## Chi phí theo tháng\n\n| Tháng | Lần chạy | Chi (USD) |\n|---|---:|---:|\n");
    let mut by_month: BTreeMap<String, (u32, f64)> = BTreeMap::new();
    for l in lines {
        let e = by_month.entry(month(&l.run_id)).or_default();
        e.0 += 1;
        e.1 += l.total_cost_usd;
    }
    for (m, (n, usd)) in by_month.iter().rev() {
        s.push_str(&format!("| {m} | {n} | {usd:.2} |\n"));
    }

    s.push_str(&format!(
        "\n## Trạng thái từng task\n\n\
         {GRID_RUNS} lần gần nhất, mới nhất bên phải: ✓ pass · ✗ fail · ⚠ lỗi hạ tầng · ~ flaky · – bỏ qua. \
         Không tính lượt hiệu chỉnh. Tỉ lệ pass bỏ qua ⚠ và –.\n\n\
         | Bộ | Task | Model gần nhất | Lịch sử | Pass |\n|---|---|---|---|---:|\n"
    ));
    let mut grid: BTreeMap<(String, String), Vec<&HistoryTask>> = BTreeMap::new();
    for l in lines.iter().filter(|l| l.profile != CALIBRATE_PROFILE) {
        for t in &l.tasks {
            grid.entry((l.suite.clone(), t.id.clone())).or_default().push(t);
        }
    }
    for ((suite, id), runs) in &grid {
        let recent = &runs[runs.len().saturating_sub(GRID_RUNS)..];
        let marks: String = recent.iter().map(|t| mark(t)).collect::<Vec<_>>().join("");
        let judged: Vec<_> = recent
            .iter()
            .filter(|t| matches!(t.status, Status::Pass | Status::Fail))
            .collect();
        let passed = judged.iter().filter(|t| t.status == Status::Pass).count();
        let model = recent.last().map(|t| t.model.as_str()).unwrap_or("");
        s.push_str(&format!(
            "| {suite} | {id} | {model} | {marks} | {passed}/{} |\n",
            judged.len()
        ));
    }

    s.push_str(&format!(
        "\n## {RECENT_RUNS} lần chạy gần nhất\n\n\
         | Run | Bộ | Profile | Commit | ✓ | ✗ | ⚠ | – | Chi (USD) | Cache | Dừng sớm |\n\
         |---|---|---|---|---:|---:|---:|---:|---:|---:|---|\n"
    ));
    for l in lines.iter().rev().take(RECENT_RUNS) {
        s.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} | {} | {} | {:.4} | {:.0}% | {} |\n",
            l.run_id,
            l.suite,
            l.profile,
            l.git_sha,
            l.pass,
            l.fail,
            l.error,
            l.skip,
            l.total_cost_usd,
            l.cache_hit_rate() * 100.0,
            l.stopped.as_deref().unwrap_or("")
        ));
    }
    s
}

/// One task result of a past run, from `runs.jsonl` or a `results/metrics-*.json` file
/// (manual runs from Studio usually skip `--history`, so both count).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Observation {
    pub run_id: String,
    pub suite: String,
    pub profile: String,
    pub id: String,
    pub kind: String,
    pub model: String,
    pub status: Status,
    pub cost_usd: f64,
}

/// `results/metrics-<run>.json`, only the fields observations need.
#[derive(Deserialize)]
struct MetricsFile {
    run_id: String,
    #[serde(default)]
    suite: String,
    #[serde(default)]
    profile: String,
    #[serde(default)]
    tasks: Vec<MetricsTask>,
}

#[derive(Deserialize)]
struct MetricsTask {
    id: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    model: String,
    status: Status,
    #[serde(default)]
    cost_usd: f64,
}

/// Judged runs (pass/fail, calibration excluded) of `id` in `suite` that failed in a row,
/// counting back from the newest. `obs` is newest first ([`load_observations`]).
pub fn fail_streak(obs: &[Observation], suite: &str, id: &str) -> usize {
    obs.iter()
        .filter(|o| o.suite == suite && o.id == id && o.profile != CALIBRATE_PROFILE)
        .filter(|o| matches!(o.status, Status::Pass | Status::Fail))
        .take_while(|o| o.status == Status::Fail)
        .count()
}

/// Run id of the newest non-skipped run of `id` in `suite` (`None` = never ran). Run ids are
/// `YYYYMMDD-HHMMSS`, so they sort by time.
pub fn last_run(obs: &[Observation], suite: &str, id: &str) -> Option<String> {
    obs.iter()
        .filter(|o| o.suite == suite && o.id == id && o.status != Status::Skip)
        .map(|o| o.run_id.clone())
        .max()
}

/// Every observation from history and metrics files, newest run first, one per (run, task).
pub fn load_observations(repo_root: &Path) -> Vec<Observation> {
    let mut out: Vec<Observation> = Vec::new();
    for l in load(repo_root).unwrap_or_default() {
        for t in l.tasks {
            out.push(Observation {
                run_id: l.run_id.clone(),
                suite: l.suite.clone(),
                profile: l.profile.clone(),
                id: t.id,
                kind: t.kind,
                model: t.model,
                status: t.status,
                cost_usd: t.cost_usd,
            });
        }
    }
    let results = repo_root.join("evals/results");
    if let Ok(dir) = std::fs::read_dir(&results) {
        for e in dir.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if !(name.starts_with("metrics-") && name.ends_with(".json")) {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(e.path()) else { continue };
            let Ok(m) = serde_json::from_str::<MetricsFile>(&text) else { continue };
            for t in m.tasks {
                out.push(Observation {
                    run_id: m.run_id.clone(),
                    suite: m.suite.clone(),
                    profile: m.profile.clone(),
                    id: t.id,
                    kind: t.kind,
                    model: t.model,
                    status: t.status,
                    cost_usd: t.cost_usd,
                });
            }
        }
    }
    out.sort_by(|a, b| b.run_id.cmp(&a.run_id));
    let mut seen = std::collections::HashSet::new();
    out.retain(|o| seen.insert((o.run_id.clone(), o.id.clone())));
    out
}

/// Latest non-skipped result of a task in a suite.
pub fn last_result<'a>(obs: &'a [Observation], suite: &str, id: &str) -> Option<&'a Observation> {
    obs.iter().find(|o| o.suite == suite && o.id == id && o.status != Status::Skip)
}

/// `claude-haiku@api` → `claude-haiku`: costs compare across sources of one model.
fn family(model: &str) -> &str {
    model.split('@').next().unwrap_or(model)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TaskEstimate {
    pub id: String,
    pub model: String,
    /// `None` = no past run to estimate from.
    pub usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Estimate {
    pub tasks: Vec<TaskEstimate>,
    pub total_usd: f64,
    /// Tasks without any estimate (not in `total_usd`).
    pub unknown: usize,
}

/// Cost of running `tasks` (`(id, kind, model)`) `repeat` times: the mean of the task's last 3
/// paid runs on the same model family (any model for `auto`), else the mean of its kind on that
/// family (last 20), else unknown. Calibration ladders are left out.
pub fn estimate(obs: &[Observation], tasks: &[(String, String, String)], repeat: u32) -> Estimate {
    let usable = |o: &&Observation| o.profile != CALIBRATE_PROFILE && o.status != Status::Skip && o.cost_usd > 0.0;
    let same = |o: &Observation, model: &str| model == "auto" || family(&o.model) == family(model);
    let mean = |v: Vec<f64>| (!v.is_empty()).then(|| v.iter().sum::<f64>() / v.len() as f64);
    let mut out = Vec::new();
    let (mut total, mut unknown) = (0.0, 0);
    for (id, kind, model) in tasks {
        let own = mean(obs.iter().filter(usable).filter(|o| &o.id == id && same(o, model)).take(3).map(|o| o.cost_usd).collect());
        let usd = own.or_else(|| {
            mean(obs.iter().filter(usable).filter(|o| &o.kind == kind && same(o, model)).take(20).map(|o| o.cost_usd).collect())
        });
        let usd = usd.map(|u| u * repeat.max(1) as f64);
        match usd {
            Some(u) => total += u,
            None => unknown += 1,
        }
        out.push(TaskEstimate { id: id.clone(), model: model.clone(), usd });
    }
    Estimate { tasks: out, total_usd: total, unknown }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eval_runner::{RunMeta, TaskMetrics};

    fn task(id: &str, status: Status, cost: f64) -> TaskMetrics {
        let mut t = TaskMetrics::new(id, "edit");
        t.status = status;
        t.model = "claude-haiku".into();
        t.attempts = 1;
        t.passes = u32::from(status == Status::Pass);
        t.cost_usd = cost;
        t
    }

    fn run(run_id: &str, profile: &str, tasks: Vec<TaskMetrics>) -> RunMetrics {
        let meta = RunMeta {
            run_id: run_id.into(),
            started_at: "2026-11-13T10:00:00+07:00".into(),
            git_sha: "abc1234".into(),
            suite: "v0".into(),
            profile: profile.into(),
            repeat: 1,
        };
        RunMetrics::new(meta, tasks, None)
    }

    fn obs(run_id: &str, profile: &str, id: &str, status: Status) -> Observation {
        Observation {
            run_id: run_id.into(),
            suite: "v0".into(),
            profile: profile.into(),
            id: id.into(),
            kind: "edit".into(),
            model: "claude-haiku".into(),
            status,
            cost_usd: 0.01,
        }
    }

    #[test]
    fn fail_streak_counts_judged_failures_from_the_newest() {
        // Newest first; skips, errors and calibration runs do not break or extend the streak.
        let o = vec![
            obs("5", "nightly", "T", Status::Fail),
            obs("4", "nightly", "T", Status::Skip),
            obs("3", "nightly", "T", Status::Error),
            obs("3", CALIBRATE_PROFILE, "T", Status::Pass),
            obs("2", "weekly", "T", Status::Fail),
            obs("1", "weekly", "T", Status::Pass),
            obs("0", "weekly", "T", Status::Fail),
            obs("5", "nightly", "U", Status::Pass),
        ];
        assert_eq!(fail_streak(&o, "v0", "T"), 2);
        assert_eq!(fail_streak(&o, "v0", "U"), 0);
        assert_eq!(fail_streak(&o, "modes", "T"), 0);
    }

    #[test]
    fn last_run_ignores_skips_and_orders_never_run_first() {
        let o = vec![
            obs("20261115-010000", "nightly", "A", Status::Skip),
            obs("20261114-010000", "nightly", "A", Status::Fail),
            obs("20261113-010000", "nightly", "B", Status::Pass),
        ];
        assert_eq!(last_run(&o, "v0", "A").as_deref(), Some("20261114-010000"));
        let mut ids = vec!["A", "B", "C"];
        ids.sort_by_cached_key(|id| last_run(&o, "v0", id));
        assert_eq!(ids, ["C", "B", "A"]);
    }

    #[test]
    fn history_line_roundtrip() {
        let r = run("20261113-100000", "nightly", vec![task("E01", Status::Pass, 0.012345678)]);
        let line = HistoryLine::from(&r);
        assert_eq!(line.tasks[0].cost_usd, 0.0123);
        let json = serde_json::to_string(&line).unwrap();
        assert!(!json.contains('\n'));
        assert!(!json.contains("flaky"), "false flaky omitted: {json}");
        assert!(json.contains(r#""status":"PASS""#));
        let back: Vec<HistoryLine> = parse_lines(&format!("{json}\nnot json\n\n{json}\n"));
        assert_eq!(back.len(), 2);
        assert_eq!(back[0], line);
    }

    #[test]
    fn summary_grid_costs_and_recent_runs() {
        let mut flaky = task("E01", Status::Pass, 0.01);
        flaky.flaky = true;
        let lines: Vec<HistoryLine> = [
            run("20261030-100000", "nightly", vec![task("E01", Status::Fail, 0.01), task("B06", Status::Error, 0.0)]),
            run("20261113-100000", CALIBRATE_PROFILE, vec![task("E01", Status::Fail, 1.0)]),
            run("20261113-110000", "weekly", vec![flaky, task("B06", Status::Pass, 0.02)]),
        ]
        .iter()
        .map(HistoryLine::from)
        .collect();
        let md = render_summary(&lines);
        assert!(md.contains("3 lần chạy, tổng chi $1.04"), "{md}");
        assert!(md.contains("| 2026-11 | 2 | 1.03 |"), "{md}");
        assert!(md.contains("| 2026-10 | 1 | 0.01 |"), "{md}");
        // Calibration rows stay out of the grid: E01 = fail then flaky pass.
        assert!(md.contains("| v0 | E01 | claude-haiku | ✗~ | 1/2 |"), "{md}");
        // Infra errors are shown but not judged.
        assert!(md.contains("| v0 | B06 | claude-haiku | ⚠✓ | 1/1 |"), "{md}");
        let recent = md.split("lần chạy gần nhất").nth(1).unwrap();
        assert!(recent.find("20261113-110000").unwrap() < recent.find("20261030-100000").unwrap());
        assert_eq!(render_summary(&[]).contains("Chưa có lần chạy nào"), true);
    }

    #[test]
    fn estimate_uses_task_then_kind_then_unknown() {
        let o = |run: &str, id: &str, kind: &str, model: &str, usd: f64, profile: &str| Observation {
            run_id: run.into(),
            suite: "v0".into(),
            profile: profile.into(),
            id: id.into(),
            kind: kind.into(),
            model: model.into(),
            status: Status::Pass,
            cost_usd: usd,
        };
        let obs = vec![
            o("3", "E01", "edit", "claude-haiku@api", 0.02, "manual"),
            o("2", "E01", "edit", "claude-haiku", 0.04, "manual"),
            o("2", "E02", "edit", "claude-haiku", 0.10, "manual"),
            o("1", "E01", "edit", "claude-opus", 9.0, "manual"),
            o("1", "B06", "bugfix", "claude-haiku", 5.0, CALIBRATE_PROFILE),
        ];
        let t = |id: &str, kind: &str, model: &str| (id.to_string(), kind.to_string(), model.to_string());
        let e = estimate(&obs, &[t("E01", "edit", "claude-haiku"), t("E05", "edit", "claude-haiku"), t("B06", "bugfix", "claude-haiku")], 2);
        assert!((e.tasks[0].usd.unwrap() - 0.06).abs() < 1e-9, "mean 0.03 of the haiku family × 2");
        assert!((e.tasks[1].usd.unwrap() - 0.16 / 3.0 * 2.0).abs() < 1e-9, "kind mean");
        assert_eq!(e.tasks[2].usd, None, "calibration runs do not count");
        assert_eq!(e.unknown, 1);
        assert_eq!(last_result(&obs, "v0", "E01").unwrap().run_id, "3");
    }
}
