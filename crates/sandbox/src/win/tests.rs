//! Tests that need no sandbox user: they run commands under the restricted copy of the
//! CURRENT user's token. The current user owns the temp dirs, so the normal access check always
//! passes; only the restricted check (5ilence SID ACE present or not) decides. That is exactly
//! the part that keeps the sandbox from writing outside the workspace.

use super::acl::{self, Entry, Inherit, Mode, MODIFY};
use super::proc::{env_block, run_with_token};
use super::sid::SYN_SID;
use super::state::tmp_for;
use super::token::restricted_own_token;
use crate::spec::{Limits, RunSpec};
use std::path::Path;
use std::time::Duration;

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

fn grant_syn(p: &Path) {
    acl::apply(p, &[Entry { sid: SYN_SID, mode: Mode::Grant, mask: MODIFY, inherit: Inherit::Tree }]).unwrap();
}

#[test]
fn writes_only_where_the_5ilence_sid_is_granted() {
    let granted = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    // Existing file created BEFORE the grant: must become writable through propagation.
    std::fs::write(granted.path().join("old.txt"), "x").unwrap();
    grant_syn(granted.path());
    let token = restricted_own_token().unwrap();

    let ok = run_with_token(token.0, &cmd(granted.path(), "echo hi> new.txt && echo more>> old.txt && echo OK"), None).unwrap();
    assert_eq!(ok.code, 0, "stderr: {}", String::from_utf8_lossy(&ok.stderr));
    assert!(String::from_utf8_lossy(&ok.stdout).contains("OK"));
    assert!(granted.path().join("new.txt").exists());

    let target = other.path().join("x.txt");
    let denied = run_with_token(token.0, &cmd(granted.path(), &format!("echo hi> \"{}\"", target.display())), None).unwrap();
    assert_ne!(denied.code, 0, "write outside the grant must fail");
    assert!(!target.exists());
}

#[test]
fn revoke_removes_write_access() {
    let dir = tempfile::tempdir().unwrap();
    grant_syn(dir.path());
    acl::apply(dir.path(), &[Entry { sid: SYN_SID, mode: Mode::Revoke, mask: 0, inherit: Inherit::Tree }]).unwrap();
    let token = restricted_own_token().unwrap();
    let out = run_with_token(token.0, &cmd(dir.path(), "echo hi> x.txt"), None).unwrap();
    assert_ne!(out.code, 0);
    assert!(!dir.path().join("x.txt").exists());
}

#[test]
fn timeout_kills_the_tree() {
    let dir = tempfile::tempdir().unwrap();
    let token = restricted_own_token().unwrap();
    let t = std::time::Instant::now();
    let out = run_with_token(token.0, &cmd(dir.path(), "ping -n 30 127.0.0.1 >nul"), Some(Duration::from_millis(500))).unwrap();
    assert!(out.timed_out);
    assert!(t.elapsed() < Duration::from_secs(10));
}

#[test]
fn exit_code_and_stderr_come_back() {
    let dir = tempfile::tempdir().unwrap();
    let token = restricted_own_token().unwrap();
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
