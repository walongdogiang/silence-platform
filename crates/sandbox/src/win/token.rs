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

use super::sid::{self, OwnedSid};
use anyhow::{Context, Result};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use std::ffi::c_void;
use windows::Win32::Security::{
    AddAccessAllowedAce, CreateRestrictedToken, GetLengthSid, GetTokenInformation, InitializeAcl, SetTokenInformation,
    TokenDefaultDacl, TokenUser, ACCESS_ALLOWED_ACE, ACL, ACL_REVISION, CREATE_RESTRICTED_TOKEN_FLAGS,
    DISABLE_MAX_PRIVILEGE, LUA_TOKEN, PSID, SID_AND_ATTRIBUTES, TOKEN_ADJUST_DEFAULT, TOKEN_ASSIGN_PRIMARY,
    TOKEN_DEFAULT_DACL, TOKEN_DUPLICATE, TOKEN_QUERY, TOKEN_USER,
};

const GENERIC_ALL: u32 = 0x1000_0000;
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
    let token = Token(out);
    set_default_dacl(base, token.0)?;
    Ok(token)
}

/// Default DACL for objects the new process creates (its own process/thread objects included):
/// GENERIC_ALL to the token's user and SYSTEM. An admin token's default DACL grants only
/// Administrators, which may be deny-only in the derived token; the child then cannot open its
/// own objects and dies at DLL init (0xC0000142).
fn set_default_dacl(base: HANDLE, token: HANDLE) -> Result<()> {
    unsafe {
        let mut len = 0u32;
        let _ = GetTokenInformation(base, TokenUser, None, 0, &mut len);
        // u64-aligned buffer for TOKEN_USER (holds a pointer).
        let mut ubuf = vec![0u64; (len as usize + 7) / 8];
        GetTokenInformation(base, TokenUser, Some(ubuf.as_mut_ptr() as *mut c_void), len, &mut len)
            .context("GetTokenInformation(TokenUser)")?;
        let user = (*(ubuf.as_ptr() as *const TOKEN_USER)).User.Sid;
        let system = OwnedSid::parse(sid::SYSTEM)?;
        let sids: [PSID; 2] = [user, system.psid()];

        let mut size = std::mem::size_of::<ACL>() as u32;
        for &s in &sids {
            size += std::mem::size_of::<ACCESS_ALLOWED_ACE>() as u32 + GetLengthSid(s) - 4;
        }
        let mut abuf = vec![0u32; (size as usize + 3) / 4];
        let acl = abuf.as_mut_ptr() as *mut ACL;
        InitializeAcl(acl, size, ACL_REVISION).context("InitializeAcl")?;
        for &s in &sids {
            AddAccessAllowedAce(acl, ACL_REVISION, GENERIC_ALL, s).context("AddAccessAllowedAce")?;
        }
        let dd = TOKEN_DEFAULT_DACL { DefaultDacl: acl };
        SetTokenInformation(
            token,
            TokenDefaultDacl,
            &dd as *const _ as *const c_void,
            std::mem::size_of::<TOKEN_DEFAULT_DACL>() as u32,
        )
        .context("SetTokenInformation(TokenDefaultDacl)")?;
        // The token copies the ACL; the buffers may go.
    }
    Ok(())
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
