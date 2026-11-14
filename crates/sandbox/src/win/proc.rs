//! Spawning a process with a given token, pipes, env block, and reading its output.

use super::job::Job;
use super::sid::wide;
use crate::spec::{RunOutput, RunSpec};
use anyhow::{Context, Result};
use std::ffi::c_void;
use std::time::Duration;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{
    CloseHandle, DuplicateHandle, SetHandleInformation, DUPLICATE_SAME_ACCESS, HANDLE, HANDLE_FLAGS,
    HANDLE_FLAG_INHERIT, TRUE, WAIT_OBJECT_0,
};
use windows::Win32::Security::SECURITY_ATTRIBUTES;
use windows::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, FILE_ATTRIBUTE_NORMAL, FILE_GENERIC_READ, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};
use windows::Win32::System::Pipes::CreatePipe;
use windows::Win32::System::Threading::{
    CreateProcessAsUserW, GetCurrentProcess, GetExitCodeProcess, ResumeThread, WaitForSingleObject,
    CREATE_NO_WINDOW, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, INFINITE, PROCESS_INFORMATION,
    STARTF_USESTDHANDLES, STARTUPINFOW,
};

/// Owned handle.
pub struct Handle(pub HANDLE);
unsafe impl Send for Handle {}
impl Drop for Handle {
    fn drop(&mut self) {
        if !self.0.is_invalid() && !self.0 .0.is_null() {
            unsafe {
                let _ = CloseHandle(self.0);
            }
        }
    }
}

/// Anonymous pipe; `inherit_read` / `inherit_write` mark which end a child may inherit.
pub fn pipe(inherit_read: bool, inherit_write: bool) -> Result<(Handle, Handle)> {
    let sa = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: std::ptr::null_mut(),
        bInheritHandle: TRUE,
    };
    let (mut r, mut w) = (HANDLE::default(), HANDLE::default());
    unsafe {
        CreatePipe(&mut r, &mut w, Some(&sa), 0).context("CreatePipe")?;
        if !inherit_read {
            SetHandleInformation(r, HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0))?;
        }
        if !inherit_write {
            SetHandleInformation(w, HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0))?;
        }
    }
    Ok((Handle(r), Handle(w)))
}

/// Inheritable copy of `h`.
pub fn dup_inheritable(h: HANDLE) -> Result<Handle> {
    let mut out = HANDLE::default();
    unsafe {
        DuplicateHandle(GetCurrentProcess(), h, GetCurrentProcess(), &mut out, 0, true, DUPLICATE_SAME_ACCESS)
            .context("DuplicateHandle")?;
    }
    Ok(Handle(out))
}

/// Inheritable read handle on `NUL` (child stdin).
pub fn nul_input() -> Result<Handle> {
    let sa = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: std::ptr::null_mut(),
        bInheritHandle: TRUE,
    };
    let w = wide("NUL");
    let h = unsafe {
        CreateFileW(
            PCWSTR(w.as_ptr()),
            FILE_GENERIC_READ.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            Some(&sa),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            HANDLE::default(),
        )
        .context("open NUL")?
    };
    Ok(Handle(h))
}

/// Read everything from `h` on a thread.
pub fn read_thread(h: Handle) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        // Capture the whole `Handle` (Send), not just its `HANDLE` field (edition 2021 closures).
        let h = h;
        let mut out = Vec::new();
        let mut buf = [0u8; 8192];
        loop {
            let mut n = 0u32;
            let ok = unsafe { ReadFile(h.0, Some(&mut buf), Some(&mut n), None) };
            if ok.is_err() || n == 0 {
                break;
            }
            out.extend_from_slice(&buf[..n as usize]);
        }
        out
    })
}

/// `KEY=VALUE\0…\0\0` in UTF-16 for CREATE_UNICODE_ENVIRONMENT.
pub fn env_block(env: &[(String, String)]) -> Vec<u16> {
    let mut sorted: Vec<&(String, String)> = env.iter().collect();
    sorted.sort_by(|a, b| a.0.to_uppercase().cmp(&b.0.to_uppercase()));
    let mut out = Vec::new();
    for (k, v) in sorted {
        out.extend(format!("{k}={v}").encode_utf16());
        out.push(0);
    }
    if out.is_empty() {
        out.push(0);
    }
    out.push(0);
    out
}

/// Child process (suspended → assigned to `job` → resumed).
pub struct Child {
    pub process: Handle,
    _thread: Handle,
}

pub fn spawn_as(token: HANDLE, spec: &RunSpec, stdin: HANDLE, stdout: HANDLE, stderr: HANDLE, job: &Job) -> Result<Child> {
    let si = STARTUPINFOW {
        cb: std::mem::size_of::<STARTUPINFOW>() as u32,
        dwFlags: STARTF_USESTDHANDLES,
        hStdInput: stdin,
        hStdOutput: stdout,
        hStdError: stderr,
        ..Default::default()
    };
    let mut pi = PROCESS_INFORMATION::default();
    let mut cl = wide(&spec.command_line);
    let cwd = wide(&spec.cwd.to_string_lossy());
    let env = env_block(&spec.env);
    unsafe {
        CreateProcessAsUserW(
            token,
            PCWSTR::null(),
            PWSTR(cl.as_mut_ptr()),
            None,
            None,
            TRUE,
            CREATE_NO_WINDOW | CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT,
            Some(env.as_ptr() as *const c_void),
            PCWSTR(cwd.as_ptr()),
            &si,
            &mut pi,
        )
        .context("CreateProcessAsUserW")?;
    }
    let child = Child { process: Handle(pi.hProcess), _thread: Handle(pi.hThread) };
    if let Err(e) = job.assign(child.process.0) {
        job.terminate(1);
        return Err(e);
    }
    unsafe {
        ResumeThread(pi.hThread);
    }
    Ok(child)
}

/// Wait for `process`. `None` on timeout.
pub fn wait(process: HANDLE, timeout: Option<Duration>) -> Result<Option<u32>> {
    let ms = timeout.map(|d| d.as_millis().min(u32::MAX as u128 - 1) as u32).unwrap_or(INFINITE);
    unsafe {
        if WaitForSingleObject(process, ms) != WAIT_OBJECT_0 {
            return Ok(None);
        }
        let mut code = 0u32;
        GetExitCodeProcess(process, &mut code).context("GetExitCodeProcess")?;
        Ok(Some(code))
    }
}

/// Run `spec` with `token` in this process (no runner): used by the runner itself and by tests.
pub fn run_with_token(token: HANDLE, spec: &RunSpec, timeout: Option<Duration>) -> Result<RunOutput> {
    let job = Job::new(&spec.limits)?;
    let (out_r, out_w) = pipe(false, true)?;
    let (err_r, err_w) = pipe(false, true)?;
    let stdin = nul_input()?;
    let child = spawn_as(token, spec, stdin.0, out_w.0, err_w.0, &job)?;
    drop((out_w, err_w, stdin));
    let (t_out, t_err) = (read_thread(out_r), read_thread(err_r));
    let code = wait(child.process.0, timeout)?;
    let timed_out = code.is_none();
    if timed_out {
        job.terminate(1);
    }
    drop(job);
    Ok(RunOutput {
        code: code.map(|c| c as i32).unwrap_or(-1),
        stdout: t_out.join().unwrap_or_default(),
        stderr: t_err.join().unwrap_or_default(),
        timed_out,
    })
}
