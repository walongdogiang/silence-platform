//! SIDs used by the sandbox.

use anyhow::{bail, Context, Result};
use std::ffi::c_void;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{LocalFree, HANDLE, HLOCAL};
use windows::Win32::Security::Authorization::{ConvertSidToStringSidW, ConvertStringSidToSidW};
use windows::Win32::Security::{
    CopySid, GetLengthSid, GetTokenInformation, LookupAccountNameW, TokenGroups, PSID, SID_NAME_USE, TOKEN_GROUPS,
};

/// Synthetic SID that marks "5ilence sandbox may write here". It belongs to no account (a made-up
/// S-1-5-21 domain), so only ACEs we add mention it. Phase 0 spike: a capability SID
/// (S-1-15-3-…) is rejected by CreateRestrictedToken.
pub const SYN_SID: &str = "S-1-5-21-3141592653-1589793238-2643383279-5110";
pub const EVERYONE: &str = "S-1-1-0";
pub const SYSTEM: &str = "S-1-5-18";
pub const ADMINISTRATORS: &str = "S-1-5-32-544";
pub const USERS: &str = "S-1-5-32-545";
/// SE_GROUP_LOGON_ID (winnt.h).
const SE_GROUP_LOGON_ID: u32 = 0xC000_0000;

pub(crate) fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}

/// A SID allocated by `ConvertStringSidToSidW` (freed with LocalFree).
pub struct OwnedSid(PSID);

impl OwnedSid {
    pub fn parse(s: &str) -> Result<Self> {
        let mut sid = PSID::default();
        let w = wide(s);
        unsafe { ConvertStringSidToSidW(PCWSTR(w.as_ptr()), &mut sid).with_context(|| format!("parse SID {s}"))? };
        Ok(Self(sid))
    }
    pub fn psid(&self) -> PSID {
        self.0
    }
}

impl Drop for OwnedSid {
    fn drop(&mut self) {
        unsafe {
            let _ = LocalFree(HLOCAL(self.0 .0));
        }
    }
}

/// A SID copied into our own buffer.
pub struct SidBuf(Vec<u8>);

impl SidBuf {
    pub fn psid(&self) -> PSID {
        PSID(self.0.as_ptr() as *mut c_void)
    }
    /// # Safety
    /// `src` must point to a valid SID.
    pub(crate) unsafe fn copy(src: PSID) -> Result<Self> {
        let n = GetLengthSid(src);
        let mut buf = vec![0u8; n as usize];
        CopySid(n, PSID(buf.as_mut_ptr() as *mut c_void), src).context("CopySid")?;
        Ok(Self(buf))
    }
}

pub fn to_string(sid: PSID) -> Result<String> {
    unsafe {
        let mut s = PWSTR::null();
        ConvertSidToStringSidW(sid, &mut s).context("ConvertSidToStringSidW")?;
        let out = s.to_string()?;
        let _ = LocalFree(HLOCAL(s.0 as *mut c_void));
        Ok(out)
    }
}

/// Logon-session SID of `token` (the window station / desktop grant it).
pub fn logon_sid(token: HANDLE) -> Result<SidBuf> {
    unsafe {
        let mut len = 0u32;
        let _ = GetTokenInformation(token, TokenGroups, None, 0, &mut len);
        let mut buf = vec![0u8; len as usize];
        GetTokenInformation(token, TokenGroups, Some(buf.as_mut_ptr() as *mut c_void), len, &mut len)
            .context("GetTokenInformation(TokenGroups)")?;
        let groups = &*(buf.as_ptr() as *const TOKEN_GROUPS);
        let list = std::slice::from_raw_parts(groups.Groups.as_ptr(), groups.GroupCount as usize);
        for g in list {
            if g.Attributes & SE_GROUP_LOGON_ID == SE_GROUP_LOGON_ID {
                return SidBuf::copy(g.Sid);
            }
        }
        bail!("token has no logon SID")
    }
}

/// SID string of a local account, e.g. `silence-sbx`.
pub fn account_sid(name: &str) -> Result<String> {
    unsafe {
        let w = wide(name);
        let (mut sid_len, mut dom_len) = (0u32, 0u32);
        let mut use_ = SID_NAME_USE::default();
        let _ = LookupAccountNameW(PCWSTR::null(), PCWSTR(w.as_ptr()), PSID::default(), &mut sid_len, PWSTR::null(), &mut dom_len, &mut use_);
        if sid_len == 0 {
            bail!("account {name} not found");
        }
        let mut sid = vec![0u8; sid_len as usize];
        let mut dom = vec![0u16; dom_len as usize];
        LookupAccountNameW(
            PCWSTR::null(),
            PCWSTR(w.as_ptr()),
            PSID(sid.as_mut_ptr() as *mut c_void),
            &mut sid_len,
            PWSTR(dom.as_mut_ptr()),
            &mut dom_len,
            &mut use_,
        )
        .with_context(|| format!("LookupAccountNameW({name})"))?;
        to_string(PSID(sid.as_mut_ptr() as *mut c_void))
    }
}
