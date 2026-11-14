//! Windows Firewall rule: block every outbound connection of the sandbox user except loopback.
//!
//! Loopback cannot be filtered by Windows Firewall anyway, which is where the 5ilence proxy
//! listens (and why the Engine RPC needs its token). DNS lookups go through the DNS Client
//! service, not the sandbox user, so they are NOT blocked: a sandboxed command can still resolve
//! names (a slow data channel through DNS queries remains; documented in permissions.md).
//!
//! Uses the NetSecurity PowerShell module: setup/uninstall run elevated; `check` works as a normal
//! user (reading firewall config needs no admin).

use anyhow::{bail, Context, Result};
use std::process::Command;

pub const RULE_NAME: &str = "5ilence sandbox: block outbound";
/// Everything except 127.0.0.0/8 and ::1 (and the unspecified ::).
const REMOTE: &str = "'0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255','::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'";

fn powershell(script: &str) -> Result<String> {
    let out = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .output()
        .context("run powershell")?;
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.status.success() {
        bail!("{} {}", stdout, String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(stdout)
}

/// (Re)create the rule for `user_sid`. Needs admin.
pub fn install(user_sid: &str) -> Result<()> {
    if !user_sid.starts_with("S-1-5-") || user_sid.contains(['\'', ';', ')']) {
        bail!("unexpected SID {user_sid}");
    }
    powershell(&format!(
        "$ErrorActionPreference='Stop'; \
         Get-NetFirewallRule -DisplayName '{RULE_NAME}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule; \
         New-NetFirewallRule -DisplayName '{RULE_NAME}' -Direction Outbound -Action Block -Profile Any \
           -LocalUser 'D:(A;;CC;;;{user_sid})' -RemoteAddress @({REMOTE}) \
           -Description 'Blocks network access of the 5ilence sandbox user; its allowed traffic goes through the 5ilence proxy on loopback.' | Out-Null"
    ))
    .context("create firewall rule")?;
    Ok(())
}

/// Remove the rule. Needs admin.
pub fn remove() -> Result<()> {
    powershell(&format!(
        "Get-NetFirewallRule -DisplayName '{RULE_NAME}' -ErrorAction SilentlyContinue | Remove-NetFirewallRule"
    ))
    .map(|_| ())
}

const POLICY: &str = r"SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy";
const GPO_POLICY: &str = r"SOFTWARE\Policies\Microsoft\WindowsFirewall";
const PROFILES: [&str; 3] = ["DomainProfile", "StandardProfile", "PublicProfile"];

/// `Ok(())` when our rule is active and blocks `user_sid`, every profile is on and the firewall
/// service runs. Reads the registry: `Get-NetFirewallRule` is "Access is denied" for a normal
/// user (found on a real machine), and the registry is also ~100× faster than the cmdlets.
pub fn check(user_sid: &str) -> std::result::Result<(), String> {
    let rule = find_rule().map_err(|e| format!("cannot read firewall rules: {e:#}"))?;
    let Some(rule) = rule else {
        return Err("firewall rule is missing (run sandbox setup again)".into());
    };
    rule_ok(&rule, user_sid)?;
    for p in PROFILES {
        if !profile_enabled(p) {
            return Err(format!("Windows Firewall is off ({p})"));
        }
    }
    if !service_running() {
        return Err("Windows Firewall service (mpssvc) is not running".into());
    }
    Ok(())
}

/// Checks one rule string from the registry (`v2.30|Action=Block|Active=TRUE|Dir=Out|…`).
pub(crate) fn rule_ok(rule: &str, user_sid: &str) -> std::result::Result<(), String> {
    let fields: Vec<(&str, &str)> = rule.split('|').filter_map(|f| f.split_once('=')).collect();
    let has = |k: &str, v: &str| fields.iter().any(|(fk, fv)| fk.eq_ignore_ascii_case(k) && fv.eq_ignore_ascii_case(v));
    if !has("Active", "TRUE") {
        return Err("firewall rule is disabled".into());
    }
    if !has("Action", "Block") || !has("Dir", "Out") {
        return Err("firewall rule was changed (not an outbound block)".into());
    }
    if !fields.iter().any(|(k, v)| k.eq_ignore_ascii_case("LUAuth") && v.contains(&format!(";{user_sid})"))) {
        return Err("firewall rule does not target the sandbox user (run sandbox setup again)".into());
    }
    for ra in ["0.0.0.0-126.255.255.255", "128.0.0.0-255.255.255.255"] {
        if !has("RA4", ra) {
            return Err("firewall rule address ranges were changed".into());
        }
    }
    Ok(())
}

fn find_rule() -> Result<Option<String>> {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::ERROR_NO_MORE_ITEMS;
    use windows::Win32::System::Registry::{RegCloseKey, RegEnumValueW, RegOpenKeyExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ};
    let path = super::sid::wide(&format!(r"{POLICY}\FirewallRules"));
    let needle = format!("|Name={RULE_NAME}|");
    unsafe {
        let mut key = HKEY::default();
        RegOpenKeyExW(HKEY_LOCAL_MACHINE, windows::core::PCWSTR(path.as_ptr()), 0, KEY_READ, &mut key)
            .ok()
            .context("open FirewallRules")?;
        let mut found = None;
        let mut i = 0u32;
        loop {
            let mut name = vec![0u16; 512];
            let mut name_len = name.len() as u32;
            let mut data = vec![0u8; 16 * 1024];
            let mut data_len = data.len() as u32;
            let rc = RegEnumValueW(
                key,
                i,
                PWSTR(name.as_mut_ptr()),
                &mut name_len,
                None,
                None,
                Some(data.as_mut_ptr()),
                Some(&mut data_len),
            );
            if rc == ERROR_NO_MORE_ITEMS {
                break;
            }
            i += 1;
            if rc.is_err() {
                continue; // value larger than our buffer: not ours
            }
            let wide: Vec<u16> = data[..data_len as usize].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
            let s = String::from_utf16_lossy(&wide).trim_end_matches('\0').to_string();
            if s.contains(&needle) {
                found = Some(s);
                break;
            }
        }
        let _ = RegCloseKey(key);
        Ok(found)
    }
}

/// Group Policy wins over the local setting; a missing value means "on" (Windows default).
fn profile_enabled(profile: &str) -> bool {
    let gpo_name = match profile {
        "StandardProfile" => "PrivateProfile",
        p => p,
    };
    if let Some(v) = read_dword(&format!(r"{GPO_POLICY}\{gpo_name}"), "EnableFirewall") {
        return v != 0;
    }
    read_dword(&format!(r"{POLICY}\{profile}"), "EnableFirewall").map(|v| v != 0).unwrap_or(true)
}

fn read_dword(path: &str, value: &str) -> Option<u32> {
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD};
    let (p, v) = (super::sid::wide(path), super::sid::wide(value));
    let mut data = 0u32;
    let mut len = 4u32;
    let rc = unsafe {
        RegGetValueW(
            HKEY_LOCAL_MACHINE,
            windows::core::PCWSTR(p.as_ptr()),
            windows::core::PCWSTR(v.as_ptr()),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut data as *mut u32 as *mut _),
            Some(&mut len),
        )
    };
    rc.is_ok().then_some(data)
}

