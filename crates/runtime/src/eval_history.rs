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
    pub cost_usd: f64,
    pub duration_secs: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
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
         | Run | Bộ | Profile | Commit | ✓ | ✗ | ⚠ | – | Chi (USD) | Dừng sớm |\n\
         |---|---|---|---|---:|---:|---:|---:|---:|---|\n"
    ));
    for l in lines.iter().rev().take(RECENT_RUNS) {
        s.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} | {} | {} | {:.4} | {} |\n",
            l.run_id,
            l.suite,
            l.profile,
            l.git_sha,
            l.pass,
            l.fail,
            l.error,
            l.skip,
            l.total_cost_usd,
            l.stopped.as_deref().unwrap_or("")
        ));
    }
    s
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
}
