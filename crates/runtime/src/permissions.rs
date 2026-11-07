//! Workspace permission allowlist persistence (`.silence/permissions.json`).
//!
//! Engine is the only writer. Renderer "remember" is a request, never a gate.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
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
        if is_rememberable(&t) && !out.contains(&t) {
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
