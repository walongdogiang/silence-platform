//! Tests that need no sandbox user: they run commands under a deny-only copy of the CURRENT
//! user's token. Test folders get a protected DACL so access comes only from the groups we
//! choose, the way `D:\` grants Modify to Authenticated Users. Administrators is also made
//! deny-only here because CI runs as an admin (the real sandbox user never is one).

use super::acl::{self, Entry, Inherit, Mode, FULL, MODIFY};
use super::proc::{env_block, run_with_token};
use super::sid::{ADMINISTRATORS, SYSTEM};
use super::state::tmp_for;
use super::token::{deny_only, own_token, Token, DENY_ONLY};
use crate::spec::{Limits, RunSpec};
use std::path::Path;
use std::time::Duration;
use windows::Win32::Security::{DISABLE_MAX_PRIVILEGE, LUA_TOKEN};

const AUTH_USERS: &str = "S-1-5-11";

/// The production recipe plus Administrators deny-only (see module doc).
fn sandbox_like_token() -> Token {
    let mut groups = DENY_ONLY.to_vec();
    groups.push(ADMINISTRATORS);
    deny_only(own_token().unwrap().0, LUA_TOKEN | DISABLE_MAX_PRIVILEGE, &groups).unwrap()
}

/// Protected DACL: SYSTEM + Administrators full, plus `extra`.
fn protect(p: &Path, extra: Entry) {
    acl::replace_protected(
        p,
        &[
            Entry { sid: SYSTEM, mode: Mode::Grant, mask: FULL, inherit: Inherit::Tree },
            Entry { sid: ADMINISTRATORS, mode: Mode::Grant, mask: FULL, inherit: Inherit::Tree },
            extra,
        ],
    )
    .unwrap();
}

fn cmd(cwd: &Path, script: &str) -> RunSpec {
    RunSpec {
        command_line: format!(r#"C:\Windows\System32\cmd.exe /d /c "{script}""#),
        cwd: cwd.to_path_buf(),
        env: vec![
            ("SystemRoot".into(), std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into())),
            ("PATH".into(), r"C:\Windows\System32".into()),
        ],
        limits: Limits::standard(),
    }
}

#[test]
fn authenticated_users_grant_no_longer_lets_the_sandbox_write() {
    // Like D:\ : Modify for Authenticated Users only.
    let shared = tempfile::tempdir().unwrap();
    std::fs::write(shared.path().join("old.txt"), "x").unwrap();
    protect(shared.path(), Entry { sid: AUTH_USERS, mode: Mode::Grant, mask: MODIFY, inherit: Inherit::Tree });
    // Like a granted workspace: Modify for the (sandbox) user itself.
    let me = crate::owner_only::current_user_sid().unwrap();
    let granted = tempfile::tempdir().unwrap();
    std::fs::write(granted.path().join("old.txt"), "x").unwrap();
    protect(granted.path(), Entry { sid: &me, mode: Mode::Grant, mask: MODIFY, inherit: Inherit::Tree });

    let token = sandbox_like_token();
    let ok = run_with_token(token.0, &cmd(granted.path(), "echo hi> new.txt && echo more>> old.txt && echo OK"), None).unwrap();
    assert_eq!(ok.code, 0, "stderr: {}", String::from_utf8_lossy(&ok.stderr));
    assert!(granted.path().join("new.txt").exists());

    for script in ["echo hi> x.txt", "echo more>> old.txt"] {
        let denied = run_with_token(token.0, &cmd(shared.path(), script), None).unwrap();
        assert_ne!(denied.code, 0, "`{script}` must fail where only Authenticated Users may write");
    }
    assert!(!shared.path().join("x.txt").exists());
    assert_eq!(std::fs::read_to_string(shared.path().join("old.txt")).unwrap(), "x");

    // Control: the unrestricted token can write there (the denial comes from the token).
    let base = own_token().unwrap();
    let ctl = run_with_token(base.0, &cmd(shared.path(), "echo hi> x.txt"), None).unwrap();
    assert_eq!(ctl.code, 0);
}

#[test]
fn deny_ace_blocks_the_user_even_with_a_group_grant() {
    let dir = tempfile::tempdir().unwrap();
    let me = crate::owner_only::current_user_sid().unwrap();
    protect(dir.path(), Entry { sid: &me, mode: Mode::Grant, mask: MODIFY, inherit: Inherit::Tree });
    // Same kind of ACE setup puts on C:\ProgramData and C:\Windows\Temp for silence-sbx.
    acl::apply(dir.path(), &[Entry { sid: &me, mode: Mode::Deny, mask: super::setup::DENY_CREATE, inherit: Inherit::None }]).unwrap();
    let token = sandbox_like_token();
    let out = run_with_token(token.0, &cmd(dir.path(), "echo hi> x.txt"), None).unwrap();
    assert_ne!(out.code, 0);
    assert!(!dir.path().join("x.txt").exists());
    // Clean up: the test dir still has to be removable by us.
    acl::apply(dir.path(), &[Entry { sid: &me, mode: Mode::Revoke, mask: 0, inherit: Inherit::None }]).unwrap();
    protect(dir.path(), Entry { sid: &me, mode: Mode::Grant, mask: FULL, inherit: Inherit::Tree });
}

