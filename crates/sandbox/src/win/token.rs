//! The write-restricted token (recipe validated by the Phase 0 spike, `spike/README.md`).
//!
//! Restricting SIDs: 5ilence synthetic SID + logon SID + Everyone. Flags: WRITE_RESTRICTED |
//! LUA_TOKEN | DISABLE_MAX_PRIVILEGE. A write must pass the normal check AND the restricted
//! check, so the process can only write where an ACE names one of those SIDs. Without the logon
//! SID and Everyone every process dies at DLL init (0xC0000142). Consequence: places where
//! Everyone has write access stay writable (documented in docs/security/permissions.md).

use super::sid::{self, OwnedSid, SidBuf};
use anyhow::{Context, Result};
use std::ffi::c_void;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Security::{
    AddAccessAllowedAce, CreateRestrictedToken, GetLengthSid, GetTokenInformation, InitializeAcl, SetTokenInformation,
    TokenDefaultDacl, TokenUser, ACCESS_ALLOWED_ACE, ACL, ACL_REVISION, DISABLE_MAX_PRIVILEGE, LUA_TOKEN, PSID,
    SID_AND_ATTRIBUTES, TOKEN_ADJUST_DEFAULT, TOKEN_ASSIGN_PRIMARY, TOKEN_DEFAULT_DACL, TOKEN_DUPLICATE, TOKEN_QUERY,
    TOKEN_USER, WRITE_RESTRICTED,
};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

const GENERIC_ALL: u32 = 0x1000_0000;

/// Owned token handle.
pub struct Token(pub HANDLE);

impl Drop for Token {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

/// Restricted copy of this process's own primary token. A restricted version of the caller's
/// own token can be given to CreateProcessAsUserW without SeAssignPrimaryTokenPrivilege.
pub fn restricted_own_token() -> Result<Token> {
    unsafe {
        let mut own = HANDLE::default();
        OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT,
            &mut own,
        )
        .context("OpenProcessToken")?;
        let own = Token(own);
        restrict(own.0)
    }
}

fn restrict(base: HANDLE) -> Result<Token> {
    let syn = OwnedSid::parse(sid::SYN_SID)?;
    let everyone = OwnedSid::parse(sid::EVERYONE)?;
    let logon = sid::logon_sid(base)?;
    let restricting = [
        SID_AND_ATTRIBUTES { Sid: syn.psid(), Attributes: 0 },
        SID_AND_ATTRIBUTES { Sid: logon.psid(), Attributes: 0 },
        SID_AND_ATTRIBUTES { Sid: everyone.psid(), Attributes: 0 },
    ];
    let mut out = HANDLE::default();
    unsafe {
        CreateRestrictedToken(
            base,
            WRITE_RESTRICTED | LUA_TOKEN | DISABLE_MAX_PRIVILEGE,
            None,
            None,
            Some(&restricting),
            &mut out,
        )
        .context("CreateRestrictedToken")?;
    }
    let token = Token(out);
    let user = user_sid(base)?;
    let system = OwnedSid::parse(sid::SYSTEM)?;
    set_default_dacl(token.0, &[syn.psid(), logon.psid(), everyone.psid(), user.psid(), system.psid()])?;
    Ok(token)
}

fn user_sid(token: HANDLE) -> Result<SidBuf> {
    unsafe {
        let mut len = 0u32;
        let _ = GetTokenInformation(token, TokenUser, None, 0, &mut len);
        let mut buf = vec![0u8; len as usize];
        GetTokenInformation(token, TokenUser, Some(buf.as_mut_ptr() as *mut c_void), len, &mut len)
            .context("GetTokenInformation(TokenUser)")?;
        let user = &*(buf.as_ptr() as *const TOKEN_USER);
        SidBuf::copy(user.User.Sid)
    }
}

/// Default DACL for objects the sandboxed process creates: GENERIC_ALL to each SID, so the
/// process can still open its own objects under the write restriction.
fn set_default_dacl(token: HANDLE, sids: &[PSID]) -> Result<()> {
    unsafe {
        let mut size = std::mem::size_of::<ACL>() as u32;
        for &s in sids {
            size += std::mem::size_of::<ACCESS_ALLOWED_ACE>() as u32 + GetLengthSid(s) - 4;
        }
        // u32-aligned buffer for the ACL.
        let mut buf = vec![0u32; (size as usize + 3) / 4];
        let acl = buf.as_mut_ptr() as *mut ACL;
        InitializeAcl(acl, size, ACL_REVISION).context("InitializeAcl")?;
        for &s in sids {
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
        // The token copies the ACL; `buf` may go.
    }
    Ok(())
}
