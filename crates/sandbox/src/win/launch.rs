//! Engine side: run one command as the sandbox user through the runner.
//!
//! A normal user cannot give another user's token to CreateProcessAsUserW (error 1314, Phase 0
//! spike), so the Engine starts the runner with CreateProcessWithLogonW (seclogon service) and
//! the runner restricts its own token. Measured overhead: ~120 ms per command.

use super::account;
use super::job::Job;
use super::proc::{pipe, read_thread, wait, Handle};
use super::sid::wide;
use super::state::{self, State};
use crate::spec::{Limits, RunOutput, RunSpec, RUNNER_FAILED, RUNNER_PREFIX};
use anyhow::{anyhow, bail, Context, Result};
use std::io::Write;
use std::os::windows::io::FromRawHandle;
use std::path::{Path, PathBuf};
use std::time::Duration;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::Threading::{
    CreateProcessWithLogonW, ResumeThread, TerminateProcess, CREATE_NO_WINDOW, CREATE_SUSPENDED,
    LOGON_WITH_PROFILE, PROCESS_INFORMATION, STARTF_USESTDHANDLES, STARTUPINFOW,
};

/// Subcommand of `silence-engine` that runs `runner_main`.
pub const RUNNER_ARG: &str = "sandbox-runner";

pub fn run(spec: &RunSpec, engine_exe: &Path, timeout: Option<Duration>) -> Result<RunOutput> {
    let st = State::load()?.ok_or_else(|| anyhow!("sandbox is not installed (run: silence-engine sandbox setup)"))?;
    let password = String::from_utf8(account::unprotect(&std::fs::read(state::cred_path()).context("read cred.bin")?)?)
        .context("password is not UTF-8")?;
    let runner = stage_runner(engine_exe)?;
    if let Err(e) = super::setup::ensure_tool_config() {
        tracing::warn!("sandbox: tool config: {e:#}");
    }

    let (in_r, in_w) = pipe(true, false)?;
    let (out_r, out_w) = pipe(false, true)?;
    let (err_r, err_w) = pipe(false, true)?;
    let si = STARTUPINFOW {
        cb: std::mem::size_of::<STARTUPINFOW>() as u32,
        dwFlags: STARTF_USESTDHANDLES,
        hStdInput: in_r.0,
        hStdOutput: out_w.0,
        hStdError: err_w.0,
        ..Default::default()
    };
    let mut pi = PROCESS_INFORMATION::default();
    let (u, d, p) = (wide(&st.user), wide("."), wide(&password));
    let app = wide(&runner.to_string_lossy());
    let mut cl = wide(&format!("\"{}\" {RUNNER_ARG}", runner.display()));
    let cwd = wide(&state::bin_dir().to_string_lossy());
    unsafe {
        CreateProcessWithLogonW(
            PCWSTR(u.as_ptr()),
            PCWSTR(d.as_ptr()),
            PCWSTR(p.as_ptr()),
            LOGON_WITH_PROFILE,
            PCWSTR(app.as_ptr()),
            PWSTR(cl.as_mut_ptr()),
            CREATE_NO_WINDOW | CREATE_SUSPENDED,
            None,
            PCWSTR(cwd.as_ptr()),
            &si,
            &mut pi,
        )
        .context("CreateProcessWithLogonW (is the Secondary Logon service disabled?)")?;
    }
    drop(password);
    let process = Handle(pi.hProcess);
    let thread = Handle(pi.hThread);
    drop((in_r, out_w, err_w));

    // Our job holds the runner; the runner's own job holds the command (nested). Terminating
    // ours kills both. If the runner cannot join (access), fall back to TerminateProcess: the
    // runner's job is kill-on-close, so the command dies with it.
    let job = Job::new(&Limits::default())?;
    let in_job = match job.assign(process.0) {
        Ok(()) => true,
        Err(e) => {
            tracing::warn!("sandbox: runner not in job ({e:#}); timeout uses TerminateProcess");
            false
        }
    };
    unsafe {
        ResumeThread(thread.0);
    }

    // Spec on stdin, then EOF.
    {
        let mut w = unsafe { std::fs::File::from_raw_handle(in_w.0 .0 as _) };
        std::mem::forget(in_w); // the File owns the handle now
        w.write_all(&serde_json::to_vec(spec)?).context("send spec to runner")?;
    }
    let (t_out, t_err) = (read_thread(out_r), read_thread(err_r));
    let code = wait(process.0, timeout)?;
    let timed_out = code.is_none();
    if timed_out {
        if in_job {
            job.terminate(1);
        } else {
            unsafe {
                let _ = TerminateProcess(process.0, 1);
            }
        }
    }
    drop(job);
    let out = RunOutput {
        code: code.map(|c| c as i32).unwrap_or(-1),
        stdout: t_out.join().unwrap_or_default(),
        stderr: t_err.join().unwrap_or_default(),
        timed_out,
    };
    if out.code == RUNNER_FAILED && out.stderr.starts_with(RUNNER_PREFIX.as_bytes()) {
        bail!("{}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(out)
}

/// The sandbox user cannot read the real user's profile, where the Engine exe often lives. Copy
/// it once per build into `%ProgramData%\silence-sbx\bin` (readable by the sandbox user).
pub fn stage_runner(engine_exe: &Path) -> Result<PathBuf> {
    let meta = std::fs::metadata(engine_exe).with_context(|| format!("stat {}", engine_exe.display()))?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let dir = state::bin_dir();
    let dest = dir.join(format!("silence-engine-{}-{mtime}.exe", meta.len()));
    if !dest.exists() {
        let tmp = dest.with_extension("partial");
        std::fs::copy(engine_exe, &tmp).with_context(|| format!("copy runner to {}", dir.display()))?;
        std::fs::rename(&tmp, &dest)?;
        // Old copies: best effort (one may still be running).
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let p = e.path();
                if p != dest && p.extension().is_some_and(|x| x == "exe") {
                    let _ = std::fs::remove_file(p);
                }
            }
        }
    }
    Ok(dest)
}

#[allow(dead_code)]
fn _h(_: HANDLE) {}
