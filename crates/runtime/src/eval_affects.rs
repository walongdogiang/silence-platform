//! `evals --affected-since <sha>`: run only the tasks a change can affect, per
//! `evals/affects.yaml`. Like Anthropic's advice to run agent evals "on each agent change":
//! a night with no relevant commit costs nothing.
//!
//! Each changed file is decided by the **first** rule whose `paths` glob matches it, so specific
//! rules go before broad ones. A rule's `tasks` are task-id prefixes (`R` = every `R..` task,
//! `M06` = that task) or `*` (all); an empty list means "no eval needed". A file no rule matches
//! needs no eval either (docs, Studio UI…).

use anyhow::{bail, Context, Result};
use regex::Regex;
use serde::Deserialize;
use std::path::Path;

#[derive(Debug, Deserialize)]
pub struct Affects {
    pub rules: Vec<Rule>,
}

#[derive(Debug, Deserialize)]
pub struct Rule {
    pub paths: Vec<String>,
    #[serde(default)]
    pub tasks: Vec<String>,
}

/// What a change needs.
#[derive(Debug, Clone, PartialEq)]
pub enum Selection {
    /// Every task of the suite.
    All,
    /// Tasks whose id starts with one of these prefixes (may select nothing).
    Prefixes(Vec<String>),
}

impl Selection {
    pub fn keeps(&self, id: &str) -> bool {
        match self {
            Selection::All => true,
            Selection::Prefixes(p) => p.iter().any(|p| id.starts_with(p.as_str())),
        }
    }
}

impl Affects {
    pub fn load(path: &Path) -> Result<Self> {
        let text = std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
        Ok(serde_yaml::from_str(&text)?)
    }

    /// Union of the first matching rule of every changed file.
    pub fn select(&self, changed: &[String]) -> Result<Selection> {
        let rules: Vec<(Vec<Regex>, &Vec<String>)> = self
            .rules
            .iter()
            .map(|r| Ok((r.paths.iter().map(|g| glob_regex(g)).collect::<Result<Vec<_>>>()?, &r.tasks)))
            .collect::<Result<_>>()?;
        let mut prefixes: Vec<String> = Vec::new();
        for file in changed {
            let file = file.replace('\\', "/");
            let Some((_, tasks)) = rules.iter().find(|(globs, _)| globs.iter().any(|g| g.is_match(&file))) else {
                continue;
            };
            if tasks.iter().any(|t| t == "*") {
                return Ok(Selection::All);
            }
            for t in tasks.iter() {
                if !prefixes.contains(t) {
                    prefixes.push(t.clone());
                }
            }
        }
        Ok(Selection::Prefixes(prefixes))
    }
}

/// `**` = any depth, `*` = within one path segment, `?` = one character.
fn glob_regex(glob: &str) -> Result<Regex> {
    let mut re = String::from("^");
    let mut chars = glob.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '*' if chars.peek() == Some(&'*') => {
                chars.next();
                if chars.peek() == Some(&'/') {
                    chars.next();
                    re.push_str("(?:.*/)?");
                } else {
                    re.push_str(".*");
                }
            }
            '*' => re.push_str("[^/]*"),
            '?' => re.push_str("[^/]"),
            c => re.push_str(&regex::escape(&c.to_string())),
        }
    }
    re.push('$');
    Ok(Regex::new(&re)?)
}

