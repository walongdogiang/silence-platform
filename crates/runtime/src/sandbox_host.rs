//! Engine side of the command sandbox: cached status, the one loopback proxy, per-call network
//! credentials and the net events the proxy reports. Design: `docs/security/permissions.md`
//! ("Sandbox Windows"); the OS pieces live in `silence-sandbox`.

use anyhow::{Context, Result};
use silence_sandbox::proxy::{workspace_allowlist, Grant, NetEvent, Proxy, ProxyCred, DEFAULT_PORTS};
use silence_sandbox::SandboxStatus;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, OnceCell};

/// `status()` costs about a second (registry reads), so it is cached.
const STATUS_TTL: Duration = Duration::from_secs(30);
/// Connections finish just before the command exits; their events arrive a moment later.
const EVENT_SETTLE: Duration = Duration::from_millis(120);

pub struct SandboxHost {
    engine_exe: PathBuf,
    status: Mutex<Option<(Instant, SandboxStatus)>>,
    /// Tests (and only tests) pin the status instead of asking the OS.
    pinned: Mutex<Option<SandboxStatus>>,
    proxy: OnceCell<Proxy>,
    events: std::sync::Arc<Mutex<HashMap<String, Vec<NetEvent>>>>,
    granted: Mutex<HashSet<PathBuf>>,
}

impl SandboxHost {
    pub fn new() -> Self {
        Self {
            // The runner is `silence-engine sandbox-runner`; tests run in another binary and
            // point at the real one with SILENCE_ENGINE_EXE.
            engine_exe: std::env::var_os("SILENCE_ENGINE_EXE")
                .map(PathBuf::from)
                .or_else(|| std::env::current_exe().ok())
                .unwrap_or_default(),
            status: Mutex::new(None),
            pinned: Mutex::new(None),
            proxy: OnceCell::new(),
            events: Default::default(),
            granted: Mutex::new(HashSet::new()),
        }
    }

    pub fn engine_exe(&self) -> &Path {
        &self.engine_exe
    }

    /// Cached for [`STATUS_TTL`]; the OS query runs off the async threads.
    pub async fn status(&self) -> SandboxStatus {
        if let Some(s) = self.pinned.lock().unwrap().clone() {
            return s;
        }
        if let Some((at, s)) = &*self.status.lock().unwrap() {
            if at.elapsed() < STATUS_TTL {
                return s.clone();
            }
        }
        let fresh = tokio::task::spawn_blocking(silence_sandbox::status)
            .await
            .unwrap_or_else(|e| SandboxStatus::Degraded(format!("status query failed: {e}")));
        *self.status.lock().unwrap() = Some((Instant::now(), fresh.clone()));
        fresh
    }

    pub async fn ready(&self) -> bool {
        self.status().await == SandboxStatus::Ready
    }

    /// Forget the cached status (after setup / uninstall).
    pub fn invalidate(&self) {
        *self.status.lock().unwrap() = None;
    }

    #[doc(hidden)]
    pub fn pin_status_for_tests(&self, s: Option<SandboxStatus>) {
        *self.pinned.lock().unwrap() = s;
    }

    /// Setup (one UAC prompt) or repair. Blocking OS work runs on a blocking thread.
    pub async fn setup(&self) -> Result<SandboxStatus> {
        let exe = self.engine_exe.clone();
        tokio::task::spawn_blocking(move || silence_sandbox::setup(&exe)).await??;
        self.invalidate();
        Ok(self.status().await)
    }

    /// Let the sandbox write in `ws` (once per workspace per Engine run; no admin needed).
    pub async fn ensure_granted(&self, ws: &Path) -> Result<()> {
        if self.granted.lock().unwrap().contains(ws) {
            return Ok(());
        }
        let p = ws.to_path_buf();
        tokio::task::spawn_blocking(move || silence_sandbox::grant_workspace(&p)).await??;
        self.granted.lock().unwrap().insert(ws.to_path_buf());
        Ok(())
    }

    async fn proxy(&self) -> Result<&Proxy> {
        self.proxy
            .get_or_try_init(|| async {
                let (proxy, rx) = Proxy::start().await.context("start sandbox proxy")?;
                tokio::spawn(collect_events(rx, self.events.clone()));
                Ok::<_, anyhow::Error>(proxy)
            })
            .await
    }

