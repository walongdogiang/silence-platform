//! Workspace permission allowlist persistence (`.silence/permissions.json`).
//!
//! Wave 0 stubs intentionally do not persist. Plan 01-03 turns load/save green.

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

const REL_PATH: &str = ".silence/permissions.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[allow(dead_code)] // Schema reserved for Plan 01-03 persistence body.
struct PermissionsFile {
    #[serde(default)]
    allow_tools: Vec<String>,
}

/// Load `allow_tools` for a workspace. Missing file → empty list (once implemented).
pub fn load(workspace: &Path) -> Result<Vec<String>> {
    let _ = workspace.join(REL_PATH);
    // Wave 0 stub: refuse real persistence until Plan 01-03.
    Err(anyhow!(
        "permissions::load not implemented — Wave 0 stub (Plan 01-03)"
    ))
}

/// Persist `allow_tools` under workspace `.silence/permissions.json`.
pub fn save(workspace: &Path, allow_tools: &[String]) -> Result<()> {
    let _ = (workspace.join(REL_PATH), allow_tools);
    // Wave 0 stub: no-op failure so round-trip cannot succeed yet.
    Err(anyhow!(
        "permissions::save not implemented — Wave 0 stub (Plan 01-03)"
    ))
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
