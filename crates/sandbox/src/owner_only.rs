//! Security attributes that let only the current user (and SYSTEM) open an object.
//!
//! Used for the Engine's named pipe: the sandbox user (`silence-sbx`) runs as a different
//! account, so it cannot connect even before the RPC token check.

#[cfg(windows)]
mod imp {
    use anyhow::{Context, Result};
    use std::ffi::c_void;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::{CloseHandle, HANDLE, HLOCAL, LocalFree};
    use windows::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
    };
    use windows::Win32::Security::{
        GetTokenInformation, TokenUser, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    /// Owns the security descriptor; `as_ptr()` stays valid while this lives.
    pub struct OwnerOnly {
        sd: PSECURITY_DESCRIPTOR,
        sa: Box<SECURITY_ATTRIBUTES>,
    }

    unsafe impl Send for OwnerOnly {}
    unsafe impl Sync for OwnerOnly {}

    impl OwnerOnly {
        pub fn new() -> Result<Self> {
            let sddl = sddl_for(&current_user_sid()?);
            let w: Vec<u16> = sddl.encode_utf16().chain(Some(0)).collect();
            let mut sd = PSECURITY_DESCRIPTOR::default();
            unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(PCWSTR(w.as_ptr()), SDDL_REVISION_1, &mut sd, None)
                    .context("ConvertStringSecurityDescriptorToSecurityDescriptorW")?;
            }
            let sa = Box::new(SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: sd.0,
                bInheritHandle: false.into(),
            });
            Ok(Self { sd, sa })
        }

        /// `*mut SECURITY_ATTRIBUTES`, e.g. for tokio `create_with_security_attributes_raw`.
        pub fn as_ptr(&self) -> *mut c_void {
            &*self.sa as *const SECURITY_ATTRIBUTES as *mut c_void
        }
    }

    impl Drop for OwnerOnly {
        fn drop(&mut self) {
            unsafe {
                let _ = LocalFree(HLOCAL(self.sd.0));
            }
        }
    }

    /// Protected DACL (no inherited ACEs): full access for SYSTEM and this user only.
    pub(crate) fn sddl_for(user_sid: &str) -> String {
        format!("D:P(A;;GA;;;SY)(A;;GA;;;{user_sid})")
    }

    pub fn current_user_sid() -> Result<String> {
        unsafe {
            let mut token = HANDLE::default();
            OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).context("OpenProcessToken")?;
            let mut len = 0u32;
            let _ = GetTokenInformation(token, TokenUser, None, 0, &mut len);
            let mut buf = vec![0u8; len as usize];
            let res = GetTokenInformation(token, TokenUser, Some(buf.as_mut_ptr() as *mut c_void), len, &mut len);
            let _ = CloseHandle(token);
            res.context("GetTokenInformation(TokenUser)")?;
            let user = &*(buf.as_ptr() as *const TOKEN_USER);
            let mut s = PWSTR::null();
            ConvertSidToStringSidW(user.User.Sid, &mut s).context("ConvertSidToStringSidW")?;
            let out = s.to_string()?;
            let _ = LocalFree(HLOCAL(s.0 as *mut c_void));
            Ok(out)
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn builds_for_current_user() {
            let sid = current_user_sid().unwrap();
            assert!(sid.starts_with("S-1-5-"), "{sid}");
            assert_eq!(sddl_for(&sid), format!("D:P(A;;GA;;;SY)(A;;GA;;;{sid})"));
            let o = OwnerOnly::new().unwrap();
            assert!(!o.as_ptr().is_null());
        }
    }
}

#[cfg(windows)]
pub use imp::{current_user_sid, OwnerOnly};
