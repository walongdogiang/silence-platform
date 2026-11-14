//! Allowlist HTTP/HTTPS proxy on loopback: the sandbox's only way out.
//!
//! The firewall blocks every non-loopback connection of the sandbox user, so tools reach the
//! network only through this proxy (`HTTPS_PROXY=http://user:pass@127.0.0.1:port`). Every
//! request must carry the per-session `Proxy-Authorization` issued by [`Proxy::issue`]; the host
//! must match that session's allowlist and the port its allowed ports. HTTPS goes through
//! `CONNECT` as an opaque tunnel (no TLS interception). Each decision and each finished
//! connection is reported as a [`NetEvent`] for audit and for asking the user.
//!
//! An allowlisted host that accepts uploads (e.g. github.com) is still a way to send data out;
//! the defaults are package registries only.

use anyhow::{Context, Result};
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

/// Package registries and toolchain downloads. Hosts that accept uploads (github.com…) are
/// opt-in per workspace (`.silence/network.json`).
pub const DEFAULT_ALLOW: &[&str] = &[
    "registry.npmjs.org",
    "registry.yarnpkg.com",
    "crates.io",
    "index.crates.io",
    "static.crates.io",
    "static.rust-lang.org",
    "pypi.org",
    "files.pythonhosted.org",
    "api.nuget.org",
];
pub const DEFAULT_PORTS: &[u16] = &[443, 80];
const MAX_HEAD: usize = 16 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

/// What one credential may reach.
#[derive(Debug, Clone)]
pub struct Grant {
    /// Session (or tool call) id, carried into every [`NetEvent`].
    pub session: String,
    /// Host patterns: `example.com` (exact) or `*.example.com` (subdomains only).
    pub allow: Vec<String>,
    pub ports: Vec<u16>,
}

impl Grant {
    pub fn defaults(session: impl Into<String>) -> Self {
        Self {
            session: session.into(),
            allow: DEFAULT_ALLOW.iter().map(|s| s.to_string()).collect(),
            ports: DEFAULT_PORTS.to_vec(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProxyCred {
    pub user: String,
    pub pass: String,
    pub port: u16,
}

impl ProxyCred {
    pub fn url(&self) -> String {
        format!("http://{}:{}@127.0.0.1:{}", self.user, self.pass, self.port)
    }

    /// Env vars that point common tools (curl, git, npm, cargo, pip, node) at the proxy.
    /// PowerShell's Invoke-WebRequest ignores them (it uses WinINET) and so stays blocked.
    pub fn env(&self) -> Vec<(String, String)> {
        let url = self.url();
        let mut v: Vec<(String, String)> = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "npm_config_proxy", "npm_config_https_proxy"]
            .iter()
            .map(|k| (k.to_string(), url.clone()))
            .collect();
        v.push(("NO_PROXY".into(), "localhost,127.0.0.1,::1".into()));
        v.push(("no_proxy".into(), "localhost,127.0.0.1,::1".into()));
        v
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NetEvent {
    pub session: String,
    pub host: String,
    pub port: u16,
    pub allowed: bool,
    /// Why it was refused (`not_allowlisted`, `port`, `private_address`, `connect_failed`…).
    pub reason: Option<String>,
    pub bytes_up: u64,
    pub bytes_down: u64,
}

struct Inner {
    /// Expected `Proxy-Authorization` header value → grant.
    creds: Mutex<HashMap<String, Grant>>,
    events: mpsc::UnboundedSender<NetEvent>,
}

/// Running proxy. Dropping it does not stop the listener task; call [`Proxy::shutdown`].
pub struct Proxy {
    port: u16,
    inner: Arc<Inner>,
    task: tokio::task::JoinHandle<()>,
}

impl Proxy {
    /// Bind `127.0.0.1:0` and serve. Returns the proxy and the event stream.
    pub async fn start() -> Result<(Self, mpsc::UnboundedReceiver<NetEvent>)> {
        let listener = TcpListener::bind("127.0.0.1:0").await.context("bind proxy")?;
        let port = listener.local_addr()?.port();
        let (tx, rx) = mpsc::unbounded_channel();
        let inner = Arc::new(Inner { creds: Mutex::new(HashMap::new()), events: tx });
        let srv = inner.clone();
        let task = tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else { continue };
                let inner = srv.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle(inner, stream).await {
                        tracing::debug!("proxy conn: {e:#}");
                    }
                });
            }
        });
        Ok((Self { port, inner, task }, rx))
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// New random credential bound to `grant`.
    pub fn issue(&self, grant: Grant) -> ProxyCred {
        let user = format!("s{}", &uuid::Uuid::new_v4().simple().to_string()[..12]);
        let pass = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
        let header = format!("Basic {}", base64(format!("{user}:{pass}").as_bytes()));
        self.inner.creds.lock().unwrap().insert(header, grant);
        ProxyCred { user, pass, port: self.port }
    }

    pub fn revoke(&self, cred: &ProxyCred) {
        let header = format!("Basic {}", base64(format!("{}:{}", cred.user, cred.pass).as_bytes()));
        self.inner.creds.lock().unwrap().remove(&header);
    }

    pub fn shutdown(self) {
        self.task.abort();
    }
}

/// `example.com` matches only itself; `*.example.com` matches subdomains, not the apex.
pub fn host_allowed(host: &str, patterns: &[String]) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    patterns.iter().any(|p| {
        let p = p.trim().trim_end_matches('.').to_ascii_lowercase();
        match p.strip_prefix("*.") {
            Some(suffix) => host.len() > suffix.len() + 1 && host.ends_with(&format!(".{suffix}")),
            None => host == p,
        }
    })
}

