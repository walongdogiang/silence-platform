//! Phase 0 spike (throwaway): can 5ilence run shell commands as a Windows sandbox user with a
//! write-restricted token, ConPTY, and per-user firewall blocking? See
//! `crates/sandbox/spike/README.md`. Not used by the Engine.
//!
//!   spike sid                       print the 5ilence capability SID (for ACEs)
//!   spike run                       run the check matrix (needs SBX_USER, SBX_PASSWORD, SPIKE_ROOT)
//!   spike runner <conpty 0|1> <cmd> internal: runs as the sandbox user, restricts its own token,
//!                                   spawns <cmd> and relays its output

#[cfg(not(windows))]
fn main() {
    eprintln!("spike is Windows-only");
}

#[cfg(windows)]
fn main() {
    if let Err(e) = win::main() {
        eprintln!("spike error: {e:#}");
        std::process::exit(2);
    }
}

#[cfg(windows)]
mod win {
    use anyhow::{anyhow, bail, Context, Result};
    use std::ffi::c_void;
    use std::time::Instant;
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Foundation::*;
    use windows::Win32::Security::Authorization::{ConvertSidToStringSidW, ConvertStringSidToSidW};
    use windows::Win32::Security::*;
    use windows::Win32::Storage::FileSystem::{ReadFile, WriteFile};
    use windows::Win32::System::Console::*;
    use windows::Win32::System::Pipes::CreatePipe;
    use windows::Win32::System::Threading::*;

    const CAP_NAME: &str = "5ilenceSandboxWrite";
    /// Synthetic SID (same idea as Codex's): a made-up S-1-5-21 domain that no machine owns.
    const SYN_SID: &str = "S-1-5-21-3141592653-1589793238-2643383279-5110";

    /// Which SIDs go into the restricting list.
    #[derive(Clone, Copy, Debug)]
    enum Variant {
        /// Control: CreateRestrictedToken with nothing restricted (should behave like a normal token).
        None,
        Cap,
        Syn,
        SynLogon,
        /// syn + logon + RESTRICTED (S-1-5-12), and a default DACL that grants those SIDs, so the
        /// process can write its own objects (Chromium-style). Fixes 0xC0000142 at DLL init.
        Full,
        /// syn + logon + Everyone, LUA_TOKEN | DISABLE_MAX_PRIVILEGE, default DACL (Codex-style).
        Codex,
    }

