//! SIDs used by the sandbox.

use anyhow::{bail, Context, Result};
use std::ffi::c_void;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Authorization::{ConvertSidToStringSidW, ConvertStringSidToSidW};
use windows::Win32::Security::{LookupAccountNameW, PSID, SID_NAME_USE};

/// Synthetic SID used by the Phase 2 write-restricted token. No longer granted (Phase 3 moved to
/// a deny-only token for Schannel); uninstall still revokes it from workspaces granted earlier.
pub const SYN_SID: &str = "S-1-5-21-3141592653-1589793238-2643383279-5110";
pub const SYSTEM: &str = "S-1-5-18";
pub const ADMINISTRATORS: &str = "S-1-5-32-544";
pub const USERS: &str = "S-1-5-32-545";

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

pub fn to_string(sid: PSID) -> Result<String> {
    unsafe {
        let mut s = PWSTR::null();
        ConvertSidToStringSidW(sid, &mut s).context("ConvertSidToStringSidW")?;
        let out = s.to_string()?;
        let _ = LocalFree(HLOCAL(s.0 as *mut c_void));
        Ok(out)
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