/// Files changed between `since` and `HEAD` (committed changes only, as CI sees them).
pub fn changed_files(repo_root: &Path, since: &str) -> Result<Vec<String>> {
    let out = std::process::Command::new("git")
        .args(["diff", "--name-only", since, "HEAD"])
        .current_dir(repo_root)
        .output()
        .context("run git diff")?;
    if !out.status.success() {
        bail!("git diff {since} HEAD: {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(String::from)
        .collect())
}

fn git(repo_root: &Path, args: &[&str]) -> Result<String> {
    let out = std::process::Command::new("git").args(args).current_dir(repo_root).output().context("run git")?;
    if !out.status.success() {
        bail!("git {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Thay đổi của nhánh đang làm: so với chỗ rẽ nhánh từ `origin/main` (hoặc `main`), gồm cả phần
/// đã commit, chưa commit và file mới chưa track. Profile `smoke` dùng khi đang sửa code.
pub fn changed_files_local(repo_root: &Path) -> Result<Vec<String>> {
    let base = ["origin/main", "main"]
        .iter()
        .find_map(|b| git(repo_root, &["merge-base", "HEAD", b]).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "HEAD".into());
    let mut files: Vec<String> = Vec::new();
    let tracked = git(repo_root, &["diff", "--name-only", &base])?;
    let untracked = git(repo_root, &["ls-files", "--others", "--exclude-standard"])?;
    for l in tracked.lines().chain(untracked.lines()).map(str::trim).filter(|l| !l.is_empty()) {
        if !files.iter().any(|f| f == l) {
            files.push(l.to_string());
        }
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn affects() -> Affects {
        serde_yaml::from_str(
            r#"
rules:
  - paths: ["crates/runtime/src/eval_history.rs", "docs/**"]
    tasks: []
  - paths: ["crates/runtime/src/risk/**"]
    tasks: ["R"]
  - paths: ["crates/runtime/src/agent/modes.rs"]
    tasks: ["M", "S01-style"]
  - paths: ["crates/**", "Cargo.lock"]
    tasks: ["*"]
"#,
        )
        .unwrap()
    }

    fn files(f: &[&str]) -> Vec<String> {
        f.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn globs() {
        let g = glob_regex("crates/**/*.rs").unwrap();
        assert!(g.is_match("crates/a.rs"));
        assert!(g.is_match("crates/x/y/a.rs"));
        assert!(!g.is_match("crates/x/a.ts"));
        let g = glob_regex("docs/*.md").unwrap();
        assert!(g.is_match("docs/a.md"));
        assert!(!g.is_match("docs/x/a.md"));
        assert!(glob_regex("Cargo.lock").unwrap().is_match("Cargo.lock"));
        assert!(!glob_regex("Cargo.lock").unwrap().is_match("XCargo.lock"));
    }

    #[test]
    fn no_relevant_change_selects_nothing() {
        let s = affects().select(&files(&["docs/a.md", "apps/studio/src/App.tsx", "crates/runtime/src/eval_history.rs"])).unwrap();
        assert_eq!(s, Selection::Prefixes(vec![]));
        assert!(!s.keeps("E01-edit-add-pow"));
    }

    #[test]
    fn first_matching_rule_wins() {
        // modes.rs also matches `crates/**`, but its own rule comes first.
        let s = affects().select(&files(&["crates/runtime/src/agent/modes.rs", "crates/runtime/src/risk/mod.rs"])).unwrap();
        assert!(s.keeps("M06-ask-runtime-env"));
        assert!(s.keeps("S01-style-concise"));
        assert!(s.keeps("R26-security-block-download-exec"));
        assert!(!s.keeps("E01-edit-add-pow"));
    }

    #[test]
    fn broad_change_selects_all() {
        let s = affects().select(&files(&["docs/a.md", "crates/runtime/src/agent/mod.rs"])).unwrap();
        assert_eq!(s, Selection::All);
        // Windows separators are normalised.
        assert_eq!(affects().select(&files(&["crates\\tools\\src\\lib.rs"])).unwrap(), Selection::All);
    }

    #[test]
    fn shipped_affects_yaml_parses() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let a = Affects::load(&repo.join("evals/affects.yaml")).unwrap();
        assert_eq!(a.select(&files(&["docs/README.md"])).unwrap(), Selection::Prefixes(vec![]));
        assert_eq!(a.select(&files(&["crates/runtime/src/agent/mod.rs"])).unwrap(), Selection::All);
    }
}
