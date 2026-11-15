//! Headless browser the agent drives through CDP: open a local page, read it as text (with refs),
//! click / type / select by ref, and read console errors and failed requests.
//!
//! - Uses an installed Chromium browser (Edge ships with Windows; else Chrome / Chromium), never
//!   downloads one. `SILENCE_BROWSER` overrides the path.
//! - Fresh temporary profile per browser (no user cookies, no extensions), removed on drop.
//! - CDP listens on `127.0.0.1` with a random port (`--remote-debugging-port=0`). It has no auth,
//!   so another process of the same user could attach while it runs; the profile is empty and the
//!   browser lives only as long as the session (docs/security/permissions.md).
//! - On Windows the browser sits in a Job Object: dropping it kills the whole process tree.

pub mod cdp;
pub mod flow;

use anyhow::{anyhow, Context, Result};
use cdp::{Cdp, OnEvent};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const SNAPSHOT_JS: &str = include_str!("snapshot.js");
const LOCATE_JS: &str = include_str!("locate.js");
const DESCRIBE_JS: &str = include_str!("describe.js");
/// Chars of page text handed to the model at most.
const MAX_REPORT_CHARS: usize = 24_000;
/// Console entries / failed requests kept.
const MAX_LOG: usize = 500;

pub const NO_BROWSER: &str = "no Chromium-based browser found (Edge, Chrome or Chromium). Install one, or set SILENCE_BROWSER to its executable.";

