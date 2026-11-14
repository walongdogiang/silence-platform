//! The sandbox token.
//!
//! The runner (running as `silence-sbx`) derives the command's token from its own: the groups
//! `Authenticated Users` (S-1-5-11) and `INTERACTIVE` (S-1-5-4) become deny-only, and LUA_TOKEN |
//! DISABLE_MAX_PRIVILEGE strip privileges. So the command can write only where an ACE names the
//! sandbox user itself (granted workspaces, its temp/home/profile) or the `Users` group (some
//! shared folders: C:\ProgramData and C:\Windows\Temp roots get an explicit deny at setup).
//! Drives like D:\ that grant Modify to Authenticated Users become read-only.
//!
//! History (Phase 0 spike → Phase 3): a WRITE_RESTRICTED token (restricting SIDs) blocked writes
//! even more tightly, but LSASS refuses Schannel credentials to ANY token with restricting SIDs
//! (`SEC_E_NO_CREDENTIALS`, verified with every flag/SID combination), which breaks TLS for
//! curl.exe, cargo and .NET. Deny-only groups keep Schannel working.

use super::sid::OwnedSid;
use anyhow::{Context, Result};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Security::{
    CreateRestrictedToken, CREATE_RESTRICTED_TOKEN_FLAGS, DISABLE_MAX_PRIVILEGE, LUA_TOKEN, SID_AND_ATTRIBUTES,
    TOKEN_ADJUST_DEFAULT, TOKEN_ASSIGN_PRIMARY, TOKEN_DUPLICATE, TOKEN_QUERY,
};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

/// Groups turned deny-only in the sandbox token.
pub const DENY_ONLY: [&str; 2] = ["S-1-5-11", "S-1-5-4"];

/// Owned token handle.
pub struct Token(pub HANDLE);

impl Drop for Token {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

/// Sandbox token derived from this process's own primary token. A restricted version of the
/// caller's own token can be given to CreateProcessAsUserW without SeAssignPrimaryTokenPrivilege.
pub fn restricted_own_token() -> Result<Token> {
    let own = own_token()?;
    deny_only(own.0, LUA_TOKEN | DISABLE_MAX_PRIVILEGE, &DENY_ONLY)
}

pub(crate) fn deny_only(base: HANDLE, flags: CREATE_RESTRICTED_TOKEN_FLAGS, disable: &[&str]) -> Result<Token> {
    let sids: Vec<OwnedSid> = disable.iter().map(|s| OwnedSid::parse(s)).collect::<Result<_>>()?;
    let list: Vec<SID_AND_ATTRIBUTES> = sids.iter().map(|s| SID_AND_ATTRIBUTES { Sid: s.psid(), Attributes: 0 }).collect();
    let mut out = HANDLE::default();
    unsafe {
        CreateRestrictedToken(base, flags, Some(&list), None, None, &mut out).context("CreateRestrictedToken")?;
    }
    Ok(Token(out))
}

pub(crate) fn own_token() -> Result<Token> {
    unsafe {
        let mut own = HANDLE::default();
        OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT,
            &mut own,
        )
        .context("OpenProcessToken")?;
        Ok(Token(own))
    }
}
