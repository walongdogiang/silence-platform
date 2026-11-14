//! Process isolation for agent commands.
//!
//! - `wrap_pid`: Job Object (kill-on-close) for ordinary, unsandboxed children.
//! - Sandbox (Windows): commands run as a hidden local user with a write-restricted token, so
//!   they can only write in granted workspaces and the sandbox's own temp/home. Design and
//!   measurements: `crates/sandbox/spike/README.md`; plan phases in docs/security/backlog.md.
//!   Network: a firewall rule blocks the sandbox user's non-loopback traffic; allowed hosts go
//!   through the loopback proxy in [`proxy`] (per-session credential, allowlist, audit events).

use anyhow::{Context, Result};
use std::path::Path;
use std::time::Duration;

pub mod env;
pub mod owner_only;
pub mod proxy;
pub mod spec;
#[cfg(windows)]
mod win;

pub use spec::{Limits, RunOutput, RunSpec, SandboxStatus, RUNNER_FAILED, RUNNER_PREFIX};

/// Arguments `silence-engine` must accept to run the elevated half of setup / uninstall.
pub const ELEVATED_SETUP_ARGS: &str = "sandbox setup --elevated";
pub const ELEVATED_UNINSTALL_ARGS: &str = "sandbox uninstall --elevated";
/// Subcommand of `silence-engine` that runs [`runner_main`] (as the sandbox user).
pub const RUNNER_ARG: &str = "sandbox-runner";

pub fn status() -> SandboxStatus {
    #[cfg(windows)]
    {
        win::setup::status()
    }
    #[cfg(not(windows))]
    {
        SandboxStatus::Unsupported
    }
}