fn service_running() -> bool {
    use windows::Win32::System::Services::{
        CloseServiceHandle, OpenSCManagerW, OpenServiceW, QueryServiceStatus, SC_MANAGER_CONNECT, SERVICE_QUERY_STATUS,
        SERVICE_RUNNING, SERVICE_STATUS,
    };
    let name = super::sid::wide("mpssvc");
    unsafe {
        let Ok(scm) = OpenSCManagerW(windows::core::PCWSTR::null(), windows::core::PCWSTR::null(), SC_MANAGER_CONNECT) else {
            return false;
        };
        let ok = match OpenServiceW(scm, windows::core::PCWSTR(name.as_ptr()), SERVICE_QUERY_STATUS) {
            Ok(svc) => {
                let mut st = SERVICE_STATUS::default();
                let running = QueryServiceStatus(svc, &mut st).is_ok() && st.dwCurrentState == SERVICE_RUNNING;
                let _ = CloseServiceHandle(svc);
                running
            }
            Err(_) => false,
        };
        let _ = CloseServiceHandle(scm);
        ok
    }
}

#[cfg(test)]
mod tests {
    use super::rule_ok;

    const SID: &str = "S-1-5-21-1-2-3-1015";
    fn rule(extra: &str) -> String {
        format!("v2.30|Action=Block|Active=TRUE|Dir=Out|RA4=0.0.0.0-126.255.255.255|RA4=128.0.0.0-255.255.255.255|Name=5ilence sandbox: block outbound|LUAuth=D:(A;;CC;;;{SID})|{extra}")
    }

    #[test]
    fn accepts_the_rule_setup_writes() {
        assert_eq!(rule_ok(&rule(""), SID), Ok(()));
    }

    #[test]
    fn rejects_tampered_rules() {
        assert!(rule_ok(&rule("").replace("Active=TRUE", "Active=FALSE"), SID).is_err());
        assert!(rule_ok(&rule("").replace("Action=Block", "Action=Allow"), SID).is_err());
        assert!(rule_ok(&rule(""), "S-1-5-21-9-9-9-1001").is_err());
        assert!(rule_ok(&rule("").replace("|RA4=128.0.0.0-255.255.255.255", ""), SID).is_err());
    }
}
