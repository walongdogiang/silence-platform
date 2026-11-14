//! Install, uninstall, status, and per-workspace grants.

use super::acl::{self, Entry, Inherit, Mode, FULL, MODIFY, READ_EXECUTE};
use super::account;
use super::sid::{self, wide};
use super::state::{self, State, STATE_VERSION, USER};
use crate::spec::SandboxStatus;
use anyhow::{anyhow, bail, Context, Result};
use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
use windows::Win32::System::Threading::{
    GetCurrentProcess, GetExitCodeProcess, OpenProcessToken, WaitForSingleObject, INFINITE,
};
use windows::Win32::UI::Shell::{DeleteProfileW, ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

pub fn is_elevated() -> bool {
    unsafe {
        let mut tok = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut tok).is_err() {
            return false;
        }
        let mut e = TOKEN_ELEVATION::default();
        let mut len = 0u32;
        let ok = GetTokenInformation(
            tok,
            TokenElevation,
            Some(&mut e as *mut _ as *mut c_void),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut len,
        );
        let _ = CloseHandle(tok);
        ok.is_ok() && e.TokenIsElevated != 0
    }
}

/// Run `exe args` elevated (UAC prompt) and wait. Returns its exit code.
pub fn run_elevated(exe: &Path, args: &str) -> Result<u32> {
    let verb = wide("runas");
    let file = wide(&exe.to_string_lossy());
    let params = wide(args);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: PCWSTR(verb.as_ptr()),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: PCWSTR(params.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    unsafe {
        ShellExecuteExW(&mut info).context("UAC elevation was cancelled or failed")?;
        if info.hProcess.is_invalid() {
            bail!("elevated process did not start");
        }
        WaitForSingleObject(info.hProcess, INFINITE);
        let mut code = 0u32;
        GetExitCodeProcess(info.hProcess, &mut code)?;
        let _ = CloseHandle(info.hProcess);
        Ok(code)
    }
}

fn log(msg: &str) {
    let _ = std::fs::create_dir_all(state::user_dir());
    let line = format!("{} {msg}\n", chrono_like_now());
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(state::setup_log()) {
        let _ = f.write_all(line.as_bytes());
    }
}

fn chrono_like_now() -> String {
    let s = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format!("[{s}]")
}

/// Create the sandbox user, its folders and the encrypted password. Must run elevated, as the
/// same Windows account that runs Studio (DPAPI and state.json are per-user).
pub fn setup_elevated() -> Result<()> {
    if !is_elevated() {
        bail!("setup must run elevated");
    }
    let r = setup_inner();
    match &r {
        Ok(()) => log("setup: ok"),
        Err(e) => log(&format!("setup: FAILED: {e:#}")),
    }
    r
}

fn setup_inner() -> Result<()> {
    let installer_sid = crate::owner_only::current_user_sid()?;
    let password = account::random_password();
    account::create_or_reset(USER, &password).context("create sandbox user")?;
    account::hide(USER).context("hide sandbox user")?;
    let sbx_sid = sid::account_sid(USER)?;

    std::fs::create_dir_all(state::user_dir())?;
    std::fs::write(state::cred_path(), account::protect(password.as_bytes())?).context("write cred.bin")?;

    // %ProgramData%\silence-sbx: only SYSTEM, Administrators, the installing user (to stage the
    // runner and create tmp dirs) and the sandbox user (read/execute).
    let root = state::machine_root();
    for d in [state::bin_dir(), state::home_dir(), state::tmp_root()] {
        std::fs::create_dir_all(&d).with_context(|| format!("create {}", d.display()))?;
    }
    acl::replace_protected(
        &root,
        &[
            Entry { sid: sid::SYSTEM, mode: Mode::Grant, mask: FULL, inherit: Inherit::Tree },
            Entry { sid: sid::ADMINISTRATORS, mode: Mode::Grant, mask: FULL, inherit: Inherit::Tree },
            Entry { sid: &installer_sid, mode: Mode::Grant, mask: MODIFY, inherit: Inherit::Tree },
            Entry { sid: &sbx_sid, mode: Mode::Grant, mask: READ_EXECUTE, inherit: Inherit::Tree },
        ],
    )?;
    // home\ and tmp\: the sandbox may write (both checks: its user SID and the 5ilence SID).
    for d in [state::home_dir(), state::tmp_root()] {
        acl::apply(&d, &sandbox_write(&sbx_sid))?;
    }

    let mut st = State::load().ok().flatten().unwrap_or(State {
        version: STATE_VERSION,
        user: USER.into(),
        user_sid: sbx_sid.clone(),
        granted: vec![],
    });
    st.user_sid = sbx_sid;
    st.version = STATE_VERSION;
    st.save()
}

fn sandbox_write(sbx_sid: &str) -> [Entry<'_>; 2] {
    [
        Entry { sid: sbx_sid, mode: Mode::Grant, mask: MODIFY, inherit: Inherit::Tree },
        Entry { sid: sid::SYN_SID, mode: Mode::Grant, mask: MODIFY, inherit: Inherit::Tree },
    ]
}

/// Remove everything setup and grants created. Must run elevated.
pub fn uninstall_elevated() -> Result<()> {
    if !is_elevated() {
        bail!("uninstall must run elevated");
    }
    let st = State::load()?;
    let sbx_sid = st.as_ref().map(|s| s.user_sid.clone()).or_else(|| sid::account_sid(USER).ok());
    let mut errors = Vec::new();
    if let (Some(st), Some(sbx)) = (&st, &sbx_sid) {
        for ws in &st.granted {
            if ws.exists() {
                if let Err(e) = revoke(ws, sbx) {
                    errors.push(format!("{}: {e:#}", ws.display()));
                }
            }
        }
    }
    if let Some(sbx) = &sbx_sid {
        let w = wide(sbx);
        unsafe {
            let _ = DeleteProfileW(PCWSTR(w.as_ptr()), PCWSTR::null(), PCWSTR::null());
        }
    }
    if let Err(e) = account::delete(USER) {
        errors.push(format!("delete user: {e:#}"));
    }
    account::unhide(USER);
    let _ = std::fs::remove_dir_all(state::machine_root());
    let _ = std::fs::remove_file(state::cred_path());
    let _ = std::fs::remove_file(state::state_path());
    if errors.is_empty() {
        log("uninstall: ok");
        Ok(())
    } else {
        let msg = errors.join("; ");
        log(&format!("uninstall: partial: {msg}"));
        Err(anyhow!("uninstall finished with errors: {msg}"))
    }
}

fn revoke(path: &Path, sbx_sid: &str) -> Result<()> {
    acl::apply(
        path,
        &[
            Entry { sid: sbx_sid, mode: Mode::Revoke, mask: 0, inherit: Inherit::Tree },
            Entry { sid: sid::SYN_SID, mode: Mode::Revoke, mask: 0, inherit: Inherit::Tree },
        ],
    )
}

pub fn status() -> SandboxStatus {
    let st = match State::load() {
        Ok(Some(s)) => s,
        Ok(None) => return SandboxStatus::NotInstalled,
        Err(e) => return SandboxStatus::Degraded(format!("state.json: {e:#}")),
    };
    if !account::exists(&st.user) {
        return SandboxStatus::Degraded(format!("user {} is missing", st.user));
    }
    match std::fs::read(state::cred_path()).map_err(anyhow::Error::from).and_then(|b| account::unprotect(&b)) {
        Ok(_) => {}
        Err(e) => return SandboxStatus::Degraded(format!("password: {e:#}")),
    }
    for d in [state::bin_dir(), state::home_dir(), state::tmp_root()] {
        if !d.is_dir() {
            return SandboxStatus::Degraded(format!("missing {}", d.display()));
        }
    }
    SandboxStatus::Ready
}

/// Let the sandbox write in `ws` (both its user SID and the 5ilence SID, inherited by everything
/// below), deny it `.silence/`, and create its temp dir. No admin needed: the user owns `ws`.
/// The first grant of a big tree is slow (ACL propagation walks every file).
pub fn grant_workspace(ws: &Path) -> Result<Duration> {
    let mut st = State::load()?.ok_or_else(|| anyhow!("sandbox is not installed"))?;
    let ws = canonical(ws)?;
    let t = Instant::now();
    acl::apply(&ws, &sandbox_write(&st.user_sid))?;
    // Agent kit and permission files: never readable or writable from the sandbox.
    let kit = ws.join(".silence");
    if kit.is_dir() {
        acl::apply(&kit, &[Entry { sid: &st.user_sid, mode: Mode::Deny, mask: FULL, inherit: Inherit::Tree }])?;
    }
    std::fs::create_dir_all(state::tmp_for(&ws))?;
    st.add_granted(&ws);
    st.save()?;
    Ok(t.elapsed())
}

/// Let the sandbox read (not write) `path`, e.g. a toolchain under the real user's profile.
pub fn grant_read(path: &Path) -> Result<()> {
    let mut st = State::load()?.ok_or_else(|| anyhow!("sandbox is not installed"))?;
    let path = canonical(path)?;
    acl::apply(&path, &[Entry { sid: &st.user_sid, mode: Mode::Grant, mask: READ_EXECUTE, inherit: Inherit::Tree }])?;
    st.add_granted(&path);
    st.save()
}

/// Environment for a sandboxed command in `ws`: the allowlisted part of `base` (no secrets),
/// with TEMP/TMP and the profile folders pointing at sandbox-writable places. TEMP matters:
/// PowerShell 5.1 falls back to ConstrainedLanguage when it cannot write there (Phase 0).
pub fn default_env<I>(ws: &Path, base: I) -> Vec<(String, String)>
where
    I: IntoIterator<Item = (std::ffi::OsString, std::ffi::OsString)>,
{
    let tmp = state::tmp_for(&canonical(ws).unwrap_or_else(|_| ws.to_path_buf()));
    let home = state::home_dir();
    let overrides: [(&str, PathBuf); 7] = [
        ("TEMP", tmp.clone()),
        ("TMP", tmp),
        ("USERPROFILE", home.clone()),
        ("HOME", home.clone()),
        ("APPDATA", home.join("AppData").join("Roaming")),
        ("LOCALAPPDATA", home.join("AppData").join("Local")),
        ("HOMEPATH", PathBuf::from(home.to_string_lossy().trim_start_matches(|c: char| c != '\\').to_string())),
    ];
    let mut env: Vec<(String, String)> = crate::env::scrub(base)
        .into_iter()
        .filter_map(|(k, v)| Some((k.into_string().ok()?, v.into_string().ok()?)))
        .filter(|(k, _)| !overrides.iter().any(|(o, _)| o.eq_ignore_ascii_case(k)))
        .collect();
    for (k, v) in overrides {
        env.push((k.to_string(), v.to_string_lossy().into_owned()));
    }
    env
}

fn canonical(p: &Path) -> Result<PathBuf> {
    let c = std::fs::canonicalize(p).with_context(|| format!("canonicalize {}", p.display()))?;
    // Strip the verbatim prefix (\\?\C:\…) so ACL calls and state.json use normal paths.
    let s = c.to_string_lossy();
    Ok(PathBuf::from(s.strip_prefix(r"\\?\").unwrap_or(&s)))
}
