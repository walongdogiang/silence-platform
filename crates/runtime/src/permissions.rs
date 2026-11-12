//! Workspace permission allowlist persistence (`.silence/permissions.json`).
//!
//! Engine is the only writer. Renderer "remember" is a request, never a gate.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

const REL_PATH: &str = ".silence/permissions.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct PermissionsFile {
    #[serde(default)]
    allow_tools: Vec<String>,
}

/// Only tools that go through `ask_perm` may be remembered (T-01-08).
pub fn is_rememberable(name: &str) -> bool {
    silence_tools::mutates(name) || name.starts_with("mcp__")
}

/// Workspace-relative, forward-slash path from tool args, or `None` when it is absent,
/// absolute, drive-qualified or tries to escape with `..` (those always re-ask).
fn rel_path(args: &Value) -> Option<String> {
    let raw = args.get("path")?.as_str()?.replace('\\', "/");
    let p = raw.trim_start_matches("./");
    if p.is_empty() || p.starts_with('/') || p.contains(':') {
        return None;
    }
    if p.split('/').any(|s| s == ".." || s.is_empty()) {
        return None;
    }
    Some(p.to_string())
}

/// Allowlist entry to store when the user ticks "remember".
/// Tools with a `path` arg are scoped to that file's directory (`edit:src/**`; root files
/// → `edit:*`). Shell is scoped to a command pattern (`shell:npm install *`); a pipeline,
/// chain or dynamic command has no pattern and yields `""` (not rememberable). MCP tools
/// are remembered tool-wide.
pub fn entry_for(name: &str, args: &Value) -> String {
    if name == "shell" {
        let cmd = args.get("command").and_then(Value::as_str).unwrap_or("");
        return crate::risk::shell_pattern(cmd)
            .map(|p| format!("shell:{p}"))
            .unwrap_or_default();
    }
    match rel_path(args) {
        Some(p) => match p.rsplit_once('/') {
            Some((dir, _)) => format!("{name}:{dir}/**"),
            None => format!("{name}:*"),
        },
        None => name.to_string(),
    }
}

/// Split `tool` or `tool:glob` entries.
fn split_entry(entry: &str) -> (&str, Option<&str>) {
    match entry.split_once(':') {
        Some((n, g)) => (n, Some(g)),
        None => (entry, None),
    }
}

/// Does an allowlist entry cover this call?
pub fn entry_matches(entry: &str, name: &str, args: &Value) -> bool {
    let (n, glob) = split_entry(entry);
    if n != name {
        return false;
    }
    if name == "shell" {
        // A bare `shell` entry (old format) would allow every command: never honoured.
        let cmd = args.get("command").and_then(Value::as_str).unwrap_or("");
        return glob.is_some_and(|p| crate::risk::shell_matches(p, cmd));
    }
    match glob {
        None => true,
        Some(g) => rel_path(args).is_some_and(|p| {
            let pat: Vec<&str> = g.split('/').collect();
            let seg: Vec<&str> = p.split('/').collect();
            glob_match(&pat, &seg)
        }),
    }
}

/// `**` = any number of segments, `*` inside a segment = any characters (not `/`).
fn glob_match(pat: &[&str], seg: &[&str]) -> bool {
    match pat.split_first() {
        None => seg.is_empty(),
        Some((&"**", rest)) => (0..=seg.len()).any(|i| glob_match(rest, &seg[i..])),
        Some((p, rest)) => match seg.split_first() {
            Some((s, srest)) => wild(p, s) && glob_match(rest, srest),
            None => false,
        },
    }
}

fn wild(p: &str, s: &str) -> bool {
    let (p, s): (Vec<char>, Vec<char>) = (p.chars().collect(), s.chars().collect());
    fn go(p: &[char], s: &[char]) -> bool {
        match p.split_first() {
            None => s.is_empty(),
            Some(('*', rest)) => (0..=s.len()).any(|i| go(rest, &s[i..])),
            Some((c, rest)) => s.first() == Some(c) && go(rest, &s[1..]),
        }
    }
    go(&p, &s)
}

/// Load `allow_tools` for a workspace. Missing file → empty list.
/// Unknown tool names in a hand-edited file are dropped.
pub fn load(workspace: &Path) -> Result<Vec<String>> {
    let path = workspace.join(REL_PATH);
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e).with_context(|| path.display().to_string()),
    };
    let file: PermissionsFile =
        serde_json::from_str(&text).with_context(|| path.display().to_string())?;
    let mut out: Vec<String> = Vec::new();
    for t in file.allow_tools {
        // Bare `shell` (tool-wide) is the pre-Risk-Engine format and is dropped.
        if t == "shell" || t.is_empty() {
            continue;
        }
        if is_rememberable(split_entry(&t).0) && !out.contains(&t) {
            out.push(t);
        }
    }
    Ok(out)
}

