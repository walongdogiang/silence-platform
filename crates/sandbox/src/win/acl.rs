//! Add / remove ACEs for raw SIDs (icacls refuses SIDs that map to no account, like SYN_SID).
//!
//! `SetNamedSecurityInfoW` propagates inheritable ACEs to existing children, which is what we
//! need (existing files must become writable too) but walks the whole tree: slow on a first grant
//! of a big repo (`target/`, `node_modules/`).

use super::sid::{wide, OwnedSid};
use anyhow::{bail, Result};
use std::path::Path;
use windows::core::PWSTR;
use windows::Win32::Foundation::{LocalFree, ERROR_SUCCESS, HLOCAL};
use windows::Win32::Security::Authorization::{
    GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW, ACCESS_MODE, DENY_ACCESS, EXPLICIT_ACCESS_W,
    GRANT_ACCESS, REVOKE_ACCESS, SE_FILE_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows::Win32::Security::{
    ACE_FLAGS, ACL, CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION, NO_INHERITANCE, OBJECT_INHERIT_ACE,
    PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, SUB_CONTAINERS_AND_OBJECTS_INHERIT,
};

/// FILE_GENERIC_READ | FILE_GENERIC_EXECUTE.
pub const READ_EXECUTE: u32 = 0x0012_00A9;
/// "Modify": read, write, execute, delete.
pub const MODIFY: u32 = 0x0013_01BF;
pub const FULL: u32 = 0x001F_01FF;

#[derive(Clone, Copy)]
pub enum Inherit {
    /// Directory: applies to it, subfolders and files.
    Tree,
    /// This object only.
    #[allow(dead_code)]
    None,
}

pub struct Entry<'a> {
    pub sid: &'a str,
    pub mode: Mode,
    pub mask: u32,
    pub inherit: Inherit,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Grant,
    Deny,
    /// Remove every ACE for this SID.
    Revoke,
}

/// Merge `entries` into the DACL of `path`.
pub fn apply(path: &Path, entries: &[Entry]) -> Result<()> {
    set(path, entries, false)
}

/// Replace the DACL of `path` with exactly `entries`, not inheriting from the parent.
pub fn replace_protected(path: &Path, entries: &[Entry]) -> Result<()> {
    set(path, entries, true)
}

fn set(path: &Path, entries: &[Entry], protected: bool) -> Result<()> {
    let wpath = wide(&path.to_string_lossy());
    let sids: Vec<OwnedSid> = entries.iter().map(|e| OwnedSid::parse(e.sid)).collect::<Result<_>>()?;
    let explicit: Vec<EXPLICIT_ACCESS_W> = entries
        .iter()
        .zip(&sids)
        .map(|(e, s)| EXPLICIT_ACCESS_W {
            grfAccessPermissions: e.mask,
            grfAccessMode: match e.mode {
                Mode::Grant => GRANT_ACCESS,
                Mode::Deny => DENY_ACCESS,
                Mode::Revoke => REVOKE_ACCESS,
            } as ACCESS_MODE,
            grfInheritance: match e.inherit {
                Inherit::Tree => SUB_CONTAINERS_AND_OBJECTS_INHERIT,
                Inherit::None => NO_INHERITANCE,
            } as ACE_FLAGS,
            Trustee: TRUSTEE_W {
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_UNKNOWN,
                ptstrName: PWSTR(s.psid().0 as *mut u16),
                ..Default::default()
            },
        })
        .collect();
    unsafe {
        let mut old: *mut ACL = std::ptr::null_mut();
        let mut sd = PSECURITY_DESCRIPTOR::default();
        if !protected {
            let rc = GetNamedSecurityInfoW(
                windows::core::PCWSTR(wpath.as_ptr()),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                None,
                None,
                Some(&mut old),
                None,
                &mut sd,
            );
            if rc != ERROR_SUCCESS {
                bail!("GetNamedSecurityInfoW({}): {:?}", path.display(), rc);
            }
        }
        let mut new: *mut ACL = std::ptr::null_mut();
        let rc = SetEntriesInAclW(Some(&explicit), if protected { None } else { Some(old) }, &mut new);
        if rc != ERROR_SUCCESS {
            if !sd.0.is_null() {
                let _ = LocalFree(HLOCAL(sd.0));
            }
            bail!("SetEntriesInAclW({}): {:?}", path.display(), rc);
        }
        let info = if protected {
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION
        } else {
            DACL_SECURITY_INFORMATION
        };
        let rc = SetNamedSecurityInfoW(
            windows::core::PCWSTR(wpath.as_ptr()),
            SE_FILE_OBJECT,
            info,
            None,
            None,
            Some(new),
            None,
        );
        let _ = LocalFree(HLOCAL(new as *mut _));
        if !sd.0.is_null() {
            let _ = LocalFree(HLOCAL(sd.0));
        }
        if rc != ERROR_SUCCESS {
            bail!("SetNamedSecurityInfoW({}): {:?}", path.display(), rc);
        }
    }
    Ok(())
}

// Silence "unused" for the inheritance flag constants on some windows-rs versions.
#[allow(dead_code)]
const _INHERIT_FLAGS: [ACE_FLAGS; 2] = [CONTAINER_INHERIT_ACE, OBJECT_INHERIT_ACE];
