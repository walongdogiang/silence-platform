//! `silence-engine evals-profile --profile smoke|nightly|weekly`: chạy một profile (các bước ở
//! [`crate::eval_config::steps`]) trên nguồn đã chọn. Cùng một lệnh cho máy (`npm run
//! evals:smoke|nightly|weekly`) và CI (`--ci`), nên đổi nguồn không đổi gì khác.
//!
//! Trước khi gọi model: kiểm nguồn dùng được chưa ([`crate::providers::source_ready`]), để thiếu
//! khoá hay CLI chưa đăng nhập ra một lời nhắn rõ thay vì mỗi task một lỗi.

use crate::eval_affects::{self, Affects, Selection};
use crate::eval_config::{self, EvalSettings};
use crate::eval_runner::{finish_run, print_progress, run_with, CancelFlag, RunOptions, Suite};
use anyhow::{bail, Result};
use silence_router::Catalog;
use std::path::Path;

/// Exit code khi nguồn chưa dùng được (khác 1 = có FAIL, 2 = lỗi hạ tầng / dừng sớm).
pub const EXIT_SOURCE_NOT_READY: i32 = 3;

#[derive(Debug, Clone, Default)]
pub struct ProfileOptions {
    pub profile: String,
    /// `--source`: provider id hoặc `per-task`; `None` = theo `evals/config.yaml`.
    pub source: Option<String>,
    /// Lượt CI: dùng `ci.source`, và không chạy gì khi CI đang tắt.
    pub ci: bool,
    /// Chỉ task bị ảnh hưởng bởi thay đổi từ commit này (CI nightly).
    pub affected_since: Option<String>,
    /// Chỉ kiểm cấu hình và nguồn, in `skip=true|false` (bước kiểm của workflow), không chạy task.
    pub check: bool,
}

/// Mức nghiêm trọng của exit code để gộp nhiều bước: FAIL > lỗi hạ tầng > sạch.
fn worse(a: i32, b: i32) -> i32 {
    let rank = |c: i32| match c {
        0 => 0,
        2 => 1,
        1 => 2,
        _ => 3,
    };
    if rank(b) > rank(a) {
        b
    } else {
        a
    }
}

/// Nguồn của lượt chạy: `--source` thắng, rồi `ci.source` (CI) hoặc `source` (máy).
pub fn profile_source(settings: &EvalSettings, cli: Option<&str>, ci: bool) -> Option<String> {
    let fallback = if ci { settings.ci.source.as_str() } else { settings.source.as_str() };
    eval_config::resolve_source(cli, fallback)
}