/// Edge / Chrome / Chromium on this machine. `SILENCE_BROWSER` wins when it points to a file.
pub fn find_browser() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("SILENCE_BROWSER").map(PathBuf::from) {
        if p.is_file() {
            return Some(p);
        }
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        for var in ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"] {
            if let Some(base) = std::env::var_os(var).map(PathBuf::from) {
                candidates.push(base.join("Microsoft/Edge/Application/msedge.exe"));
                candidates.push(base.join("Google/Chrome/Application/chrome.exe"));
                candidates.push(base.join("Chromium/Application/chrome.exe"));
            }
        }
    } else if cfg!(target_os = "macos") {
        for app in [
            "Google Chrome.app/Contents/MacOS/Google Chrome",
            "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "Chromium.app/Contents/MacOS/Chromium",
        ] {
            candidates.push(Path::new("/Applications").join(app));
        }
    } else {
        let path = std::env::var_os("PATH").unwrap_or_default();
        for dir in std::env::split_paths(&path) {
            for name in ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable"] {
                candidates.push(dir.join(name));
            }
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

#[derive(Debug, Clone)]
struct ConsoleEntry {
    seq: u64,
    level: String,
    text: String,
    at: String,
}

#[derive(Debug, Clone)]
struct NetFail {
    seq: u64,
    method: String,
    url: String,
    status: Option<u16>,
    error: Option<String>,
}

#[derive(Default)]
struct Logs {
    console: VecDeque<ConsoleEntry>,
    console_seq: u64,
    requests: HashMap<String, (String, String)>,
    failed: VecDeque<NetFail>,
    net_seq: u64,
}

fn push_capped<T>(q: &mut VecDeque<T>, item: T) {
    q.push_back(item);
    while q.len() > MAX_LOG {
        q.pop_front();
    }
}

fn frame_at(v: &Value) -> String {
    let url = v.get("url").and_then(Value::as_str).unwrap_or("");
    if url.is_empty() {
        return String::new();
    }
    let line = v.get("lineNumber").and_then(Value::as_u64).map(|n| n + 1).unwrap_or(0);
    let col = v.get("columnNumber").and_then(Value::as_u64).map(|n| n + 1).unwrap_or(0);
    format!("{url}:{line}:{col}")
}

fn remote_text(arg: &Value) -> String {
    match arg.get("value") {
        Some(Value::String(s)) => s.clone(),
        Some(v) if !v.is_null() => v.to_string(),
        _ => arg
            .get("description")
            .or_else(|| arg.get("unserializableValue"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
    }
}

impl Logs {
    fn on_event(&mut self, method: &str, p: &Value, clean: fn(&str) -> String) {
        match method {
            "Runtime.consoleAPICalled" => {
                let level = match p.get("type").and_then(Value::as_str).unwrap_or("log") {
                    "warning" => "warning",
                    "error" | "assert" => "error",
                    "debug" => "debug",
                    "info" => "info",
                    _ => "log",
                };
                let text: Vec<String> = p.get("args").and_then(Value::as_array).into_iter().flatten().map(remote_text).collect();
                let at = p.pointer("/stackTrace/callFrames/0").map(frame_at).unwrap_or_default();
                self.add_console(level, &clean(&text.join(" ")), at);
            }
            "Runtime.exceptionThrown" => {
                let d = p.get("exceptionDetails").cloned().unwrap_or(Value::Null);
                let text = d
                    .pointer("/exception/description")
                    .and_then(Value::as_str)
                    .or_else(|| d.get("text").and_then(Value::as_str))
                    .unwrap_or("Uncaught exception");
                let at = frame_at(&d);
                self.add_console("error", &clean(&format!("Uncaught {}", text.trim_start_matches("Uncaught "))), at);
            }
            "Log.entryAdded" => {
                let e = p.get("entry").cloned().unwrap_or(Value::Null);
                // "Failed to load resource" repeats what browser_network already lists.
                if e.get("source").and_then(Value::as_str) == Some("network") {
                    return;
                }
                let level = match e.get("level").and_then(Value::as_str).unwrap_or("info") {
                    "error" => "error",
                    "warning" => "warning",
                    "verbose" => "debug",
                    _ => "info",
                };
                let text = e.get("text").and_then(Value::as_str).unwrap_or("");
                let at = e.get("url").and_then(Value::as_str).unwrap_or("").to_string();
                self.add_console(level, &clean(text), at);
            }
            "Network.requestWillBeSent" => {
                let id = p.get("requestId").and_then(Value::as_str).unwrap_or("").to_string();
                let method = p.pointer("/request/method").and_then(Value::as_str).unwrap_or("GET").to_string();
                let url = p.pointer("/request/url").and_then(Value::as_str).unwrap_or("").to_string();
                if self.requests.len() > 4000 {
                    self.requests.clear();
                }
                self.requests.insert(id, (method, url));
            }
            "Network.responseReceived" => {
                let status = p.pointer("/response/status").and_then(Value::as_u64).unwrap_or(0) as u16;
                if status >= 400 {
                    let id = p.get("requestId").and_then(Value::as_str).unwrap_or("");
                    let url = p.pointer("/response/url").and_then(Value::as_str).unwrap_or("").to_string();
                    let method = self.requests.get(id).map(|r| r.0.clone()).unwrap_or_else(|| "GET".into());
                    self.add_fail(method, url, Some(status), None);
                }
            }
            "Network.loadingFailed" => {
                if p.get("canceled").and_then(Value::as_bool).unwrap_or(false) {
                    return;
                }
                let id = p.get("requestId").and_then(Value::as_str).unwrap_or("");
                let (method, url) = self.requests.get(id).cloned().unwrap_or_else(|| ("GET".into(), String::new()));
                let err = p.get("errorText").and_then(Value::as_str).unwrap_or("failed").to_string();
                self.add_fail(method, url, None, Some(err));
            }
            _ => {}
        }
    }

    fn add_console(&mut self, level: &str, text: &str, at: String) {
        self.console_seq += 1;
        let seq = self.console_seq;
        push_capped(&mut self.console, ConsoleEntry { seq, level: level.into(), text: clip(text, 2000), at });
    }

    fn add_fail(&mut self, method: String, url: String, status: Option<u16>, error: Option<String>) {
        // Browsers ask for /favicon.ico on their own; a missing one is noise, not a bug.
        if url.split(['?', '#']).next().unwrap_or("").ends_with("/favicon.ico") {
            return;
        }
        self.net_seq += 1;
        let seq = self.net_seq;
        push_capped(&mut self.failed, NetFail { seq, method, url: clip(&url, 300), status, error });
    }
}

fn clip(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        None => s.to_string(),
        Some((i, _)) => format!("{}…", &s[..i]),
    }
}

/// What a page action produced. `url` lets the caller decide on taint (left loopback?).
#[derive(Debug, Clone)]
pub struct Report {
    pub ok: bool,
    pub url: String,
    pub text: String,
}

/// A screenshot for the model (`data:` URL) and its size in CSS pixels.
#[derive(Debug, Clone)]
pub struct Shot {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
    pub bytes: usize,
}

/// What the Studio shows of the page: address, title, a small JPEG frame, error counts.
#[derive(Debug, Clone, Default)]
pub struct View {
    pub url: String,
    pub title: String,
    pub frame: Option<String>,
    pub errors: u64,
    pub failed: u64,
}

/// Screenshots larger than this (decoded bytes) are re-taken as JPEG; model APIs cap images ~5 MB.
const MAX_SHOT_BYTES: usize = 4 * 1024 * 1024;
/// CSS viewport of the agent's browser (a common laptop size).
pub const VIEWPORT: (u32, u32) = (1280, 800);
/// Full-page screenshots stop at this height (CSS px).
const MAX_SHOT_HEIGHT: f64 = 8000.0;

pub struct Browser {
    cdp: Cdp,
    logs: Arc<Mutex<Logs>>,
    /// Last snapshot lines (for diffs) and what was already reported.
    last: Mutex<Option<Vec<String>>>,
    seen_console: Mutex<u64>,
    seen_net: Mutex<u64>,
    /// Steps since the last `open`: what a test of this flow would do (`flow::render_test`).
    flow: Mutex<Vec<flow::Step>>,
    _child: tokio::process::Child,
    /// `Mutex` only to make `Browser` `Sync` (the guard is `Send`, not `Sync`); never locked.
    _job: Mutex<Option<silence_sandbox::JobGuard>>,
    profile: PathBuf,
}

impl Drop for Browser {
    fn drop(&mut self) {
        // The child is killed on drop (kill_on_drop + Job Object). The profile is still locked for a
        // moment, so remove it a little later, best effort.
        let dir = self.profile.clone();
        std::thread::spawn(move || {
            for _ in 0..10 {
                std::thread::sleep(Duration::from_millis(500));
                if std::fs::remove_dir_all(&dir).is_ok() || !dir.exists() {
                    break;
                }
            }
        });
    }
}

impl Browser {
    /// Start a headless browser on `about:blank`. `clean` redacts console text before it is kept.
    pub async fn launch(clean: fn(&str) -> String) -> Result<Self> {
        let exe = find_browser().ok_or_else(|| anyhow!(NO_BROWSER))?;
        sweep_stale_profiles();
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let profile = std::env::temp_dir().join(format!("silence-browser-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&profile).context("create browser profile")?;
        let mut cmd = tokio::process::Command::new(&exe);
        cmd.args([
            "--headless=new",
            "--remote-debugging-port=0",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
            "--disable-component-extensions-with-background-pages",
            "--disable-background-networking",
            "--disable-component-update",
            "--disable-default-apps",
            "--disable-sync",
            "--disable-features=Translate,MediaRouter,OptimizationHints,msEdgeSidebarV2,msUndersideButton",
            "--no-pings",
            "--mute-audio",
            "--password-store=basic",
            "--window-size=1280,900",
        ])
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg("about:blank")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
        let mut child = cmd.spawn().with_context(|| format!("start {}", exe.display()))?;
        let job = silence_sandbox::wrap_pid(child.id().unwrap_or(0)).ok();

        let port_file = profile.join("DevToolsActivePort");
        let deadline = Instant::now() + Duration::from_secs(20);
        let port: u16 = loop {
            if let Ok(text) = std::fs::read_to_string(&port_file) {
                if let Some(p) = text.lines().next().and_then(|l| l.trim().parse().ok()) {
                    break p;
                }
            }
            if let Ok(Some(status)) = child.try_wait() {
                return Err(anyhow!("browser exited at start ({status})"));
            }
            if Instant::now() > deadline {
                return Err(anyhow!("browser did not open its debugging port in 20s"));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        };

        let http = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(10)).build()?;
        let targets: Value = http.get(format!("http://127.0.0.1:{port}/json/list")).send().await?.json().await?;
        let ws = targets
            .as_array()
            .into_iter()
            .flatten()
            .filter(|t| t.get("type").and_then(Value::as_str) == Some("page"))
            .filter_map(|t| t.get("webSocketDebuggerUrl").and_then(Value::as_str))
            .find(|u| u.starts_with(&format!("ws://127.0.0.1:{port}/")))
            .ok_or_else(|| anyhow!("browser has no page to drive"))?
            .to_string();

        let logs: Arc<Mutex<Logs>> = Arc::default();
        let l = logs.clone();
        let on_event: OnEvent = Arc::new(move |method, params| l.lock().unwrap().on_event(method, params, clean));
        let cdp = Cdp::connect(&ws, on_event).await?;
        for domain in ["Page.enable", "Runtime.enable", "Network.enable", "Log.enable"] {
            cdp.call(domain, json!({})).await?;
        }
        // The agent edits files and reloads: always fetch them fresh, never a cached old script.
        cdp.call("Network.setCacheDisabled", json!({"cacheDisabled": true})).await?;
        // Same viewport on every machine (window chrome and scrollbars vary): stable layouts and shots.
        cdp.call(
            "Emulation.setDeviceMetricsOverride",
            json!({"width": VIEWPORT.0, "height": VIEWPORT.1, "deviceScaleFactor": 1, "mobile": false}),
        )
        .await?;
        Ok(Self {
            cdp,
            logs,
            last: Mutex::new(None),
            seen_console: Mutex::new(0),
            seen_net: Mutex::new(0),
            flow: Mutex::new(Vec::new()),
            _child: child,
            _job: Mutex::new(job),
            profile,
        })
    }

    pub async fn url(&self) -> String {
        self.cdp.eval("location.href").await.ok().and_then(|v| v.as_str().map(str::to_string)).unwrap_or_default()
    }

    /// Navigate and report the page. The caller checks the URL is allowed first.
    pub async fn open(&self, url: &str) -> Result<Report> {
        let r = self.cdp.call_timeout("Page.navigate", json!({"url": url}), Duration::from_secs(30)).await?;
        if let Some(err) = r.get("errorText").and_then(Value::as_str).filter(|e| !e.is_empty()) {
            let hint = if err.contains("CONNECTION_REFUSED") { " (is the server running? see proc_list / proc_logs)" } else { "" };
            return Ok(Report { ok: false, url: url.to_string(), text: format!("could not open {url}: {err}{hint}") });
        }
        *self.last.lock().unwrap() = None;
        self.settle(Duration::from_secs(15)).await;
        let r = self.report(true, None).await?;
        // A new open starts a new flow: the last one the agent checked is the one worth keeping.
        let mut steps = vec![flow::Step::Goto(r.url.clone())];
        if let Some(title) = r.text.lines().find_map(|l| l.strip_prefix("title: ")).filter(|t| !t.trim().is_empty()) {
            steps.push(flow::Step::Title(title.trim().to_string()));
        }
        *self.flow.lock().unwrap() = steps;
        Ok(r)
    }

    /// The flow since the last `open` (empty before any).
    pub fn flow(&self) -> Vec<flow::Step> {
        self.flow.lock().unwrap().clone()
    }

    /// Page text with refs. `full = false` returns only what changed since the last snapshot.
    pub async fn snapshot(&self, full: bool) -> Result<Report> {
        if full {
            *self.last.lock().unwrap() = None;
        }
        self.report(true, None).await
    }

    /// `click` | `fill` | `press` | `select` | `hover` on the element `r#ref`.
    /// `press` without a ref goes to whatever has focus.
    pub async fn act(&self, r#ref: &str, action: &str, value: &str) -> Result<Report> {
        let action = action.to_ascii_lowercase();
        if !matches!(action.as_str(), "click" | "fill" | "press" | "select" | "hover") {
            return Err(anyhow!("unknown action `{action}`: use click, fill, press, select or hover"));
        }
        let target = if r#ref.is_empty() {
            if action != "press" {
                return Err(anyhow!("`ref` is required for {action}"));
            }
            None
        } else {
            let loc = self.cdp.eval(&format!("({LOCATE_JS})({})", json!(r#ref))).await?;
            if let Some(err) = loc.get("error").and_then(Value::as_str) {
                return Ok(Report { ok: false, url: self.url().await, text: err.to_string() });
            }
            if loc.get("disabled").and_then(Value::as_bool).unwrap_or(false) && action != "hover" {
                return Ok(Report { ok: false, url: self.url().await, text: format!("{} is disabled", r#ref) });
            }
            Some(loc)
        };
        let described: Option<flow::Target> = if r#ref.is_empty() {
            None
        } else {
            self.cdp
                .eval(&format!("({DESCRIBE_JS})({})", json!(r#ref)))
                .await
                .ok()
                .and_then(|v| serde_json::from_value(v).ok())
        };
        let point = |loc: &Value| (loc["x"].as_f64().unwrap_or(0.0), loc["y"].as_f64().unwrap_or(0.0));
        let what = match (action.as_str(), &target) {
            ("click", Some(loc)) => {
                if let Some(by) = loc.get("covered").and_then(Value::as_str) {
                    return Ok(Report {
                        ok: false,
                        url: self.url().await,
                        text: format!("{} is covered by `{by}` (a dialog or overlay?); deal with that first", r#ref),
                    });
                }
                self.click(point(loc)).await?;
                format!("clicked {}", r#ref)
            }
            ("hover", Some(loc)) => {
                let (x, y) = point(loc);
                self.mouse("mouseMoved", x, y).await?;
                format!("hovered {}", r#ref)
            }
            ("select", Some(_)) | ("fill", Some(_)) if target.as_ref().and_then(|l| l.get("kind")).and_then(Value::as_str) == Some("select") => {
                let picked = self.cdp.eval(&format!("({SELECT_JS})({}, {})", json!(r#ref), json!(value))).await?;
                match picked.as_str() {
                    Some(text) => format!("selected {text:?} in {}", r#ref),
                    None => return Ok(Report { ok: false, url: self.url().await, text: format!("no option {value:?} in {}", r#ref) }),
                }
            }
            ("select", Some(_)) => return Err(anyhow!("{} is not a <select>; use click on the option instead", r#ref)),
            ("fill", Some(_)) => {
                self.cdp.eval(&format!("({FOCUS_SELECT_JS})({})", json!(r#ref))).await?;
                if value.is_empty() {
                    self.key("Backspace").await?;
                } else {
                    self.cdp.call("Input.insertText", json!({"text": value})).await?;
                }
                format!("filled {} with {:?}", r#ref, clip(value, 60))
            }
            ("press", _) => {
                if !r#ref.is_empty() {
                    self.cdp.eval(&format!("({FOCUS_JS})({})", json!(r#ref))).await?;
                }
                self.key(value).await?;
                format!("pressed {value}")
            }
            _ => unreachable!(),
        };
        self.settle(Duration::from_secs(8)).await;
        let r = self.report(true, Some(what)).await?;
        let step = match (action.as_str(), described) {
            ("click", Some(t)) => Some(flow::Step::Click(t)),
            ("hover", Some(t)) => Some(flow::Step::Hover(t)),
            ("fill", Some(t)) if t.tag == "select" => Some(flow::Step::Select(t, value.to_string())),
            ("fill", Some(t)) => Some(flow::Step::Fill(t, value.to_string())),
            ("select", Some(t)) => Some(flow::Step::Select(t, value.to_string())),
            ("press", t) => Some(flow::Step::Press(t, key_name(value))),
            _ => None,
        };
        if let Some(step) = step {
            let mut f = self.flow.lock().unwrap();
            f.push(step);
            f.extend(flow::expectations(&r.text));
        }
        Ok(r)
    }

    /// PNG of the viewport, the whole page (`full_page`), or one element (`ref`, with a small
    /// margin). Falls back to JPEG, then half scale, when the PNG is too big for a model.
    pub async fn screenshot(&self, r#ref: &str, full_page: bool) -> Result<Shot> {
        let rect = if !r#ref.is_empty() {
            let r = self.cdp.eval(&format!("({SHOT_RECT_JS})({})", json!(r#ref))).await?;
            if let Some(err) = r.get("error").and_then(Value::as_str) {
                return Err(anyhow!("{err}"));
            }
            r
        } else if full_page {
            self.cdp
                .eval("({x: 0, y: 0, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight})")
                .await?
        } else {
            self.cdp.eval("({x: scrollX, y: scrollY, width: innerWidth, height: innerHeight})").await?
        };
        let num = |k: &str| rect.get(k).and_then(Value::as_f64).unwrap_or(0.0);
        let (x, y, w, h) = (num("x").max(0.0), num("y").max(0.0), num("width").max(1.0), num("height").clamp(1.0, MAX_SHOT_HEIGHT));
        let attempts = [("png", 100, 1.0), ("jpeg", 70, 1.0), ("jpeg", 60, 0.5)];
        let mut last = 0;
        for (format, quality, scale) in attempts {
            let mut params = json!({
                "format": format,
                "clip": {"x": x, "y": y, "width": w, "height": h, "scale": scale},
                "captureBeyondViewport": full_page || !r#ref.is_empty(),
            });
            if format == "jpeg" {
                params["quality"] = json!(quality);
            }
            let r = self.cdp.call_timeout("Page.captureScreenshot", params, Duration::from_secs(30)).await?;
            let data = r.get("data").and_then(Value::as_str).unwrap_or("");
            let bytes = data.len() / 4 * 3;
            last = bytes;
            if bytes <= MAX_SHOT_BYTES {
                return Ok(Shot {
                    data_url: format!("data:image/{format};base64,{data}"),
                    width: (w * scale) as u32,
                    height: (h * scale) as u32,
                    bytes,
                });
            }
        }
        Err(anyhow!("screenshot too large ({} KB) even as half-scale JPEG; use a ref to shoot one part", last / 1024))
    }

    /// Small frame for the Studio's Browser tab (JPEG, viewport). Never fails: missing parts stay empty.
    pub async fn view(&self) -> View {
        let meta = self.cdp.eval("({url: location.href, title: document.title})").await.unwrap_or(Value::Null);
        let frame = self
            .cdp
            .call("Page.captureScreenshot", json!({"format": "jpeg", "quality": 45, "optimizeForSpeed": true}))
            .await
            .ok()
            .and_then(|r| r.get("data").and_then(Value::as_str).map(|d| format!("data:image/jpeg;base64,{d}")));
        let (errors, failed) = {
            let logs = self.logs.lock().unwrap();
            (logs.console.iter().filter(|e| e.level == "error").count() as u64, logs.failed.len() as u64)
        };
        View {
            url: meta.get("url").and_then(Value::as_str).unwrap_or("").to_string(),
            title: meta.get("title").and_then(Value::as_str).unwrap_or("").to_string(),
            frame,
            errors,
            failed,
        }
    }

    /// Console entries after `since` at `level` (`error`, `warning` = warnings and errors, `all`).
    pub fn console(&self, since: u64, level: &str) -> String {
        let logs = self.logs.lock().unwrap();
        let keep = |l: &str| match level {
            "all" => true,
            "warning" => l == "error" || l == "warning",
            _ => l == "error",
        };
        let rows: Vec<String> = logs
            .console
            .iter()
            .filter(|e| e.seq > since && keep(&e.level))
            .map(|e| {
                // Exceptions carry their stack in the text already.
                let at = if e.at.is_empty() || e.text.contains(&e.at) { String::new() } else { format!("\n    at {}", e.at) };
                format!("#{} {}: {}{at}", e.seq, e.level, e.text)
            })
            .collect();
        *self.seen_console.lock().unwrap() = logs.console_seq;
        if rows.is_empty() {
            format!("no console {} after #{since} (latest #{})", if level == "all" { "messages" } else { level }, logs.console_seq)
        } else {
            rows.join("\n")
        }
    }

    /// Failed requests (HTTP ≥ 400 or network error) after `since`.
    pub fn network(&self, since: u64) -> String {
        let logs = self.logs.lock().unwrap();
        let rows: Vec<String> = logs
            .failed
            .iter()
            .filter(|f| f.seq > since)
            .map(|f| {
                let what = match (f.status, &f.error) {
                    (Some(s), _) => s.to_string(),
                    (None, Some(e)) => e.clone(),
                    _ => "failed".into(),
                };
                format!("#{} {} {} → {what}", f.seq, f.method, f.url)
            })
            .collect();
        *self.seen_net.lock().unwrap() = logs.net_seq;
        if rows.is_empty() {
            format!("no failed requests after #{since}")
        } else {
            rows.join("\n")
        }
    }

    async fn click(&self, (x, y): (f64, f64)) -> Result<()> {
        self.mouse("mouseMoved", x, y).await?;
        for kind in ["mousePressed", "mouseReleased"] {
            self.cdp
                .call("Input.dispatchMouseEvent", json!({"type": kind, "x": x, "y": y, "button": "left", "clickCount": 1}))
                .await?;
        }
        Ok(())
    }

    async fn mouse(&self, kind: &str, x: f64, y: f64) -> Result<()> {
        self.cdp.call("Input.dispatchMouseEvent", json!({"type": kind, "x": x, "y": y})).await.map(|_| ())
    }

    async fn key(&self, key: &str) -> Result<()> {
        let (code, vk, text) = key_info(key).ok_or_else(|| anyhow!("unknown key `{key}`"))?;
        let mut down = json!({"type": if text.is_empty() { "rawKeyDown" } else { "keyDown" }, "key": key_name(key), "code": code, "windowsVirtualKeyCode": vk});
        if !text.is_empty() {
            down["text"] = json!(text);
        }
        self.cdp.call("Input.dispatchKeyEvent", down).await?;
        self.cdp
            .call("Input.dispatchKeyEvent", json!({"type": "keyUp", "key": key_name(key), "code": code, "windowsVirtualKeyCode": vk}))
            .await?;
        Ok(())
    }

    /// Give the page time to react: a short pause, then wait for `document.readyState == complete`.
    async fn settle(&self, max: Duration) {
        tokio::time::sleep(Duration::from_millis(250)).await;
        let deadline = Instant::now() + max;
        while Instant::now() < deadline {
            match self.cdp.eval("document.readyState").await {
                Ok(v) if v.as_str() == Some("complete") => break,
                _ => tokio::time::sleep(Duration::from_millis(100)).await,
            }
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }

    async fn report(&self, ok: bool, did: Option<String>) -> Result<Report> {
        let snap = self.cdp.eval(SNAPSHOT_JS).await?;
        let url = snap.get("url").and_then(Value::as_str).unwrap_or("").to_string();
        let title = snap.get("title").and_then(Value::as_str).unwrap_or("");
        let lines: Vec<String> = snap
            .get("lines")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|l| l.as_str().map(str::to_string))
            .collect();
        let truncated = snap.get("truncated").and_then(Value::as_bool).unwrap_or(false);
        let prev = self.last.lock().unwrap().replace(lines.clone());

        let mut out = String::new();
        if let Some(d) = did {
            out.push_str(&format!("{d}\n"));
        }
        out.push_str(&format!("url: {url}\ntitle: {title}\n"));
        let (errors, fails, cseq, nseq) = {
            let logs = self.logs.lock().unwrap();
            let seen_c = *self.seen_console.lock().unwrap();
            let seen_n = *self.seen_net.lock().unwrap();
            let errors = logs.console.iter().filter(|e| e.seq > seen_c && e.level == "error").count();
            let fails = logs.failed.iter().filter(|f| f.seq > seen_n).count();
            (errors, fails, seen_c, seen_n)
        };
        if errors > 0 {
            out.push_str(&format!("console: {errors} new error(s) — browser_console since={cseq}\n"));
        }
        if fails > 0 {
            out.push_str(&format!("network: {fails} new failed request(s) — browser_network since={nseq}\n"));
        }
        match prev.as_deref().and_then(|p| diff_lines(p, &lines)) {
            Some(d) if d.is_empty() => out.push_str("--- no visible change ---\n"),
            Some(d) => {
                out.push_str("--- changes since last snapshot (- removed, + added) ---\n");
                out.push_str(&d);
            }
            None => {
                out.push_str("--- page (use [ref=…] with browser_act) ---\n");
                if lines.is_empty() {
                    out.push_str("(empty page)\n");
                }
                for l in &lines {
                    out.push_str(l);
                    out.push('\n');
                }
                if truncated {
                    out.push_str("…[page cut at 400 lines]\n");
                }
            }
        }
        let text = if out.chars().count() > MAX_REPORT_CHARS { format!("{}\n…[cut]", clip(&out, MAX_REPORT_CHARS)) } else { out };
        Ok(Report { ok, url, text })
    }
}

/// Profiles left behind when a process ended before `Drop` could remove them (Engine killed,
/// test binary exit). Anything not touched for 30 minutes is no longer in use.
fn sweep_stale_profiles() {
    let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else { return };
    for e in entries.flatten() {
        let name = e.file_name();
        if !name.to_string_lossy().starts_with("silence-browser-") {
            continue;
        }
        let old = e
            .metadata()
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > Duration::from_secs(30 * 60));
        if old {
            let _ = std::fs::remove_dir_all(e.path());
        }
    }
}

/// Line diff of two snapshots, or `None` when most of the page changed (show it whole).
pub fn diff_lines(old: &[String], new: &[String]) -> Option<String> {
    let (n, m) = (old.len(), new.len());
    if n == 0 || n * m > 400 * 400 {
        return None;
    }
    // LCS table.
    let mut t = vec![vec![0u16; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            t[i][j] = if old[i] == new[j] { t[i + 1][j + 1] + 1 } else { t[i + 1][j].max(t[i][j + 1]) };
        }
    }
    let (mut i, mut j) = (0, 0);
    let mut out = Vec::new();
    while i < n || j < m {
        if i < n && j < m && old[i] == new[j] {
            i += 1;
            j += 1;
        } else if i < n && (j == m || t[i + 1][j] >= t[i][j + 1]) {
            out.push(format!("- {}", old[i].trim_start_matches("- ")));
            i += 1;
        } else {
            out.push(format!("+ {}", new[j].trim_start_matches("- ")));
            j += 1;
        }
    }
    let common = t[0][0] as usize;
    // Most of a larger page changed (navigation, new view): the whole page reads better.
    if out.len() > 60 || (m > 8 && common * 2 < m) {
        return None;
    }
    Some(out.iter().map(|l| format!("{l}\n")).collect())
}

/// (code, windows virtual key, text) for the keys an agent needs.
fn key_info(key: &str) -> Option<(String, u32, String)> {
    let k = key_name(key);
    let named = match k.as_str() {
        "Enter" => Some(("Enter", 13, "\r")),
        "Tab" => Some(("Tab", 9, "")),
        "Escape" => Some(("Escape", 27, "")),
        "Backspace" => Some(("Backspace", 8, "")),
        "Delete" => Some(("Delete", 46, "")),
        " " => Some(("Space", 32, " ")),
        "ArrowUp" => Some(("ArrowUp", 38, "")),
        "ArrowDown" => Some(("ArrowDown", 40, "")),
        "ArrowLeft" => Some(("ArrowLeft", 37, "")),
        "ArrowRight" => Some(("ArrowRight", 39, "")),
        "Home" => Some(("Home", 36, "")),
        "End" => Some(("End", 35, "")),
        "PageUp" => Some(("PageUp", 33, "")),
        "PageDown" => Some(("PageDown", 34, "")),
        _ => None,
    };
    if let Some((code, vk, text)) = named {
        return Some((code.into(), vk, text.into()));
    }
    let mut chars = k.chars();
    match (chars.next(), chars.next()) {
        (Some(c), None) if c.is_ascii_alphanumeric() => {
            let up = c.to_ascii_uppercase();
            let code = if c.is_ascii_digit() { format!("Digit{c}") } else { format!("Key{up}") };
            Some((code, up as u32, c.to_string()))
        }
        _ => None,
    }
}

fn key_name(key: &str) -> String {
    match key.trim().to_ascii_lowercase().as_str() {
        "enter" | "return" => "Enter".into(),
        "tab" => "Tab".into(),
        "escape" | "esc" => "Escape".into(),
        "backspace" => "Backspace".into(),
        "delete" | "del" => "Delete".into(),
        "space" | " " => " ".into(),
        "arrowup" | "up" => "ArrowUp".into(),
        "arrowdown" | "down" => "ArrowDown".into(),
        "arrowleft" | "left" => "ArrowLeft".into(),
        "arrowright" | "right" => "ArrowRight".into(),
        "home" => "Home".into(),
        "end" => "End".into(),
        "pageup" => "PageUp".into(),
        "pagedown" => "PageDown".into(),
        _ => key.to_string(),
    }
}

const SHOT_RECT_JS: &str = r#"(ref) => {
  const el = document.querySelector(`[data-silence-ref="${CSS.escape(ref)}"]`);
  if (!el) return { error: `no element with ref ${ref} on this page (take a new browser_snapshot)` };
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  const pad = 8;
  return { x: r.left + scrollX - pad, y: r.top + scrollY - pad, width: r.width + 2 * pad, height: r.height + 2 * pad };
}"#;
const FOCUS_JS: &str = r#"(ref) => { const el = document.querySelector(`[data-silence-ref="${CSS.escape(ref)}"]`); if (el) el.focus(); return !!el; }"#;
const FOCUS_SELECT_JS: &str = r#"(ref) => {
  const el = document.querySelector(`[data-silence-ref="${CSS.escape(ref)}"]`);
  if (!el) return false;
  el.focus();
  if (typeof el.select === "function") el.select();
  else { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  return true;
}"#;
const SELECT_JS: &str = r#"(ref, want) => {
  const el = document.querySelector(`[data-silence-ref="${CSS.escape(ref)}"]`);
  if (!el || el.tagName !== "SELECT") return null;
  const w = String(want).trim().toLowerCase();
  const opt = Array.from(el.options).find((o) => o.value.toLowerCase() === w || o.text.trim().toLowerCase() === w);
  if (!opt) return null;
  el.focus();
  el.value = opt.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return opt.text;
}"#;

#[cfg(test)]
mod tests;