/// Persist `allow_tools` under workspace `.silence/permissions.json`.
pub fn save(workspace: &Path, allow_tools: &[String]) -> Result<()> {
    let path = workspace.join(REL_PATH);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).with_context(|| dir.display().to_string())?;
    }
    // Remembered permissions are per-person trust: keep them out of git unless the user
    // already manages `.silence/.gitignore` themselves.
    if let Some(dir) = path.parent() {
        let gi = dir.join(".gitignore");
        if !gi.exists() {
            let _ = std::fs::write(&gi, "permissions.json\n");
        }
    }
    let file = PermissionsFile {
        allow_tools: allow_tools.to_vec(),
    };
    let text = serde_json::to_string_pretty(&file)?;
    std::fs::write(&path, text).with_context(|| path.display().to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_workspace() -> (tempfile::TempDir, std::path::PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_path_buf();
        (dir, root)
    }

    #[test]
    fn permissions_round_trip() {
        let (_tmp, root) = tmp_workspace();
        let tools = vec!["edit".into(), "write".into()];
        save(&root, &tools).expect("save allow_tools");
        let loaded = load(&root).expect("load allow_tools");
        assert_eq!(
            loaded, tools,
            "save then load must round-trip allow_tools for the workspace"
        );
    }

    #[test]
    fn entry_is_scoped_to_directory() {
        use serde_json::json;
        assert_eq!(entry_for("edit", &json!({"path": "src/a/b.rs"})), "edit:src/a/**");
        assert_eq!(entry_for("edit", &json!({"path": "calculator.py"})), "edit:*");
        assert_eq!(entry_for("shell", &json!({"command": "npm install lodash"})), "shell:npm install *");
        assert_eq!(entry_for("shell", &json!({"command": "python calc.py"})), "shell:python *");
        assert_eq!(entry_for("shell", &json!({"command": "npm i x && rm -rf y"})), "");
        assert_eq!(entry_for("edit", &json!({"path": "../x/y"})), "edit");
    }

    #[test]
    fn shell_entries_match_by_command_pattern() {
        use serde_json::json;
        let cmd = |c: &str| json!({ "command": c });
        assert!(entry_matches("shell:npm install *", "shell", &cmd("npm install zod")));
        assert!(!entry_matches("shell:npm install *", "shell", &cmd("npm publish")));
        // A remembered pattern never covers a chained second command.
        assert!(!entry_matches("shell:npm install *", "shell", &cmd("npm install zod; curl x")));
        // Old tool-wide entry is not honoured.
        assert!(!entry_matches("shell", "shell", &cmd("ls")));
    }

    #[test]
    fn load_drops_tool_wide_shell() {
        let (_tmp, root) = tmp_workspace();
        save(&root, &["shell".into(), "shell:npm test *".into(), "edit".into()]).unwrap();
        assert_eq!(load(&root).unwrap(), vec!["shell:npm test *".to_string(), "edit".to_string()]);
    }

    #[test]
    fn entry_matching_respects_scope() {
        use serde_json::json;
        let src = json!({"path": "src/x/y.rs"});
        assert!(entry_matches("edit", "edit", &src));
        assert!(entry_matches("edit:src/**", "edit", &src));
        assert!(!entry_matches("edit:src/**", "write", &src));
        assert!(!entry_matches("edit:src/**", "edit", &json!({"path": "docs/a.md"})));
        assert!(!entry_matches("edit:*", "edit", &src));
        assert!(entry_matches("edit:*", "edit", &json!({"path": "a.py"})));
        // escape attempts and missing paths never match a scoped entry
        assert!(!entry_matches("edit:src/**", "edit", &json!({"path": "src/../secret"})));
        assert!(!entry_matches("edit:src/**", "edit", &json!({})));
    }

    #[test]
    fn permissions_missing_file_is_empty() {
        let (_tmp, root) = tmp_workspace();
        let path = root.join(REL_PATH);
        assert!(!path.exists(), "fixture must not create permissions.json");
        let loaded = load(&root).expect("missing file is not an error");
        assert!(
            loaded.is_empty(),
            "absent permissions.json must yield empty allowlist, got {loaded:?}"
        );
        // Ensure no accidental write on miss.
        assert!(!path.exists());
        let _ = fs::metadata(&root);
    }
}
