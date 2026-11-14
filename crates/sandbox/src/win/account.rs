//! The sandbox Windows account and its password (DPAPI).

use super::sid::{self, wide};
use anyhow::{bail, Context, Result};
use std::ffi::c_void;
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::NetworkManagement::NetManagement::{
    NetApiBufferFree, NetLocalGroupAddMembers, NetUserAdd, NetUserDel, NetUserGetInfo, NetUserSetInfo,
    LOCALGROUP_MEMBERS_INFO_0, UF_DONT_EXPIRE_PASSWD, UF_PASSWD_CANT_CHANGE, UF_SCRIPT, USER_INFO_1, USER_INFO_1003,
    USER_PRIV_USER,
};
use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB};
use windows::Win32::Security::{LookupAccountSidW, PSID, SID_NAME_USE};
use windows::Win32::System::Registry::{
    RegCreateKeyExW, RegDeleteKeyValueW, RegSetValueExW, HKEY, HKEY_LOCAL_MACHINE, KEY_SET_VALUE,
    REG_DWORD, REG_OPTION_NON_VOLATILE,
};

const NERR_SUCCESS: u32 = 0;
const NERR_USER_EXISTS: u32 = 2224;
const NERR_USER_NOT_FOUND: u32 = 2221;
const ERROR_MEMBER_IN_ALIAS: u32 = 1378;
const USERLIST_KEY: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\SpecialAccounts\UserList";

/// 40 chars with upper, lower, digit and symbol (local password policies).
pub fn random_password() -> String {
    format!("Sx9!{}{}", uuid::Uuid::new_v4().simple(), &uuid::Uuid::new_v4().simple().to_string()[..4]).replace('a', "A")
}

pub fn exists(name: &str) -> bool {
    let w = wide(name);
    unsafe {
        let mut buf: *mut u8 = std::ptr::null_mut();
        let rc = NetUserGetInfo(PCWSTR::null(), PCWSTR(w.as_ptr()), 0, &mut buf);
        if !buf.is_null() {
            NetApiBufferFree(Some(buf as *const c_void));
        }
        rc == NERR_SUCCESS
    }
}

/// Create the account, or reset its password if it already exists. Needs admin.
pub fn create_or_reset(name: &str, password: &str) -> Result<()> {
    let mut wname = wide(name);
    let mut wpass = wide(password);
    let mut comment = wide("5ilence sandbox (runs agent commands with restricted rights)");
    unsafe {
        let info = USER_INFO_1 {
            usri1_name: PWSTR(wname.as_mut_ptr()),
            usri1_password: PWSTR(wpass.as_mut_ptr()),
            usri1_priv: USER_PRIV_USER,
            usri1_comment: PWSTR(comment.as_mut_ptr()),
            usri1_flags: UF_SCRIPT | UF_DONT_EXPIRE_PASSWD | UF_PASSWD_CANT_CHANGE,
            ..Default::default()
        };
        let rc = NetUserAdd(PCWSTR::null(), 1, &info as *const _ as *const u8, None);
        if rc == NERR_USER_EXISTS {
            let p = USER_INFO_1003 { usri1003_password: PWSTR(wpass.as_mut_ptr()) };
            let rc = NetUserSetInfo(PCWSTR::null(), PCWSTR(wname.as_ptr()), 1003, &p as *const _ as *const u8, None);
            if rc != NERR_SUCCESS {
                bail!("NetUserSetInfo(password) failed: {rc}");
            }
        } else if rc != NERR_SUCCESS {
            bail!("NetUserAdd failed: {rc}");
        }
    }
    add_to_users_group(name)?;
    Ok(())
}