#[test]
fn timeout_kills_the_tree() {
    let dir = tempfile::tempdir().unwrap();
    let token = sandbox_like_token();
    let t = std::time::Instant::now();
    let out = run_with_token(token.0, &cmd(dir.path(), "ping -n 30 127.0.0.1 >nul"), Some(Duration::from_millis(500))).unwrap();
    assert!(out.timed_out);
    assert!(t.elapsed() < Duration::from_secs(10));
}

#[test]
fn exit_code_and_stderr_come_back() {
    let dir = tempfile::tempdir().unwrap();
    let token = sandbox_like_token();
    let out = run_with_token(token.0, &cmd(dir.path(), "echo boom 1>&2 & exit /b 7"), None).unwrap();
    assert_eq!(out.code, 7);
    assert!(String::from_utf8_lossy(&out.stderr).contains("boom"));
}

#[test]
fn env_block_is_double_nul_terminated_and_sorted() {
    let b = env_block(&[("b".into(), "2".into()), ("A".into(), "1".into())]);
    let s = String::from_utf16_lossy(&b);
    assert_eq!(s, "A=1\0b=2\0\0");
    assert_eq!(String::from_utf16_lossy(&env_block(&[])), "\0\0");
}

#[test]
fn tmp_dir_is_stable_and_case_insensitive() {
    assert_eq!(tmp_for(Path::new(r"D:\Repo")), tmp_for(Path::new(r"d:\repo")));
    assert_ne!(tmp_for(Path::new(r"D:\a")), tmp_for(Path::new(r"D:\b")));
}

#[test]
fn default_env_has_no_secrets_and_points_temp_at_sandbox() {
    let base = vec![
        ("PATH".into(), r"C:\Windows".into()),
        ("SILENCE_API_KEY".into(), "sk".into()),
        ("TEMP".into(), r"C:\Users\me\AppData\Local\Temp".into()),
    ];
    let env = super::setup::default_env(Path::new(r"D:\nope-ws"), base);
    assert!(!env.iter().any(|(k, _)| k == "SILENCE_API_KEY"));
    let temp = env.iter().find(|(k, _)| k == "TEMP").map(|(_, v)| v.clone()).unwrap();
    assert!(temp.to_lowercase().contains("silence-sbx"), "{temp}");
    assert_eq!(env.iter().filter(|(k, _)| k.eq_ignore_ascii_case("TEMP")).count(), 1);
}

/// Regression for the Phase 3 finding: Schannel TLS (curl.exe, cargo, .NET) must work with the
/// sandbox token. It failed with SEC_E_NO_CREDENTIALS under any token with restricting SIDs.
#[test]
#[ignore = "needs network"]
fn schannel_tls_works_with_the_sandbox_token() {
    let dir = tempfile::tempdir().unwrap();
    let token = super::token::restricted_own_token().unwrap();
    let spec = cmd(dir.path(), r"C:\Windows\System32\curl.exe -sS --max-time 15 -o NUL -w http=%{http_code} https://example.com/");
    let out = run_with_token(token.0, &spec, Some(Duration::from_secs(30))).unwrap();
    assert_eq!(out.code, 0, "{}", String::from_utf8_lossy(&out.stderr));
    assert!(String::from_utf8_lossy(&out.stdout).contains("http=200"));
}

/// Full path through the sandbox user. Needs `silence-engine sandbox setup` first and a built
/// Engine exe; run with `cargo test -p silence-sandbox -- --ignored`.
#[test]
#[ignore = "needs `silence-engine sandbox setup` (admin once) and SILENCE_ENGINE_EXE"]
fn runs_as_sandbox_user() {
    let exe = std::env::var("SILENCE_ENGINE_EXE").expect("SILENCE_ENGINE_EXE");
    let ws = tempfile::tempdir_in(std::env::var("SANDBOX_TEST_ROOT").unwrap_or_else(|_| r"D:\".into())).unwrap();
    super::setup::grant_workspace(ws.path()).unwrap();
    let mut spec = cmd(ws.path(), "whoami && echo hi> ok.txt");
    spec.env = super::setup::default_env(ws.path(), std::env::vars_os());
    let out = super::launch::run(&spec, Path::new(&exe), Some(Duration::from_secs(30))).unwrap();
    assert_eq!(out.code, 0, "{}", String::from_utf8_lossy(&out.stderr));
    assert!(String::from_utf8_lossy(&out.stdout).contains("silence-sbx"));
}
