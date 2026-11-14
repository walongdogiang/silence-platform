//! Runner side: runs as the sandbox user (started by `launch::run` via CreateProcessWithLogonW).
//!
//! Reads one `RunSpec` (JSON) from stdin, restricts its OWN token (no special privilege needed
//! for that, unlike starting a process with another user's token), starts the command in a
//! limited job with stdout/stderr going straight to the Engine's pipes, and exits with the
//! command's exit code. Its own failures exit with `RUNNER_FAILED` and a prefixed message.

use super::job::Job;
use super::proc::{dup_inheritable, nul_input, spawn_as, wait};
use super::token::restricted_own_token;
use crate::spec::{RunSpec, RUNNER_FAILED, RUNNER_PREFIX};
use anyhow::{Context, Result};
use std::io::Read;
use windows::Win32::System::Console::{GetStdHandle, STD_ERROR_HANDLE, STD_OUTPUT_HANDLE};

pub fn runner_main() -> i32 {
    // No "Application Error" popups for children that fail to start (error mode is inherited).
    unsafe {
        use windows::Win32::System::Diagnostics::Debug::{SetErrorMode, SEM_FAILCRITICALERRORS, SEM_NOGPFAULTERRORBOX};
        SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
    }
    match run() {
        Ok(code) => code as i32,
        Err(e) => {
            eprintln!("{RUNNER_PREFIX} {e:#}");
            RUNNER_FAILED
        }
    }
}

fn run() -> Result<u32> {
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).context("read spec from stdin")?;
    let spec: RunSpec = serde_json::from_str(&input).context("parse spec")?;
    let token = restricted_own_token()?;
    let job = Job::new(&spec.limits)?;
    let (out, err) = unsafe {
        (
            dup_inheritable(GetStdHandle(STD_OUTPUT_HANDLE).context("stdout")?)?,
            dup_inheritable(GetStdHandle(STD_ERROR_HANDLE).context("stderr")?)?,
        )
    };
    let stdin = nul_input()?;
    let child = spawn_as(token.0, &spec, stdin.0, out.0, err.0, &job)?;
    drop((out, err, stdin));
    // The Engine enforces the timeout by terminating the job this runner is in.
    Ok(wait(child.process.0, None)?.unwrap_or(1))
}