/// Addresses the proxy never connects to for a hostname (DNS rebinding to local services).
fn private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => v.is_loopback() || v.is_private() || v.is_link_local() || v.is_unspecified() || v.is_broadcast(),
        IpAddr::V6(v) => {
            v.is_loopback() || v.is_unspecified() || (v.segments()[0] & 0xfe00) == 0xfc00 || (v.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

async fn handle(inner: Arc<Inner>, mut client: TcpStream) -> Result<()> {
    let (head, rest) = read_head(&mut client).await?;
    let text = String::from_utf8_lossy(&head).into_owned();
    let mut lines = text.split("\r\n");
    let request = lines.next().unwrap_or_default().to_string();
    let mut parts = request.split_whitespace();
    let (method, target, version) = (
        parts.next().unwrap_or_default().to_string(),
        parts.next().unwrap_or_default().to_string(),
        parts.next().unwrap_or("HTTP/1.1").to_string(),
    );
    let headers: Vec<(String, String)> = lines
        .filter(|l| !l.is_empty())
        .filter_map(|l| l.split_once(':').map(|(k, v)| (k.trim().to_string(), v.trim().to_string())))
        .collect();
    let auth = headers.iter().find(|(k, _)| k.eq_ignore_ascii_case("proxy-authorization")).map(|(_, v)| v.clone());
    let grant = auth.and_then(|a| inner.creds.lock().unwrap().get(&a).cloned());
    let Some(grant) = grant else {
        client
            .write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"5ilence-sandbox\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            .await?;
        return Ok(());
    };

    let connect = method.eq_ignore_ascii_case("CONNECT");
    let (host, port, path) = if connect {
        let (h, p) = split_host_port(&target, 443);
        (h, p, String::new())
    } else {
        match parse_http_url(&target) {
            Some(x) => x,
            None => {
                client.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await?;
                return Ok(());
            }
        }
    };

    let deny = |reason: &str| NetEvent {
        session: grant.session.clone(),
        host: host.clone(),
        port,
        allowed: false,
        reason: Some(reason.into()),
        bytes_up: 0,
        bytes_down: 0,
    };
    if !grant.ports.contains(&port) {
        let _ = inner.events.send(deny("port"));
        return refuse(&mut client, &format!("5ilence sandbox: port {port} is not allowed")).await;
    }
    if !host_allowed(&host, &grant.allow) {
        let _ = inner.events.send(deny("not_allowlisted"));
        return refuse(&mut client, &format!("5ilence sandbox: {host} is not in the network allowlist (NET_ACCESS)")).await;
    }
    let literal_ip = host.trim_matches(['[', ']']).parse::<IpAddr>().ok();
    let addrs: Vec<std::net::SocketAddr> = match tokio::net::lookup_host((host.as_str(), port)).await {
        Ok(a) => a.collect(),
        Err(_) => vec![],
    };
    // A hostname must not resolve to a local/private address; an allowlisted IP literal may.
    let addrs: Vec<_> = addrs.into_iter().filter(|a| literal_ip.is_some() || !private(a.ip())).collect();
    if addrs.is_empty() {
        let _ = inner.events.send(deny("private_address_or_unresolved"));
        return refuse(&mut client, &format!("5ilence sandbox: {host} has no allowed address")).await;
    }
    let upstream = match tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(&addrs[..])).await {
        Ok(Ok(s)) => s,
        _ => {
            let _ = inner.events.send(deny("connect_failed"));
            client.write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await?;
            return Ok(());
        }
    };
    let mut upstream = upstream;
    let mut client = client;
    if connect {
        client.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n").await?;
        upstream.write_all(&rest).await?;
    } else {
        // Origin-form request, without proxy headers; one request per connection.
        let mut out = format!("{method} {path} {version}\r\n");
        for (k, v) in &headers {
            let lk = k.to_ascii_lowercase();
            if lk.starts_with("proxy-") || lk == "connection" || lk == "keep-alive" {
                continue;
            }
            out.push_str(&format!("{k}: {v}\r\n"));
        }
        out.push_str("Connection: close\r\n\r\n");
        upstream.write_all(out.as_bytes()).await?;
        upstream.write_all(&rest).await?;
    }
    let (up, down) = pump(client, upstream).await;
    let _ = inner.events.send(NetEvent {
        session: grant.session.clone(),
        host,
        port,
        allowed: true,
        reason: None,
        bytes_up: up + rest.len() as u64,
        bytes_down: down,
    });
    Ok(())
}

/// Relay both directions until both end; returns (client→upstream, upstream→client) bytes.
/// Unlike `copy_bidirectional`, the counts survive an abrupt close (TLS peers often reset),
/// which matters because they go to the audit log.
async fn pump(client: TcpStream, upstream: TcpStream) -> (u64, u64) {
    let (mut cr, mut cw) = client.into_split();
    let (mut ur, mut uw) = upstream.into_split();
    async fn one(r: &mut tokio::net::tcp::OwnedReadHalf, w: &mut tokio::net::tcp::OwnedWriteHalf) -> u64 {
        let mut n = 0u64;
        let mut buf = vec![0u8; 16 * 1024];
        loop {
            match r.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(k) => {
                    if w.write_all(&buf[..k]).await.is_err() {
                        break;
                    }
                    n += k as u64;
                }
            }
        }
        let _ = w.shutdown().await;
        n
    }
    tokio::join!(one(&mut cr, &mut uw), one(&mut ur, &mut cw))
}

