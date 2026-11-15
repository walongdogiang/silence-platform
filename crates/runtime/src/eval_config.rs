//! Cấu hình eval: `evals/config.yaml`. Một nơi để đổi nguồn model và trần chi, dùng chung cho mọi
//! cách chạy:
//! - `source`: nguồn mặc định khi chạy **trên máy** (`npm run evals`, `evals:smoke|nightly|weekly`,
//!   calibrate, Studio). Đổi nguồn (Claude CLI hôm nay, OpenRouter hay Claude API sau này) là sửa
//!   một dòng này (hoặc Studio → Evals → Cấu hình).
//! - `profiles`: trần chi của các profile. Các bước của profile ([`steps`]) giống hệt nhau trên máy
//!   và trên CI, chỉ khác nguồn.
//! - `ci`: lượt tự chạy trên GitHub Actions. Tắt mặc định; bật khi đã có khoá của nguồn CI. Nguồn CI
//!   không được là Claude CLI (cần đăng nhập trên máy, runner của GitHub không có).
//!
//! Khoá API không bao giờ nằm trong file này.

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use silence_router::Catalog;
use std::path::{Path, PathBuf};

/// Trần chi mỗi profile/bước tối đa (USD). Chặn gõ nhầm `30` thay vì `0.3`.
pub const MAX_CAP_USD: f64 = 20.0;
/// Giá trị `source` nghĩa là "mỗi task chạy đúng model đã ghim, không đổi nguồn".
pub const PER_TASK: &str = "per-task";
pub const PROFILES: [&str; 3] = ["smoke", "nightly", "weekly"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EvalSettings {
    /// Provider id cho lượt chạy trên máy, hoặc `per-task`.
    #[serde(default = "default_source")]
    pub source: String,
    #[serde(default)]
    pub profiles: Profiles,
    #[serde(default)]
    pub ci: Ci,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Profiles {
    #[serde(default = "Cap::smoke")]
    pub smoke: Cap,
    #[serde(default = "Cap::nightly")]
    pub nightly: Cap,
    #[serde(default)]
    pub weekly: WeeklyCaps,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Cap {
    pub max_cost: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WeeklyCaps {
    /// Bộ v0, đủ task.
    pub v0_max_cost: f64,
    /// Các task mode `M..`.
    pub modes_max_cost: f64,
    /// Task Model Auto `A..` (trần riêng: A01 chạy Opus).
    pub auto_max_cost: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Ci {
    /// Lượt theo lịch trên GitHub có chạy không. Tắt thì job xanh, không gọi model.
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_ci_source")]
    pub source: String,
    #[serde(default = "yes")]
    pub nightly: bool,
    #[serde(default = "yes")]
    pub weekly: bool,
}

fn default_source() -> String {
    PER_TASK.into()
}
fn default_ci_source() -> String {
    "claude-api".into()
}
fn yes() -> bool {
    true
}

impl Cap {
    fn smoke() -> Self {
        Self { max_cost: 0.5 }
    }
    fn nightly() -> Self {
        Self { max_cost: 0.3 }
    }
}

impl Default for Profiles {
    fn default() -> Self {
        Self { smoke: Cap::smoke(), nightly: Cap::nightly(), weekly: WeeklyCaps::default() }
    }
}

impl Default for WeeklyCaps {
    fn default() -> Self {
        Self { v0_max_cost: 1.2, modes_max_cost: 0.3, auto_max_cost: 0.5 }
    }
}

impl Default for Ci {
    fn default() -> Self {
        Self { enabled: false, source: default_ci_source(), nightly: true, weekly: true }
    }
}

impl Default for EvalSettings {
    fn default() -> Self {
        Self { source: default_source(), profiles: Profiles::default(), ci: Ci::default() }
    }
}

pub fn path(repo_root: &Path) -> PathBuf {
    repo_root.join("evals").join("config.yaml")
}

/// Đọc `evals/config.yaml`; chưa có file thì mặc định (mỗi task theo model ghim, CI tắt).
pub fn load(repo_root: &Path) -> Result<EvalSettings> {
    let p = path(repo_root);
    match std::fs::read_to_string(&p) {
        Ok(text) => serde_yaml::from_str(&text).with_context(|| format!("{} không đọc được", p.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(EvalSettings::default()),
        Err(e) => Err(e).with_context(|| format!("đọc {}", p.display())),
    }
}

/// Nguồn thật của một lượt: `cli` (`--source` / ô Nguồn của Studio) thắng, rồi `fallback` (nguồn
/// trong file). `per-task` hoặc rỗng = `None` (mỗi task chạy model ghim của nó).
pub fn resolve_source(cli: Option<&str>, fallback: &str) -> Option<String> {
    let s = cli.map(str::trim).filter(|s| !s.is_empty()).unwrap_or(fallback.trim());
    (!s.is_empty() && s != PER_TASK).then(|| s.to_string())
}

impl EvalSettings {
    pub fn validate(&self, catalog: &Catalog) -> Result<()> {
        if self.source != PER_TASK {
            catalog
                .provider(&self.source)
                .map_err(|_| anyhow!("nguồn `{}` không có trong config/models.yaml", self.source))?;
        }
        let ci = catalog
            .provider(&self.ci.source)
            .map_err(|_| anyhow!("nguồn CI `{}` không có trong config/models.yaml", self.ci.source))?;
        if ci.is_cli() {
            bail!("nguồn CI `{}` cần đăng nhập trên máy nên không chạy được trên GitHub; chọn Claude API hoặc OpenRouter", self.ci.source);
        }
        let p = &self.profiles;
        for (name, v) in [
            ("profiles.smoke.max_cost", p.smoke.max_cost),
            ("profiles.nightly.max_cost", p.nightly.max_cost),
            ("profiles.weekly.v0_max_cost", p.weekly.v0_max_cost),
            ("profiles.weekly.modes_max_cost", p.weekly.modes_max_cost),
            ("profiles.weekly.auto_max_cost", p.weekly.auto_max_cost),
        ] {
            if !v.is_finite() || !(0.0..=MAX_CAP_USD).contains(&v) {
                bail!("{name} phải từ 0 tới {MAX_CAP_USD} USD");
            }
        }
        Ok(())
    }

    /// Kiểm tra rồi ghi file (Studio). Không hợp lệ thì không ghi gì.
    pub fn save(&self, repo_root: &Path, catalog: &Catalog) -> Result<PathBuf> {
        self.validate(catalog)?;
        let p = path(repo_root);
        let body = serde_yaml::to_string(self)?;
        std::fs::write(&p, format!("{HEADER}{body}")).with_context(|| format!("ghi {}", p.display()))?;
        Ok(p)
    }

    /// Lượt CI `profile` có chạy không (`ci.enabled` và cờ của profile).
    pub fn ci_runs(&self, profile: &str) -> bool {
        self.ci.enabled
            && match profile {
                "nightly" => self.ci.nightly,
                "weekly" => self.ci.weekly,
                _ => false,
            }
    }
}

/// Một bước của profile: một bộ eval với bộ lọc task và trần chi riêng.
#[derive(Debug, Clone, PartialEq)]
pub struct Step {
    pub suite: &'static str,
    /// Tiền tố id task (`M`, `A`); rỗng = cả bộ.
    pub prefixes: &'static [&'static str],
    /// Chỉ task ghim model này (lượt Đêm: Haiku).
    pub pinned: Option<&'static str>,
    pub retry_failed: bool,
    pub rotate: bool,
    pub history: bool,
    pub max_cost: f64,
    /// Các bước của profile dùng chung một ngân sách (`smoke`) thay vì trần riêng.
    pub shared_budget: bool,
}

impl Step {
    fn new(suite: &'static str, max_cost: f64) -> Self {
        Self { suite, prefixes: &[], pinned: None, retry_failed: false, rotate: false, history: false, max_cost, shared_budget: false }
    }
}

/// Các bước của `profile`. Định nghĩa ở một chỗ cho cả máy và CI (`evals.yml` gọi `evals-profile`).
/// - `smoke`: mọi bộ, chỉ task mà thay đổi của nhánh (commit + chưa commit) có thể ảnh hưởng
///   (`affects.yaml`); một ngân sách chung. Dùng khi đang sửa code.
/// - `nightly`: task ghim Haiku của v0, chạy lại task trượt một lần, xoay vòng phần đuôi.
/// - `weekly`: đủ v0, task mode, task Model Auto; ghi lịch sử.
pub fn steps(profile: &str, p: &Profiles) -> Result<Vec<Step>> {
    Ok(match profile {
        "smoke" => ["v0", "modes", "web"]
            .into_iter()
            .map(|s| Step { shared_budget: true, ..Step::new(s, p.smoke.max_cost) })
            .collect(),
        "nightly" => vec![Step {
            pinned: Some("claude-haiku"),
            retry_failed: true,
            rotate: true,
            ..Step::new("v0", p.nightly.max_cost)
        }],
        "weekly" => vec![
            Step { history: true, ..Step::new("v0", p.weekly.v0_max_cost) },
            Step { prefixes: &["M"], history: true, ..Step::new("modes", p.weekly.modes_max_cost) },
            Step { prefixes: &["A"], retry_failed: true, history: true, ..Step::new("modes", p.weekly.auto_max_cost) },
        ],
        other => bail!("profile không biết: {other} (smoke | nightly | weekly)"),
    })
}

const HEADER: &str = "# Cấu hình eval. Sửa ở Studio → Evals → Cấu hình, hoặc sửa tay (evals/README.md → Cấu hình).\n\
# source: nguồn khi chạy trên máy (npm run evals, evals:smoke|nightly|weekly, Studio, calibrate):\n\
#   claude-cli | claude-api | company-gateway (OpenRouter) | per-task (mỗi task theo model ghim).\n\
# ci: lượt tự chạy trên GitHub Actions; bật khi đã đặt secret khoá của ci.source. Không ghi khoá ở đây.\n";

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn catalog() -> Catalog {
        let raw = serde_json::from_value(json!({
            "version": 1,
            "providers": [
                {"id": "company-gateway", "kind": "openai_compat", "base_url": "https://x", "api_key_env": "SILENCE_API_KEY"},
                {"id": "claude-api", "kind": "claude_api", "base_url": "https://y", "api_key_env": "ANTHROPIC_API_KEY"},
                {"id": "claude-cli", "kind": "claude_cli", "command": "claude"}
            ],
            "models": []
        }))
        .unwrap();
        Catalog::from_raw(raw)
    }

    #[test]
    fn defaults_are_per_task_and_ci_off() {
        let s = EvalSettings::default();
        s.validate(&catalog()).unwrap();
        assert_eq!(s.source, PER_TASK);
        assert!(!s.ci.enabled && !s.ci_runs("nightly") && !s.ci_runs("weekly"));
    }

    #[test]
    fn local_source_may_be_the_cli_but_ci_may_not() {
        let mut s = EvalSettings::default();
        s.source = "claude-cli".into();
        s.validate(&catalog()).unwrap();
        s.ci.source = "claude-cli".into();
        assert!(s.validate(&catalog()).unwrap_err().to_string().contains("không chạy được trên GitHub"));
        s.ci.source = "claude-api".into();
        s.source = "nope".into();
        assert!(s.validate(&catalog()).is_err());
    }

    #[test]
    fn caps_must_be_sane() {
        for bad in [-1.0, f64::NAN, 300.0] {
            let mut s = EvalSettings::default();
            s.profiles.weekly.auto_max_cost = bad;
            assert!(s.validate(&catalog()).is_err(), "{bad}");
        }
    }

    #[test]
    fn source_resolution() {
        assert_eq!(resolve_source(None, "claude-cli").as_deref(), Some("claude-cli"));
        assert_eq!(resolve_source(Some("claude-api"), "claude-cli").as_deref(), Some("claude-api"));
        assert_eq!(resolve_source(Some("per-task"), "claude-cli"), None);
        assert_eq!(resolve_source(None, "per-task"), None);
        assert_eq!(resolve_source(Some(" "), "claude-cli").as_deref(), Some("claude-cli"));
    }

    #[test]
    fn ci_runs_needs_both_flags() {
        let mut s = EvalSettings::default();
        s.ci.enabled = true;
        assert!(s.ci_runs("nightly") && s.ci_runs("weekly") && !s.ci_runs("smoke"));
        s.ci.weekly = false;
        assert!(!s.ci_runs("weekly"));
    }

    #[test]
    fn profile_steps() {
        let p = Profiles::default();
        let smoke = steps("smoke", &p).unwrap();
        assert_eq!(smoke.iter().map(|s| s.suite).collect::<Vec<_>>(), ["v0", "modes", "web"]);
        assert!(smoke.iter().all(|s| s.shared_budget && !s.history));
        let nightly = steps("nightly", &p).unwrap();
        assert_eq!(nightly[0].pinned, Some("claude-haiku"));
        assert!(nightly[0].retry_failed && nightly[0].rotate && nightly[0].max_cost == 0.3);
        let weekly = steps("weekly", &p).unwrap();
        assert_eq!(weekly.iter().map(|s| (s.suite, s.prefixes)).collect::<Vec<_>>(), [("v0", &[][..]), ("modes", &["M"][..]), ("modes", &["A"][..])]);
        assert!(weekly.iter().all(|s| s.history));
        assert!(steps("monthly", &p).is_err());
    }

    #[test]
    fn save_then_load_round_trips_and_writes_nothing_when_invalid() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("evals")).unwrap();
        assert_eq!(load(dir.path()).unwrap(), EvalSettings::default());
        let mut s = EvalSettings::default();
        s.source = "claude-cli".into();
        s.profiles.smoke.max_cost = 0.2;
        s.save(dir.path(), &catalog()).unwrap();
        assert_eq!(load(dir.path()).unwrap(), s);
        assert!(std::fs::read_to_string(path(dir.path())).unwrap().starts_with("# Cấu hình eval"));
        let before = std::fs::read_to_string(path(dir.path())).unwrap();
        s.ci.source = "claude-cli".into();
        assert!(s.save(dir.path(), &catalog()).is_err());
        assert_eq!(std::fs::read_to_string(path(dir.path())).unwrap(), before);
    }

    #[test]
    fn partial_file_keeps_defaults() {
        let s: EvalSettings = serde_yaml::from_str("source: claude-cli\n").unwrap();
        assert_eq!(s.profiles, Profiles::default());
        assert_eq!(s.ci, Ci::default());
    }

    #[test]
    fn shipped_config_is_valid() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let cat = Catalog::load(repo.join("config/models.yaml")).unwrap();
        let s = load(&repo).unwrap();
        s.validate(&cat).unwrap();
        assert!(!s.ci.enabled, "CI stays off until a key is set");
    }
}