/// Builtin "Users" (name is localized, so look it up from S-1-5-32-545). The member is passed
/// by SID: a `.\name` string fails with 1387 (ERROR_NO_SUCH_MEMBER) on some machines.
fn add_to_users_group(name: &str) -> Result<()> {
    let group = group_name(sid::USERS)?;
    let member = sid::OwnedSid::parse(&sid::account_sid(name)?)?;
    let wgroup = wide(&group);
    unsafe {
        let m = LOCALGROUP_MEMBERS_INFO_0 { lgrmi0_sid: member.psid() };
        let rc = NetLocalGroupAddMembers(PCWSTR::null(), PCWSTR(wgroup.as_ptr()), 0, &m as *const _ as *const u8, 1);
        if rc != NERR_SUCCESS && rc != ERROR_MEMBER_IN_ALIAS {
            bail!("NetLocalGroupAddMembers({group}) failed: {rc}");
        }
    }
    Ok(())
}

fn group_name(sid_str: &str) -> Result<String> {
    let owned = sid::OwnedSid::parse(sid_str)?;
    unsafe {
        let (mut n, mut d) = (0u32, 0u32);
        let mut u = SID_NAME_USE::default();
        let _ = LookupAccountSidW(PCWSTR::null(), owned.psid(), PWSTR::null(), &mut n, PWSTR::null(), &mut d, &mut u);
        let mut name = vec![0u16; n as usize];
        let mut dom = vec![0u16; d as usize];
        LookupAccountSidW(
            PCWSTR::null(),
            owned.psid(),
            PWSTR(name.as_mut_ptr()),
            &mut n,
            PWSTR(dom.as_mut_ptr()),
            &mut d,
            &mut u,
        )
        .context("LookupAccountSidW")?;
        Ok(String::from_utf16_lossy(&name[..n as usize]))
    }
}

pub fn delete(name: &str) -> Result<()> {
    let w = wide(name);
    let rc = unsafe { NetUserDel(PCWSTR::null(), PCWSTR(w.as_ptr())) };
    if rc != NERR_SUCCESS && rc != NERR_USER_NOT_FOUND {
        bail!("NetUserDel failed: {rc}");
    }
    Ok(())
}

/// Hide from the sign-in screen (needs admin).
pub fn hide(name: &str) -> Result<()> {
    unsafe {
        let key = wide(USERLIST_KEY);
        let mut h = HKEY::default();
        RegCreateKeyExW(
            HKEY_LOCAL_MACHINE,
            PCWSTR(key.as_ptr()),
            0,
            PCWSTR::null(),
            REG_OPTION_NON_VOLATILE,
            KEY_SET_VALUE,
            None,
            &mut h,
            None,
        )
        .ok()
        .context("RegCreateKeyExW(UserList)")?;
        let val = wide(name);
        let zero = 0u32.to_le_bytes();
        let rc = RegSetValueExW(h, PCWSTR(val.as_ptr()), 0, REG_DWORD, Some(&zero));
        let _ = windows::Win32::System::Registry::RegCloseKey(h);
        rc.ok().context("RegSetValueExW(UserList)")?;
    }
    Ok(())
}

pub fn unhide(name: &str) {
    let key = wide(USERLIST_KEY);
    let val = wide(name);
    unsafe {
        let _ = RegDeleteKeyValueW(HKEY_LOCAL_MACHINE, PCWSTR(key.as_ptr()), PCWSTR(val.as_ptr()));
    }
}

/// DPAPI, current-user scope.
pub fn protect(data: &[u8]) -> Result<Vec<u8>> {
    unsafe {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB::default();
        CryptProtectData(&input, PCWSTR::null(), None, None, None, 0, &mut out).context("CryptProtectData")?;
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(HLOCAL(out.pbData as *mut c_void));
        Ok(v)
    }
}

pub fn unprotect(data: &[u8]) -> Result<Vec<u8>> {
    unsafe {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB::default();
        CryptUnprotectData(&input, None, None, None, None, 0, &mut out).context("CryptUnprotectData")?;
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(HLOCAL(out.pbData as *mut c_void));
        Ok(v)
    }
}

#[allow(dead_code)]
fn _unused(_: PSID) {}