async fn refuse(client: &mut TcpStream, msg: &str) -> Result<()> {
    let body = format!("{msg}\n");
    client
        .write_all(
            format!(
                "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .as_bytes(),
        )
        .await?;
    Ok(())
}

/// Read until the end of the request head. Returns (head, bytes already read past it).
async fn read_head(s: &mut TcpStream) -> Result<(Vec<u8>, Vec<u8>)> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 2048];
    loop {
        let n = tokio::time::timeout(Duration::from_secs(30), s.read(&mut chunk)).await.context("head timeout")??;
        if n == 0 {
            anyhow::bail!("closed before request head");
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            let rest = buf.split_off(i + 4);
            return Ok((buf, rest));
        }
        if buf.len() > MAX_HEAD {
            anyhow::bail!("request head too large");
        }
    }
}

fn split_host_port(s: &str, default: u16) -> (String, u16) {
    if let Some(rest) = s.strip_prefix('[') {
        // [v6]:port
        if let Some((h, p)) = rest.split_once("]:") {
            return (h.to_string(), p.parse().unwrap_or(default));
        }
        return (rest.trim_end_matches(']').to_string(), default);
    }
    match s.rsplit_once(':') {
        Some((h, p)) if p.chars().all(|c| c.is_ascii_digit()) && !h.contains(':') => (h.to_string(), p.parse().unwrap_or(default)),
        _ => (s.to_string(), default),
    }
}