pub fn is_elevated() -> bool {
    #[cfg(windows)]
    {
        win::setup::is_elevated()
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Install (or repair) the sandbox. Shows one UAC prompt unless already elevated; the elevated
/// half is `engine_exe ELEVATED_SETUP_ARGS` → [`setup_elevated`].
pub fn setup(engine_exe: &Path) -> Result<()> {
    elevate_or_run(engine_exe, ELEVATED_SETUP_ARGS, setup_elevated, "setup")
}

pub fn uninstall(engine_exe: &Path) -> Result<()> {
    elevate_or_run(engine_exe, ELEVATED_UNINSTALL_ARGS, uninstall_elevated, "uninstall")
}

#[allow(unused_variables)]
fn elevate_or_run(engine_exe: &Path, args: &str, direct: fn() -> Result<()>, what: &str) -> Result<()> {
    #[cfg(windows)]
    {
        if is_elevated() {
            return direct();
        }
        let code = win::setup::run_elevated(engine_exe, args)?;
        if code != 0 {
            let log = std::fs::read_to_string(win::state::setup_log()).unwrap_or_default();
            let last = log.lines().last().unwrap_or("").to_string();
            anyhow::bail!("sandbox {what} failed (exit {code}): {last}");
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        anyhow::bail!("sandbox {what}: not supported on this OS yet")
    }
}

pub fn setup_elevated() -> Result<()> {
    #[cfg(windows)]
    {
        win::setup::setup_elevated()
    }
    #[cfg(not(windows))]
    {
        anyhow::bail!("not supported on this OS")
    }
}

pub fn uninstall_elevated() -> Result<()> {
    #[cfg(windows)]
    {
        win::setup::uninstall_elevated()
    }
    #[cfg(not(windows))]
    {
        anyhow::bail!("not supported on this OS")
    }
}

/// Let the sandbox write in `ws`. Returns how long the ACL propagation took.
#[allow(unused_variables)]
pub fn grant_workspace(ws: &Path) -> Result<Duration> {
    #[cfg(windows)]
    {
        win::setup::grant_workspace(ws)
    }
    #[cfg(not(windows))]
    {
        anyhow::bail!("not supported on this OS")
    }
}

/// Let the sandbox read (not write) `path`, e.g. a toolchain in the real user's profile.
#[allow(unused_variables)]
pub fn grant_read(path: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        win::setup::grant_read(path)
    }
    #[cfg(not(windows))]
    {
        anyhow::bail!("not supported on this OS")
    }
}

/// Child environment for `ws`: allowlisted vars from the Engine's env, TEMP/profile redirected.
#[allow(unused_variables)]
pub fn default_env(ws: &Path) -> Vec<(String, String)> {
    #[cfg(windows)]
    {
        win::setup::default_env(ws, std::env::vars_os())
    }
    #[cfg(not(windows))]
    {
        Vec::new()
    }
}

/// Run `spec` as the sandbox user (blocking; call from `spawn_blocking`). `engine_exe` is the
/// `silence-engine` binary, which doubles as the runner.
#[allow(unused_variables)]
pub fn run(spec: &RunSpec, engine_exe: &Path, timeout: Option<Duration>) -> Result<RunOutput> {
    #[cfg(windows)]
    {
        win::launch::run(spec, engine_exe, timeout)
    }
    #[cfg(not(windows))]
    {
        anyhow::bail!("not supported on this OS")
    }
}

/// Run `spec` as the CURRENT user with the write-restricted token (no sandbox user, no setup).
/// Blocks writes outside granted dirs only; reads and network are not limited. Used by tests;
/// never a substitute for `run` in `autonomous` mode.
#[allow(unused_variables)]
pub fn run_local_restricted(spec: &RunSpec, timeout: Option<Duration>) -> Result<RunOutput> {
    #[cfg(windows)]
    {
        let token = win::token::restricted_own_token()?;
        win::proc::run_with_token(token.0, spec, timeout)
    }
    #[cfg(not(windows))]
    {
        anyhow::bail!("not supported on this OS")
    }
}

/// Entry point of `silence-engine sandbox-runner`. Returns the process exit code.
pub fn runner_main() -> i32 {
    #[cfg(windows)]
    {
        win::runner::runner_main()
    }
    #[cfg(not(windows))]
    {
        eprintln!("{RUNNER_PREFIX} not supported on this OS");
        RUNNER_FAILED
    }
}

pub struct JobGuard {
    inner: Inner,
}

enum Inner {
    #[cfg(windows)]
    Windows {
        handle: windows::Win32::Foundation::HANDLE,
    },
    TimeoutOnly,
}

pub fn wrap_pid(pid: u32) -> Result<JobGuard> {
    if pid == 0 {
        return Ok(JobGuard {
            inner: Inner::TimeoutOnly,
        });
    }
    #[cfg(windows)]
    {
        match windows_job(pid) {
            Ok(g) => Ok(g),
            Err(err) => {
                tracing::warn!("job object unavailable: {err}");
                Ok(JobGuard {
                    inner: Inner::TimeoutOnly,
                })
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        Ok(JobGuard {
            inner: Inner::TimeoutOnly,
        })
    }
}

pub fn default_timeout() -> Duration {
    Duration::from_secs(120)
}

#[cfg(windows)]
fn windows_job(pid: u32) -> Result<JobGuard> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows::Win32::System::Threading::{OpenProcess, PROCESS_ALL_ACCESS};

    unsafe {
        let job = CreateJobObjectW(None, None).context("CreateJobObjectW")?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const _,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .context("SetInformationJobObject")?;

        let proc = OpenProcess(PROCESS_ALL_ACCESS, false, pid).context("OpenProcess")?;
        let assigned = AssignProcessToJobObject(job, proc);
        let _ = CloseHandle(proc);
        assigned.context("AssignProcessToJobObject")?;
        Ok(JobGuard {
            inner: Inner::Windows { handle: job },
        })
    }
}

unsafe impl Send for JobGuard {}

impl Drop for JobGuard {
    fn drop(&mut self) {
        match self.inner {
            #[cfg(windows)]
            Inner::Windows { handle } => unsafe {
                let _ = windows::Win32::Foundation::CloseHandle(handle);
            },
            Inner::TimeoutOnly => {}
        }
    }
}