    /// Credential for one command: workspace allowlist plus `extra` hosts the user approved.
    /// `call` keys the events (`take_events`).
    pub async fn issue(&self, call: &str, ws: &Path, extra: &[String]) -> Result<ProxyCred> {
        let mut allow = workspace_allowlist(ws);
        for h in extra {
            if !allow.contains(h) {
                allow.push(h.clone());
            }
        }
        Ok(self.proxy().await?.issue(Grant { session: call.to_string(), allow, ports: DEFAULT_PORTS.to_vec() }))
    }

    pub async fn revoke(&self, cred: &ProxyCred) {
        if let Ok(p) = self.proxy().await {
            p.revoke(cred);
        }
    }

    /// Net events of one command, after giving the last connections a moment to report.
    pub async fn take_events(&self, call: &str) -> Vec<NetEvent> {
        tokio::time::sleep(EVENT_SETTLE).await;
        self.events.lock().unwrap().remove(call).unwrap_or_default()
    }
}

impl Default for SandboxHost {
    fn default() -> Self {
        Self::new()
    }
}

async fn collect_events(
    mut rx: mpsc::UnboundedReceiver<NetEvent>,
    sink: std::sync::Arc<Mutex<HashMap<String, Vec<NetEvent>>>>,
) {
    while let Some(ev) = rx.recv().await {
        let mut m = sink.lock().unwrap();
        // A call nobody collects (the Engine was busy) must not grow without bound.
        if m.len() > 256 {
            m.clear();
        }
        m.entry(ev.session.clone()).or_default().push(ev);
    }
}

/// Hosts the proxy refused only because they are not on the allowlist (the ones worth asking
/// about); port / private-address refusals are not fixed by allowlisting.
pub fn unlisted_denied(events: &[NetEvent]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for e in events {
        if !e.allowed && e.reason.as_deref() == Some("not_allowlisted") && !out.contains(&e.host) {
            out.push(e.host.clone());
        }
    }
    out
}

/// Workspace `.silence/network.json` access. Only the Engine writes it.
pub mod network {
    use anyhow::Result;
    use std::path::Path;

    fn path(ws: &Path) -> std::path::PathBuf {
        ws.join(".silence").join("network.json")
    }

    /// Hosts added for this workspace (not the built-in registries).
    pub fn list(ws: &Path) -> Vec<String> {
        let defaults: Vec<String> = silence_sandbox::proxy::DEFAULT_ALLOW.iter().map(|s| s.to_string()).collect();
        silence_sandbox::proxy::workspace_allowlist(ws).into_iter().filter(|h| !defaults.contains(h)).collect()
    }

    fn save(ws: &Path, hosts: &[String]) -> Result<()> {
        let p = path(ws);
        if let Some(dir) = p.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let body = serde_json::to_string_pretty(&serde_json::json!({ "allow": hosts }))?;
        std::fs::write(p, body + "\n")?;
        Ok(())
    }

    /// A host the user approved: a plain name or `*.suffix`, nothing that could widen the list.
    pub fn valid_host(h: &str) -> bool {
        let core = h.strip_prefix("*.").unwrap_or(h);
        !core.is_empty()
            && core.contains('.')
            && core.len() <= 253
            && core.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
            && !core.starts_with(['.', '-'])
            && !core.ends_with(['.', '-'])
    }

    pub fn add(ws: &Path, host: &str) -> Result<()> {
        let host = host.trim().to_ascii_lowercase();
        anyhow::ensure!(valid_host(&host), "not a host name: {host}");
        let mut hosts = list(ws);
        if !hosts.contains(&host) {
            hosts.push(host);
            save(ws, &hosts)?;
        }
        Ok(())
    }

    pub fn remove(ws: &Path, host: &str) -> Result<()> {
        let mut hosts = list(ws);
        hosts.retain(|h| h != host);
        save(ws, &hosts)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn add_list_remove_and_validate() {
            let d = tempfile::tempdir().unwrap();
            assert!(list(d.path()).is_empty());
            add(d.path(), "GitHub.com").unwrap();
            add(d.path(), "*.example.org").unwrap();
            add(d.path(), "github.com").unwrap();
            assert_eq!(list(d.path()), vec!["github.com".to_string(), "*.example.org".to_string()]);
            remove(d.path(), "github.com").unwrap();
            assert_eq!(list(d.path()), vec!["*.example.org".to_string()]);
            for bad in ["", "localhost", "a b.com", "evil.com/x", "*", ".com", "x.com:443", "-a.com"] {
                assert!(add(d.path(), bad).is_err(), "{bad}");
            }
        }
    }
}