    impl Variant {
        fn parse(s: &str) -> Result<Self> {
            Ok(match s {
                "none" => Variant::None,
                "cap" => Variant::Cap,
                "syn" => Variant::Syn,
                "syn+logon" => Variant::SynLogon,
                "full" => Variant::Full,
                "codex" => Variant::Codex,
                _ => bail!("unknown variant {s}"),
            })
        }
        fn name(self) -> &'static str {
            match self {
                Variant::None => "none",
                Variant::Cap => "cap",
                Variant::Syn => "syn",
                Variant::SynLogon => "syn+logon",
                Variant::Full => "full",
                Variant::Codex => "codex",
            }
        }
    }

    fn syn_sid() -> Result<PSID> {
        let mut sid = PSID::default();
        let s = wide(SYN_SID);
        unsafe { ConvertStringSidToSidW(PCWSTR(s.as_ptr()), &mut sid).context("ConvertStringSidToSidW")? };
        Ok(sid)
    }

    /// The logon-session SID of `token` (lets the child write its own window station/desktop).
    fn logon_sid(token: HANDLE) -> Result<PSID> {
        unsafe {
            let mut len = 0u32;
            let _ = GetTokenInformation(token, TokenGroups, None, 0, &mut len);
            let mut buf = vec![0u8; len as usize];
            GetTokenInformation(token, TokenGroups, Some(buf.as_mut_ptr() as *mut c_void), len, &mut len)
                .context("GetTokenInformation(TokenGroups)")?;
            let groups = &*(buf.as_ptr() as *const TOKEN_GROUPS);
            let list = std::slice::from_raw_parts(groups.Groups.as_ptr(), groups.GroupCount as usize);
            for g in list {
                // SE_GROUP_LOGON_ID (winnt.h); not exported under this name by windows 0.58.
                if g.Attributes & 0xC000_0000 == 0xC000_0000 {
                    // Copy out: `buf` dies at the end of this function.
                    let n = GetLengthSid(g.Sid);
                    let mut copy = vec![0u8; n as usize].into_boxed_slice();
                    CopySid(n, PSID(copy.as_mut_ptr() as *mut c_void), g.Sid).context("CopySid")?;
                    return Ok(PSID(Box::leak(copy).as_mut_ptr() as *mut c_void));
                }
            }
            bail!("no logon SID in token")
        }
    }

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn main() -> Result<()> {
        // No "Application Error" popups for children that fail to start (inherited error mode).
        unsafe {
            use windows::Win32::System::Diagnostics::Debug::{
                SetErrorMode, SEM_FAILCRITICALERRORS, SEM_NOGPFAULTERRORBOX,
            };
            SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
        }
        let args: Vec<String> = std::env::args().collect();
        match args.get(1).map(String::as_str) {
            Some("sid") => {
                // One SID per line; setup.ps1 grants each of them on ws/tmp.
                let (sid, _keep) = cap_sid()?;
                println!("{}", sid_string(sid)?);
                println!("{SYN_SID}");
                Ok(())
            }
            Some("runner") => {
                let v = Variant::parse(args.get(2).map(String::as_str).unwrap_or(""))?;
                let conpty = args.get(3).map(|s| s == "1").unwrap_or(false);
                let cmd = args.get(4).cloned().ok_or_else(|| anyhow!("runner: missing cmd"))?;
                let code = runner(&cmd, v, conpty)?;
                std::process::exit(code as i32);
            }
            Some("run") => run_matrix(),
            _ => bail!("usage: spike sid | run | runner <variant> <0|1> <cmd>"),
        }
    }

    /// Capability SID derived from a fixed name: no admin needed, same value on every machine.
    /// Returned buffers are leaked on purpose (spike).
    fn cap_sid() -> Result<(PSID, ())> {
        unsafe {
            let mut groups: *mut PSID = std::ptr::null_mut();
            let mut ngroups = 0u32;
            let mut caps: *mut PSID = std::ptr::null_mut();
            let mut ncaps = 0u32;
            let name = wide(CAP_NAME);
            DeriveCapabilitySidsFromName(
                PCWSTR(name.as_ptr()),
                &mut groups,
                &mut ngroups,
                &mut caps,
                &mut ncaps,
            )
            .context("DeriveCapabilitySidsFromName")?;
            if ncaps == 0 {
                bail!("no capability SID");
            }
            Ok((*caps, ()))
        }
    }

    fn sid_string(sid: PSID) -> Result<String> {
        unsafe {
            let mut out = PWSTR::null();
            ConvertSidToStringSidW(sid, &mut out).context("ConvertSidToStringSidW")?;
            Ok(out.to_string()?)
        }
    }

    /// Write-restricted copy of `token`: writes need the normal groups AND the 5ilence SID.
    fn restrict(token: HANDLE, v: Variant) -> Result<HANDLE> {
        let sids = match v {
            Variant::None => vec![],
            Variant::Cap => vec![cap_sid()?.0],
            Variant::Syn => vec![syn_sid()?],
            Variant::SynLogon => vec![syn_sid()?, logon_sid(token)?],
            Variant::Full => vec![syn_sid()?, logon_sid(token)?, str_sid("S-1-5-12")?],
            Variant::Codex => vec![syn_sid()?, logon_sid(token)?, str_sid("S-1-1-0")?],
        };
        let flags = match v {
            Variant::Codex => WRITE_RESTRICTED | LUA_TOKEN | DISABLE_MAX_PRIVILEGE,
            _ => WRITE_RESTRICTED,
        };
        let restricting: Vec<SID_AND_ATTRIBUTES> =
            sids.iter().map(|&sid| SID_AND_ATTRIBUTES { Sid: sid, Attributes: 0 }).collect();
        let mut out = HANDLE::default();
        unsafe {
            if restricting.is_empty() {
                CreateRestrictedToken(token, CREATE_RESTRICTED_TOKEN_FLAGS(0), None, None, None, &mut out)
            } else {
                CreateRestrictedToken(token, flags, None, None, Some(&restricting), &mut out)
            }
            .context("CreateRestrictedToken")?;
        }
        if matches!(v, Variant::Full | Variant::Codex) {
            let mut grant = sids.clone();
            grant.push(user_sid(token)?);
            grant.push(str_sid("S-1-5-18")?); // SYSTEM
            set_default_dacl(out, &grant)?;
        }
        Ok(out)
    }

    fn str_sid(s: &str) -> Result<PSID> {
        let mut sid = PSID::default();
        let w = wide(s);
        unsafe { ConvertStringSidToSidW(PCWSTR(w.as_ptr()), &mut sid).with_context(|| format!("SID {s}"))? };
        Ok(sid)
    }

    fn user_sid(token: HANDLE) -> Result<PSID> {
        unsafe {
            let mut len = 0u32;
            let _ = GetTokenInformation(token, TokenUser, None, 0, &mut len);
            let buf = Box::leak(vec![0u8; len as usize].into_boxed_slice());
            GetTokenInformation(token, TokenUser, Some(buf.as_mut_ptr() as *mut c_void), len, &mut len)
                .context("GetTokenInformation(TokenUser)")?;
            Ok((*(buf.as_ptr() as *const TOKEN_USER)).User.Sid)
        }
    }

    /// Default DACL for objects the sandboxed process creates: GENERIC_ALL to each SID.
    fn set_default_dacl(token: HANDLE, sids: &[PSID]) -> Result<()> {
        unsafe {
            let mut size = std::mem::size_of::<ACL>() as u32;
            for &s in sids {
                size += (std::mem::size_of::<ACCESS_ALLOWED_ACE>() as u32) + GetLengthSid(s) - 4;
            }
            let buf = Box::leak(vec![0u8; size as usize].into_boxed_slice());
            let acl = buf.as_mut_ptr() as *mut ACL;
            InitializeAcl(acl, size, ACL_REVISION).context("InitializeAcl")?;
            for &s in sids {
                AddAccessAllowedAce(acl, ACL_REVISION, 0x1000_0000 /* GENERIC_ALL */, s)
                    .context("AddAccessAllowedAce")?;
            }
            let dd = TOKEN_DEFAULT_DACL { DefaultDacl: acl };
            SetTokenInformation(
                token,
                TokenDefaultDacl,
                &dd as *const _ as *const c_void,
                std::mem::size_of::<TOKEN_DEFAULT_DACL>() as u32,
            )
            .context("SetTokenInformation(TokenDefaultDacl)")?;
        }
        Ok(())
    }

    fn pipe() -> Result<(HANDLE, HANDLE)> {
        let sa = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: std::ptr::null_mut(),
            bInheritHandle: TRUE,
        };
        let (mut r, mut w) = (HANDLE::default(), HANDLE::default());
        unsafe { CreatePipe(&mut r, &mut w, Some(&sa), 0).context("CreatePipe")? };
        Ok((r, w))
    }

    fn read_all(h: HANDLE) -> Vec<u8> {
        let mut out = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            let mut n = 0u32;
            let ok = unsafe { ReadFile(h, Some(&mut buf), Some(&mut n), None) };
            if ok.is_err() || n == 0 {
                break;
            }
            out.extend_from_slice(&buf[..n as usize]);
        }
        out
    }

    fn ps_cmdline(script: &str) -> String {
        let pre = "$ErrorActionPreference='Stop'; 'LANG='+$ExecutionContext.SessionState.LanguageMode; \
                   try{[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)}catch{}; ";
        format!(
            "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"{}\"",
            format!("{pre}{script}; '@@OK@@'").replace('"', "\\\"")
        )
    }

    fn strip_vt(s: &str) -> String {
        let mut out = String::with_capacity(s.len());
        let mut it = s.chars().peekable();
        while let Some(c) = it.next() {
            if c == '\u{1b}' {
                match it.next() {
                    Some('[') => {
                        while let Some(&n) = it.peek() {
                            it.next();
                            if n.is_ascii_alphabetic() {
                                break;
                            }
                        }
                    }
                    Some(']') => {
                        while let Some(n) = it.next() {
                            if n == '\u{7}' {
                                break;
                            }
                        }
                    }
                    _ => {}
                }
            } else {
                out.push(c);
            }
        }
        out
    }

    // ---------------------------------------------------------------- runner (sandbox user side)

    /// Runs as the sandbox user (started via CreateProcessWithLogonW). Restricting our OWN
    /// primary token makes it assignable without SeAssignPrimaryTokenPrivilege.
    fn runner(cmd: &str, v: Variant, conpty: bool) -> Result<u32> {
        let mut own = HANDLE::default();
        unsafe {
            OpenProcessToken(
                GetCurrentProcess(),
                TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT,
                &mut own,
            )
            .context("OpenProcessToken")?;
        }
        let token = restrict(own, v)?;
        // The child inherits our env. Point TEMP/TMP at the sandbox temp dir (has the 5ilence
        // ACE): PowerShell 5.1 drops to ConstrainedLanguage when it cannot write its policy-test
        // file into %TEMP%. Layout from setup.ps1: <root>\ws (cwd) and <root>\tmp.
        if let Some(root) = std::env::current_dir()?.parent() {
            let tmp = root.join("tmp");
            std::env::set_var("TEMP", &tmp);
            std::env::set_var("TMP", &tmp);
        }
        if conpty {
            spawn_conpty(token, cmd)
        } else {
            spawn_piped(token, cmd)
        }
    }

    fn spawn_piped(token: HANDLE, cmd: &str) -> Result<u32> {
        let (r, w) = pipe()?;
        unsafe { SetHandleInformation(r, 0, HANDLE_FLAGS(0))? };
        let si = STARTUPINFOW {
            cb: std::mem::size_of::<STARTUPINFOW>() as u32,
            dwFlags: STARTF_USESTDHANDLES,
            hStdOutput: w,
            hStdError: w,
            ..Default::default()
        };
        let mut pi = PROCESS_INFORMATION::default();
        let mut cl = wide(cmd);
        unsafe {
            CreateProcessAsUserW(
                token,
                PCWSTR::null(),
                PWSTR(cl.as_mut_ptr()),
                None,
                None,
                TRUE,
                CREATE_NO_WINDOW,
                None,
                PCWSTR::null(),
                &si,
                &mut pi,
            )
            .context("CreateProcessAsUserW(piped)")?;
            let _ = CloseHandle(w);
        }
        let out = read_all(r);
        relay(&out);
        wait_exit(pi)
    }

    fn spawn_conpty(token: HANDLE, cmd: &str) -> Result<u32> {
        let (in_r, in_w) = pipe()?;
        let (out_r, out_w) = pipe()?;
        unsafe {
            let hpc = CreatePseudoConsole(COORD { X: 120, Y: 30 }, in_r, out_w, 0)
                .context("CreatePseudoConsole")?;
            let mut size = 0usize;
            let _ = InitializeProcThreadAttributeList(LPPROC_THREAD_ATTRIBUTE_LIST::default(), 1, 0, &mut size);
            let mut buf = vec![0u8; size];
            let list = LPPROC_THREAD_ATTRIBUTE_LIST(buf.as_mut_ptr() as *mut c_void);
            InitializeProcThreadAttributeList(list, 1, 0, &mut size).context("InitAttrList")?;
            UpdateProcThreadAttribute(
                list,
                0,
                PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE as usize,
                Some(hpc.0 as *const c_void),
                std::mem::size_of::<HPCON>(),
                None,
                None,
            )
            .context("UpdateProcThreadAttribute")?;
            let mut si = STARTUPINFOEXW::default();
            si.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
            si.lpAttributeList = list;
            let mut pi = PROCESS_INFORMATION::default();
            let mut cl = wide(cmd);
            CreateProcessAsUserW(
                token,
                PCWSTR::null(),
                PWSTR(cl.as_mut_ptr()),
                None,
                None,
                FALSE,
                EXTENDED_STARTUPINFO_PRESENT,
                None,
                PCWSTR::null(),
                &si.StartupInfo,
                &mut pi,
            )
            .context("CreateProcessAsUserW(conpty)")?;
            let _ = CloseHandle(in_r);
            let _ = CloseHandle(out_w);
            let out_r_raw = out_r.0 as isize;
            let reader = std::thread::spawn(move || read_all(HANDLE(out_r_raw as *mut c_void)));
            let code = wait_exit(pi)?;
            ClosePseudoConsole(hpc);
            let _ = CloseHandle(in_w);
            let out = reader.join().unwrap_or_default();
            relay(&out);
            Ok(code)
        }
    }

    fn relay(bytes: &[u8]) {
        unsafe {
            if let Ok(h) = windows::Win32::System::Console::GetStdHandle(STD_OUTPUT_HANDLE) {
                let _ = WriteFile(h, Some(bytes), None, None);
            }
        }
    }

    fn wait_exit(pi: PROCESS_INFORMATION) -> Result<u32> {
        unsafe {
            WaitForSingleObject(pi.hProcess, 60_000);
            let mut code = 0u32;
            GetExitCodeProcess(pi.hProcess, &mut code)?;
            let _ = CloseHandle(pi.hProcess);
            let _ = CloseHandle(pi.hThread);
            Ok(code)
        }
    }

    // ---------------------------------------------------------------- matrix (Engine side)

    struct Env {
        user: String,
        password: String,
        root: String,
    }

    /// Path A: what the review proposed directly. Expected to fail with 1314 for a normal user.
    fn path_a(env: &Env, v: Variant, cmd: &str) -> Result<(u32, String)> {
        let mut tok = HANDLE::default();
        let (u, d, p) = (wide(&env.user), wide("."), wide(&env.password));
        unsafe {
            LogonUserW(
                PCWSTR(u.as_ptr()),
                PCWSTR(d.as_ptr()),
                PCWSTR(p.as_ptr()),
                LOGON32_LOGON_INTERACTIVE,
                LOGON32_PROVIDER_DEFAULT,
                &mut tok,
            )
            .context("LogonUserW")?;
        }
        let token = restrict(tok, v)?;
        let code = spawn_piped(token, cmd)?;
        Ok((code, String::new()))
    }

    /// Path B: CreateProcessWithLogonW (seclogon) starts `spike runner` as the sandbox user.
    fn path_b(env: &Env, v: Variant, conpty: bool, cmd: &str) -> Result<(u32, String)> {
        let exe = std::env::current_exe()?;
        let line = format!(
            "\"{}\" runner {} {} \"{}\"",
            exe.display(),
            v.name(),
            if conpty { 1 } else { 0 },
            cmd.replace('"', "\\\"")
        );
        let (r, w) = pipe()?;
        unsafe { SetHandleInformation(r, 0, HANDLE_FLAGS(0))? };
        let si = STARTUPINFOW {
            cb: std::mem::size_of::<STARTUPINFOW>() as u32,
            dwFlags: STARTF_USESTDHANDLES,
            hStdOutput: w,
            hStdError: w,
            ..Default::default()
        };
        let mut pi = PROCESS_INFORMATION::default();
        let (u, d, p) = (wide(&env.user), wide("."), wide(&env.password));
        let mut cl = wide(&line);
        let cwd = wide(&format!("{}\\ws", env.root));
        unsafe {
            CreateProcessWithLogonW(
                PCWSTR(u.as_ptr()),
                PCWSTR(d.as_ptr()),
                PCWSTR(p.as_ptr()),
                LOGON_WITH_PROFILE,
                PCWSTR::null(),
                PWSTR(cl.as_mut_ptr()),
                CREATE_NO_WINDOW,
                None,
                PCWSTR(cwd.as_ptr()),
                &si,
                &mut pi,
            )
            .context("CreateProcessWithLogonW")?;
            let _ = CloseHandle(w);
        }
        let out = read_all(r);
        let code = wait_exit(pi)?;
        Ok((code, String::from_utf8_lossy(&out).into_owned()))
    }

    fn run_matrix() -> Result<()> {
        let env = Env {
            user: std::env::var("SBX_USER").unwrap_or_else(|_| "silence-sbx".into()),
            password: std::env::var("SBX_PASSWORD").context("SBX_PASSWORD")?,
            root: std::env::var("SPIKE_ROOT").unwrap_or_else(|_| r"D:\5ilence-spike".into()),
        };
        let real_profile = std::env::var("USERPROFILE").unwrap_or_default();
        let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        listener.set_nonblocking(true)?;
        let ws = format!(r"{}\ws", env.root);
        let other = format!(r"{}\other", env.root);

        // (name, script, expect_ok). Success = the script reached its final `@@OK@@` marker
        // (ErrorActionPreference=Stop aborts before it), not just exit code 0.
        let checks: Vec<(&str, String, bool)> = vec![
            ("whoami + UTF-8", "whoami; 'xin chào tiếng Việt'".into(), true),
            ("write workspace", format!("Set-Content -LiteralPath '{ws}\\ok.txt' 'x'"), true),
            ("write TEMP", "Set-Content -LiteralPath (Join-Path $env:TEMP 't.txt') 'x'".into(), true),
            ("write other dir on same drive", format!("Set-Content -LiteralPath '{other}\\x.txt' 'x'"), false),
            ("write C:\\Users\\Public", "Set-Content -LiteralPath 'C:\\Users\\Public\\5ilence-spike.txt' 'x'".into(), false),
            ("read real user profile", format!("Get-ChildItem -LiteralPath '{real_profile}' -Force | Select-Object -First 1 | Out-Null"), false),
            ("internet (example.com)", "$null=(Invoke-WebRequest https://example.com -UseBasicParsing -TimeoutSec 8)".into(), false),
            ("loopback to Engine port", format!("$c=[Net.Sockets.TcpClient]::new(); $c.Connect('127.0.0.1',{port})"), true),
            ("git + node (system install)", "git --version; if(!$?){throw 'git'}; node --version; if(!$?){throw 'node'}".into(), true),
            ("cargo (in real user's profile)", "cargo --version; if(!$?){throw 'cargo'}".into(), false),
        ];

        // Already settled on this machine (see spike/README.md): cap is rejected by
        // CreateRestrictedToken; syn, syn+logon, full die at DLL init (0xC0000142). Only codex is
        // worth the full matrix; path A is kept to record the privilege error.
        let variants = [Variant::Codex];
        let whoami = ps_cmdline("whoami");

        println!("== path A: LogonUserW + CreateRestrictedToken + CreateProcessAsUserW (no runner)");
        for v in variants {
            let t = Instant::now();
            match path_a(&env, v, &whoami) {
                Ok((c, _)) => println!("   [{}] exit={c} ({} ms)", v.name(), t.elapsed().as_millis()),
                Err(e) => println!("   [{}] FAILED: {e:#}", v.name()),
            }
        }

        println!("\n== path B probe: which restricting-SID variant starts a process?");
        let mut working = Vec::new();
        for v in variants {
            let (line, ok) = check(&env, v, false, &whoami, true);
            println!("   [{}] {line}", v.name());
            if ok {
                working.push(v);
            }
        }
        if working.is_empty() {
            println!("\nNo variant could start a process; stopping here.");
            return Ok(());
        }

        for &v in &working {
            // Overhead without PowerShell startup: logon + runner + cmd.exe.
            let mut times = Vec::new();
            for _ in 0..3 {
                let t = Instant::now();
                let _ = path_b(&env, v, false, r"C:\Windows\System32\cmd.exe /c echo @@OK@@");
                times.push(t.elapsed().as_millis());
            }
            println!("\n== overhead (cmd /c echo, 3 runs): {times:?} ms");
            for conpty in [false, true] {
                println!("\n== path B: variant={} conpty={conpty}", v.name());
                for (name, script, expect_ok) in &checks {
                    let (line, _) = check(&env, v, conpty, &ps_cmdline(script), *expect_ok);
                    println!("   {name}: {line}");
                }
            }
        }
        Ok(())
    }

    /// One command through path B. An error from the spike itself (runner could not even start
    /// the command) is ERROR, never PASS: "blocked" must mean the command ran and was denied.
    fn check(env: &Env, v: Variant, conpty: bool, cmd: &str, expect_ok: bool) -> (String, bool) {
        let t = Instant::now();
        let res = path_b(env, v, conpty, cmd);
        let ms = t.elapsed().as_millis();
        match res {
            Ok((code, out)) => {
                // Strip ConPTY escape sequences, keep the LANG marker and the tail.
                let clean: String = strip_vt(&out).split_whitespace().collect::<Vec<_>>().join(" ");
                let lang = clean
                    .split("LANG=")
                    .nth(1)
                    .and_then(|s| s.split_whitespace().next())
                    .unwrap_or("?")
                    .to_string();
                let tail: String = {
                    let c: Vec<char> = clean.chars().collect();
                    c[c.len().saturating_sub(150)..].iter().collect()
                };
                let short = format!("lang={lang} | {tail}");
                if out.contains("spike error:") {
                    return (format!("[ERROR] exit={code} {ms}ms | {short}"), false);
                }
                let ok = code == 0 && clean.contains("@@OK@@");
                let verdict = if ok == expect_ok { "PASS" } else { "MISMATCH" };
                (format!("[{verdict}] exit={code} {ms}ms | {short}"), ok)
            }
            Err(e) => (format!("[ERROR] {ms}ms | {e:#}"), false),
        }
    }
}
