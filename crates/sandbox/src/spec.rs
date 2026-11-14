//! Types shared by the Engine side (`run`) and the runner side (`runner_main`).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// One command to run inside the sandbox. Sent to the runner as JSON on its stdin.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunSpec {
    /// Full Windows command line, e.g. `powershell.exe -NoProfile -Command "..."`.
    pub command_line: String,
    pub cwd: PathBuf,
    /// The child's whole environment (nothing is inherited). Build it with `default_env`.
    pub env: Vec<(String, String)>,
    #[serde(default)]
    pub limits: Limits,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Limits {
    /// Job-wide committed memory cap.
    pub memory_mb: Option<u64>,
    /// Max processes alive at once in the job.
    pub max_processes: Option<u32>,
}

impl Limits {
    pub fn standard() -> Self {
        Self { memory_mb: Some(4096), max_processes: Some(64) }
    }
}

#[derive(Debug, Clone)]
pub struct RunOutput {
    pub code: i32,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    pub timed_out: bool,
}

/// Exit code the runner uses when IT failed (bad spec, token, spawn). Its stderr then starts
/// with `RUNNER_PREFIX`. Chosen outside the range shells commonly use.
pub const RUNNER_FAILED: i32 = 0x5BE5;
pub const RUNNER_PREFIX: &str = "silence-sbx-runner:";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", content = "reason", rename_all = "snake_case")]
pub enum SandboxStatus {
    /// Not Windows (macOS/Linux backends come later).
    Unsupported,
    NotInstalled,
    Ready,
    /// Installed but something is missing or broken; never auto-run in this state.
    Degraded(String),
}