pub async fn run_profile(repo_root: &Path, catalog_path: &Path, o: &ProfileOptions) -> Result<i32> {
    let settings = eval_config::load(repo_root)?;
    let catalog = Catalog::load(catalog_path)?;
    settings.validate(&catalog)?;
    let steps = eval_config::steps(&o.profile, &settings.profiles)?;
    let gha = std::env::var_os("GITHUB_ACTIONS").is_some();

    if o.ci && !settings.ci_runs(&o.profile) {
        println!(
            "CI: lượt {} đang tắt trong evals/config.yaml (ci.enabled = {}, ci.{} ): không chạy task nào.",
            o.profile, settings.ci.enabled, o.profile
        );
        if o.check {
            println!("skip=true");
        }
        return Ok(0);
    }
    let source = profile_source(&settings, o.source.as_deref(), o.ci);
    if let Some(src) = &source {
        if o.ci && catalog.provider(src).is_ok_and(|p| p.is_cli()) {
            bail!("nguồn `{src}` cần đăng nhập trên máy nên không chạy được trên CI");
        }
        if let Err(why) = crate::providers::source_ready(&catalog, src).await {
            if gha {
                println!("::error title=Nguồn eval chưa dùng được::{src}: {why}");
            }
            eprintln!("nguồn `{src}` chưa dùng được: {why}");
            eprintln!("đổi nguồn: Studio → Evals → Cấu hình, hoặc `source:` trong evals/config.yaml, hoặc --source <id>");
            return Ok(EXIT_SOURCE_NOT_READY);
        }
    }
    println!(
        "profile {} · nguồn {}",
        o.profile,
        source.as_deref().unwrap_or("model ghim của từng task (per-task)")
    );
    if o.check {
        println!("skip=false");
        return Ok(0);
    }

    // Lọc theo thay đổi: CI nightly theo commit; smoke theo thay đổi của nhánh (cả chưa commit).
    let changed = match (&o.affected_since, o.profile.as_str()) {
        (Some(sha), _) => Some(eval_affects::changed_files(repo_root, sha)),
        (None, "smoke") => Some(eval_affects::changed_files_local(repo_root)),
        _ => None,
    };
    let selection = match changed {
        None => Selection::All,
        Some(Ok(files)) => {
            let sel = Affects::load(&repo_root.join("evals/affects.yaml"))?.select(&files)?;
            println!("{} file đổi → {}", files.len(), describe(&sel));
            sel
        }
        Some(Err(e)) => {
            println!("không xác định được thay đổi ({e:#}); chạy như không lọc");
            Selection::All
        }
    };

    let mut code = 0;
    let mut spent = 0.0;
    for step in steps {
        let dir = repo_root.join("evals").join(step.suite);
        if !dir.join("manifest.yaml").exists() {
            continue;
        }
        let suite = Suite::load(&dir, catalog_path, repo_root)?;
        let ids: Vec<String> = suite
            .manifest
            .tasks
            .iter()
            .map(|t| t.id.clone())
            .filter(|id| step.prefixes.is_empty() || step.prefixes.iter().any(|p| id.starts_with(p)))
            .filter(|id| selection.keeps(id))
            .collect();
        if ids.is_empty() {
            println!("\n== {}: không có task cần chạy", step.suite);
            continue;
        }
        let cap = if step.shared_budget { (step.max_cost - spent).max(0.0) } else { step.max_cost };
        println!("\n== {} · {} task · trần ${cap:.2}", step.suite, ids.len());
        let opts = RunOptions {
            only: ids,
            pinned: step.pinned.map(String::from),
            retry_failed: step.retry_failed,
            rotate: step.rotate,
            max_cost: Some(cap),
            history: step.history,
            profile: o.profile.clone(),
            source: source.clone(),
            ..Default::default()
        };
        let summary = run_with(&suite, &opts, &CancelFlag::default(), &mut print_progress).await?;
        spent += summary.total_cost_usd;
        code = worse(code, finish_run(&summary, repo_root, step.history)?);
        // Hết credit / sai khoá: các bước sau cũng sẽ lỗi.
        if summary.stopped.as_deref().is_some_and(|s| s.contains("PROVIDER_CREDITS") || s.contains("PROVIDER_AUTH") || s.contains("CLI_AUTH")) {
            println!("dừng profile: {}", summary.stopped.as_deref().unwrap_or_default());
            break;
        }
    }
    println!("\nprofile {}: tổng ${spent:.4}", o.profile);
    Ok(code)
}

fn describe(sel: &Selection) -> String {
    match sel {
        Selection::All => "chạy mọi task".into(),
        Selection::Prefixes(p) if p.is_empty() => "không task nào bị ảnh hưởng".into(),
        Selection::Prefixes(p) => format!("task bắt đầu bằng {}", p.join(", ")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_codes_keep_the_worst() {
        assert_eq!(worse(0, 2), 2);
        assert_eq!(worse(2, 1), 1);
        assert_eq!(worse(1, 2), 1);
        assert_eq!(worse(1, 0), 1);
        assert_eq!(worse(0, 0), 0);
    }

    #[test]
    fn source_of_a_profile_run() {
        let mut s = EvalSettings::default();
        s.source = "claude-cli".into();
        s.ci.source = "company-gateway".into();
        assert_eq!(profile_source(&s, None, false).as_deref(), Some("claude-cli"));
        assert_eq!(profile_source(&s, None, true).as_deref(), Some("company-gateway"));
        assert_eq!(profile_source(&s, Some("claude-api"), true).as_deref(), Some("claude-api"));
        assert_eq!(profile_source(&s, Some("per-task"), false), None);
    }

    #[tokio::test]
    async fn ci_profile_does_nothing_while_ci_is_off() {
        // Shipped config: CI off. No model call, exit 0, `skip=true` for the workflow.
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let o = ProfileOptions { profile: "nightly".into(), ci: true, check: true, ..Default::default() };
        assert_eq!(run_profile(&repo, &repo.join("config/models.yaml"), &o).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn missing_key_stops_before_any_task() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let o = ProfileOptions {
            profile: "smoke".into(),
            source: Some("company-gateway".into()),
            ..Default::default()
        };
        // Only meaningful where the OpenRouter key is not set (as on this project's dev PCs).
        if std::env::var("SILENCE_API_KEY").map(|v| v.is_empty()).unwrap_or(true) {
            assert_eq!(run_profile(&repo, &repo.join("config/models.yaml"), &o).await.unwrap(), EXIT_SOURCE_NOT_READY);
        }
    }
}