/// `http://host[:port]/path` → (host, port, /path). Only plain http (https uses CONNECT).
fn parse_http_url(u: &str) -> Option<(String, u16, String)> {
    let rest = u.strip_prefix("http://").or_else(|| u.strip_prefix("HTTP://"))?;
    let (authority, path) = match rest.find('/') {
        Some(i) => (&rest[..i], rest[i..].to_string()),
        None => (rest, "/".to_string()),
    };
    let authority = authority.rsplit_once('@').map(|(_, a)| a).unwrap_or(authority);
    let (h, p) = split_host_port(authority, 80);
    if h.is_empty() {
        return None;
    }
    Some((h, p, path))
}

fn base64(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for c in input.chunks(3) {
        let b = [c[0], *c.get(1).unwrap_or(&0), *c.get(2).unwrap_or(&0)];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Allowlist for a workspace: defaults plus `allow` from `<ws>/.silence/network.json`
/// (`{"allow": ["github.com", "*.example.com"]}`). Only the Engine writes that file; the
/// sandbox is denied `.silence/`.
pub fn workspace_allowlist(ws: &std::path::Path) -> Vec<String> {
    let mut allow: Vec<String> = DEFAULT_ALLOW.iter().map(|s| s.to_string()).collect();
    if let Ok(s) = std::fs::read_to_string(ws.join(".silence").join("network.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
            for h in v["allow"].as_array().into_iter().flatten().filter_map(|x| x.as_str()) {
                let h = h.trim().to_ascii_lowercase();
                if !h.is_empty() && !h.contains(['/', ' ']) && !allow.contains(&h) {
                    allow.push(h);
                }
            }
        }
    }
    allow
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_patterns() {
        let p: Vec<String> = vec!["crates.io".into(), "*.githubusercontent.com".into()];
        assert!(host_allowed("crates.io", &p));
        assert!(host_allowed("CRATES.IO.", &p));
        assert!(!host_allowed("evil-crates.io", &p));
        assert!(!host_allowed("crates.io.evil.com", &p));
        assert!(host_allowed("objects.githubusercontent.com", &p));
        assert!(!host_allowed("githubusercontent.com", &p));
    }

    #[test]
    fn parses_targets() {
        assert_eq!(split_host_port("registry.npmjs.org:443", 443), ("registry.npmjs.org".into(), 443));
        assert_eq!(split_host_port("[::1]:8080", 443), ("::1".into(), 8080));
        assert_eq!(parse_http_url("http://a.com:8080/x?y"), Some(("a.com".into(), 8080, "/x?y".into())));
        assert_eq!(parse_http_url("http://u:p@a.com"), Some(("a.com".into(), 80, "/".into())));
        assert_eq!(parse_http_url("https://a.com/"), None);
        assert_eq!(base64(b"user:pass"), "dXNlcjpwYXNz");
        assert_eq!(base64(b"ab"), "YWI=");
    }

    async fn send(port: u16, req: &str) -> (String, TcpStream) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
        s.write_all(req.as_bytes()).await.unwrap();
        let mut buf = vec![0u8; 512];
        let n = tokio::time::timeout(Duration::from_secs(5), s.read(&mut buf)).await.unwrap().unwrap();
        (String::from_utf8_lossy(&buf[..n]).into_owned(), s)
    }

    fn auth(c: &ProxyCred) -> String {
        format!("Basic {}", base64(format!("{}:{}", c.user, c.pass).as_bytes()))
    }

    #[tokio::test]
    async fn requires_credentials() {
        let (proxy, _rx) = Proxy::start().await.unwrap();
        let (r, _) = send(proxy.port(), "CONNECT crates.io:443 HTTP/1.1\r\nHost: crates.io:443\r\n\r\n").await;
        assert!(r.starts_with("HTTP/1.1 407"), "{r}");
        let (r, _) = send(proxy.port(), "CONNECT crates.io:443 HTTP/1.1\r\nProxy-Authorization: Basic Zm9vOmJhcg==\r\n\r\n").await;
        assert!(r.starts_with("HTTP/1.1 407"), "{r}");
        proxy.shutdown();
    }

    #[tokio::test]
    async fn refuses_hosts_outside_the_allowlist_and_reports_it() {
        let (proxy, mut rx) = Proxy::start().await.unwrap();
        let cred = proxy.issue(Grant::defaults("s1"));
        let (r, _) = send(proxy.port(), &format!("CONNECT example.com:443 HTTP/1.1\r\nProxy-Authorization: {}\r\n\r\n", auth(&cred))).await;
        assert!(r.starts_with("HTTP/1.1 403"), "{r}");
        assert!(r.contains("not in the network allowlist"));
        let ev = rx.recv().await.unwrap();
        assert_eq!((ev.session.as_str(), ev.host.as_str(), ev.allowed, ev.reason.as_deref()), ("s1", "example.com", false, Some("not_allowlisted")));
        // Port not allowed even for an allowlisted host.
        let (r, _) = send(proxy.port(), &format!("CONNECT crates.io:22 HTTP/1.1\r\nProxy-Authorization: {}\r\n\r\n", auth(&cred))).await;
        assert!(r.starts_with("HTTP/1.1 403"), "{r}");
        proxy.shutdown();
    }

    #[tokio::test]
    async fn hostname_resolving_to_loopback_is_refused() {
        let (proxy, _rx) = Proxy::start().await.unwrap();
        let cred = proxy.issue(Grant { session: "s".into(), allow: vec!["localhost".into()], ports: vec![443] });
        let (r, _) = send(proxy.port(), &format!("CONNECT localhost:443 HTTP/1.1\r\nProxy-Authorization: {}\r\n\r\n", auth(&cred))).await;
        assert!(r.starts_with("HTTP/1.1 403"), "{r}");
        proxy.shutdown();
    }

    #[tokio::test]
    async fn tunnels_to_an_allowlisted_ip_and_counts_bytes() {
        // Echo server standing in for a registry.
        let echo = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let echo_port = echo.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (mut s, _) = echo.accept().await.unwrap();
            let mut b = [0u8; 64];
            let n = s.read(&mut b).await.unwrap();
            s.write_all(&b[..n]).await.unwrap();
        });
        let (proxy, mut rx) = Proxy::start().await.unwrap();
        let cred = proxy.issue(Grant { session: "s2".into(), allow: vec!["127.0.0.1".into()], ports: vec![echo_port] });
        let (r, mut s) = send(proxy.port(), &format!("CONNECT 127.0.0.1:{echo_port} HTTP/1.1\r\nProxy-Authorization: {}\r\n\r\n", auth(&cred))).await;
        assert!(r.starts_with("HTTP/1.1 200"), "{r}");
        s.write_all(b"ping").await.unwrap();
        let mut b = [0u8; 4];
        s.read_exact(&mut b).await.unwrap();
        assert_eq!(&b, b"ping");
        drop(s);
        let ev = tokio::time::timeout(Duration::from_secs(5), rx.recv()).await.unwrap().unwrap();
        assert!(ev.allowed && ev.bytes_up >= 4 && ev.bytes_down >= 4, "{ev:?}");
        // Revoked credential stops working.
        proxy.revoke(&cred);
        let (r, _) = send(proxy.port(), &format!("CONNECT 127.0.0.1:{echo_port} HTTP/1.1\r\nProxy-Authorization: {}\r\n\r\n", auth(&cred))).await;
        assert!(r.starts_with("HTTP/1.1 407"), "{r}");
        proxy.shutdown();
    }

    #[test]
    fn workspace_allowlist_adds_entries_from_network_json() {
        let ws = tempfile::tempdir().unwrap();
        std::fs::create_dir(ws.path().join(".silence")).unwrap();
        std::fs::write(ws.path().join(".silence/network.json"), r#"{"allow":["GitHub.com","bad host/x"]}"#).unwrap();
        let a = workspace_allowlist(ws.path());
        assert!(a.contains(&"github.com".to_string()));
        assert!(a.contains(&"crates.io".to_string()));
        assert!(!a.iter().any(|h| h.contains(' ')));
    }
}
