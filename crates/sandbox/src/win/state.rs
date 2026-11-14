//! Where the sandbox keeps things.
//!
//! - Machine side (`%ProgramData%\silence-sbx`, made by setup): `bin\` (runner copy the sandbox
//!   user can execute), `home\` (its USERPROFILE/APPDATA), `tmp\<ws-hash>\`.
//! - User side (`%LOCALAPPDATA%\silence\sandbox`, only the real user can read): `state.json`,
//!   `cred.bin` (DPAPI-encrypted password of the sandbox user), `setup.log`.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const USER: &str = "silence-sbx";
pub const STATE_VERSION: u32 = 1;

pub fn machine_root() -> PathBuf {
    let base = std::env::var_os("ProgramData").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
    base.join("silence-sbx")
}

pub fn bin_dir() -> PathBuf {
    machine_root().join("bin")
}
pub fn home_dir() -> PathBuf {
    machine_root().join("home")
}
pub fn tmp_root() -> PathBuf {
    machine_root().join("tmp")
}

pub fn user_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    base.join("silence").join("sandbox")
}
pub fn state_path() -> PathBuf {
    user_dir().join("state.json")
}
pub fn cred_path() -> PathBuf {
    user_dir().join("cred.bin")
}
pub fn setup_log() -> PathBuf {
    user_dir().join("setup.log")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct State {
    pub version: u32,
    pub user: String,
    pub user_sid: String,
    /// Workspaces that got sandbox ACEs (uninstall revokes them).
    #[serde(default)]
    pub granted: Vec<PathBuf>,
}

impl State {
    pub fn load() -> Result<Option<Self>> {
        let p = state_path();
        if !p.exists() {
            return Ok(None);
        }
        let s = std::fs::read_to_string(&p).with_context(|| format!("read {}", p.display()))?;
        Ok(Some(serde_json::from_str(&s).context("parse sandbox state.json")?))
    }

    pub fn save(&self) -> Result<()> {
        std::fs::create_dir_all(user_dir())?;
        let tmp = state_path().with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(self)?)?;
        std::fs::rename(&tmp, state_path())?;
        Ok(())
    }

    pub fn add_granted(&mut self, ws: &Path) {
        if !self.granted.iter().any(|g| g == ws) {
            self.granted.push(ws.to_path_buf());
        }
    }
}

/// Per-workspace temp dir name: stable, short, no path characters.
pub fn tmp_for(ws: &Path) -> PathBuf {
    let s = ws.to_string_lossy().to_lowercase();
    // FNV-1a 64: stable across runs (std's hasher is randomized).
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    tmp_root().join(format!("{h:016x}"))
}
