//! Background processes the agent starts (dev servers, watchers): spawn, keep a ring buffer of
//! output, spot loopback URLs, stop. `shell` blocks until exit; these keep running.
//!
//! On Windows each process sits in a Job Object (kill-on-close), so stopping it — or the Engine
//! exiting — takes its whole tree down (`npm run dev` → node → esbuild). Elsewhere only the
//! direct child is killed.

use crate::{shell_command, Workspace};
use anyhow::{anyhow, Context, Result};
use regex::Regex;
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::sync::oneshot;

/// Lines kept per process.
pub const MAX_LINES: usize = 2000;
/// One output line is clipped to this many chars.
const MAX_LINE_CHARS: usize = 2000;
/// Running processes per table (one table per session).
pub const MAX_PROCS: usize = 8;

/// `http://localhost:5173`, `http://127.0.0.1:8000/`, `https://[::1]:3000/app`.
/// `0.0.0.0` (what some servers print when bound everywhere) is reported as `localhost`.
pub fn find_urls(line: &str) -> Vec<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"https?://(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{2,5}(?:/[^\s'\x22<>)\]]*)?").unwrap()
    });
    re.find_iter(&strip_ansi(line))
        .map(|m| m.as_str().trim_end_matches(['.', ',', ';']).replace("0.0.0.0", "localhost"))
        .collect()
}

/// Drop ANSI colour / cursor codes (Vite and Next colour their URLs).
pub fn strip_ansi(s: &str) -> String {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07").unwrap());
    re.replace_all(s, "").into_owned()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Running,
    Exited(Option<i32>),
    Stopped,
}

impl Status {
    pub fn as_str(&self) -> String {
        match self {
            Status::Running => "running".into(),
            Status::Stopped => "stopped".into(),
            Status::Exited(Some(c)) => format!("exited {c}"),
            Status::Exited(None) => "exited".into(),
        }
    }
    pub fn running(&self) -> bool {
        matches!(self, Status::Running)
    }
}

/// What a process looks like from outside. `seq` = number of lines ever written.
#[derive(Debug, Clone)]
pub struct Info {
    pub id: String,
    pub command: String,
    pub status: Status,
    pub urls: Vec<String>,
    pub seq: u64,
    pub started: Instant,
}

struct State {
    info: Info,
    lines: VecDeque<(u64, String)>,
    kill: Option<oneshot::Sender<()>>,
}

/// Called when a process changes in a way the UI shows (new URL, exit).
pub type Notify = Arc<dyn Fn(&Info) + Send + Sync>;

/// Processes of one session.
#[derive(Default)]
pub struct Table {
    procs: Mutex<HashMap<String, Arc<Mutex<State>>>>,
    next: Mutex<u32>,
}

impl Table {
    /// Spawn `command` in the workspace. Each output line passes through `clean` (secret redaction)
    /// before it is stored.
    pub fn start(
        &self,
        ws: &Workspace,
        command: &str,
        clean: fn(&str) -> String,
        notify: Option<Notify>,
    ) -> Result<String> {
        if command.trim().is_empty() {
            return Err(anyhow!("empty command"));
        }
        let running = self.list().iter().filter(|i| i.status.running()).count();
        if running >= MAX_PROCS {
            return Err(anyhow!("{running} background processes are running; stop one first (proc_stop)"));
        }
        let id = {
            let mut n = self.next.lock().unwrap();
            *n += 1;
            format!("p{}", *n)
        };
        let mut cmd = shell_command(ws, command);
        let mut child = cmd.spawn().context("spawn background process")?;
        let guard = silence_sandbox::wrap_pid(child.id().unwrap_or(0)).ok();
        let (kill_tx, kill_rx) = oneshot::channel();
        let state = Arc::new(Mutex::new(State {
            info: Info {
                id: id.clone(),
                command: command.to_string(),
                status: Status::Running,
                urls: Vec::new(),
                seq: 0,
                started: Instant::now(),
            },
            lines: VecDeque::new(),
            kill: Some(kill_tx),
        }));
        if let Some(out) = child.stdout.take() {
            spawn_reader(out, state.clone(), clean, notify.clone());
        }
        if let Some(err) = child.stderr.take() {
            spawn_reader(err, state.clone(), clean, notify.clone());
        }
        let st = state.clone();
        tokio::spawn(async move {
            let status = tokio::select! {
                r = child.wait() => Status::Exited(r.ok().and_then(|s| s.code())),
                _ = kill_rx => {
                    let _ = child.kill().await;
                    Status::Stopped
                }
            };
            // Closing the job handle kills what the child left behind (Windows).
            drop(guard);
            let info = {
                let mut s = st.lock().unwrap();
                s.info.status = status;
                s.kill = None;
                s.info.clone()
            };
            if let Some(n) = &notify {
                n(&info);
            }
        });
        self.procs.lock().unwrap().insert(id.clone(), state);
        Ok(id)
    }

    pub fn info(&self, id: &str) -> Option<Info> {
        self.get(id).map(|s| s.lock().unwrap().info.clone())
    }

    /// Newest first.
    pub fn list(&self) -> Vec<Info> {
        let mut v: Vec<Info> = self.procs.lock().unwrap().values().map(|s| s.lock().unwrap().info.clone()).collect();
        v.sort_by(|a, b| b.started.cmp(&a.started));
        v
    }

    /// Lines with `seq > since`, optionally only those matching `grep`, at most the last `tail`.
    pub fn lines(&self, id: &str, since: u64, grep: Option<&Regex>, tail: usize) -> Option<Vec<(u64, String)>> {
        let s = self.get(id)?;
        let s = s.lock().unwrap();
        let hits: Vec<(u64, String)> = s
            .lines
            .iter()
            .filter(|(n, l)| *n > since && grep.map_or(true, |re| re.is_match(l)))
            .cloned()
            .collect();
        let skip = hits.len().saturating_sub(tail);
        Some(hits.into_iter().skip(skip).collect())
    }

    /// Ask a running process to stop. `false` if it is unknown or already over.
    pub fn stop(&self, id: &str) -> bool {
        let Some(s) = self.get(id) else { return false };
        let kill = s.lock().unwrap().kill.take();
        kill.is_some_and(|k| k.send(()).is_ok())
    }

    /// Stop every process (session end).
    pub fn stop_all(&self) {
        let ids: Vec<String> = self.procs.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.stop(&id);
        }
    }

    /// Wait until `ready` matches a line, a URL shows up (when `ready` is `None`), the process
    /// ends, or `timeout` passes. Returns whether it got ready.
    pub async fn wait_ready(&self, id: &str, ready: Option<&Regex>, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            let Some(s) = self.get(id) else { return false };
            {
                let s = s.lock().unwrap();
                let hit = match ready {
                    Some(re) => s.lines.iter().any(|(_, l)| re.is_match(l)),
                    None => !s.info.urls.is_empty(),
                };
                if hit {
                    return true;
                }
                if !s.info.status.running() {
                    return false;
                }
            }
            if Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
        }
    }

    fn get(&self, id: &str) -> Option<Arc<Mutex<State>>> {
        self.procs.lock().unwrap().get(id).cloned()
    }
}

impl Drop for Table {
    fn drop(&mut self) {
        self.stop_all();
    }
}

fn spawn_reader<R: AsyncRead + Unpin + Send + 'static>(
    pipe: R,
    state: Arc<Mutex<State>>,
    clean: fn(&str) -> String,
    notify: Option<Notify>,
) {
    tokio::spawn(async move {
        let mut reader = BufReader::new(pipe);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let raw = String::from_utf8_lossy(&buf);
            let line = clip(&clean(strip_ansi(raw.trim_end_matches(['\r', '\n'])).as_str()));
            let urls = find_urls(&line);
            let changed = {
                let mut s = state.lock().unwrap();
                s.info.seq += 1;
                let n = s.info.seq;
                s.lines.push_back((n, line));
                while s.lines.len() > MAX_LINES {
                    s.lines.pop_front();
                }
                let mut changed = false;
                for u in urls {
                    if !s.info.urls.contains(&u) {
                        s.info.urls.push(u);
                        changed = true;
                    }
                }
                changed.then(|| s.info.clone())
            };
            if let (Some(info), Some(n)) = (changed, &notify) {
                n(&info);
            }
        }
    });
}

fn clip(line: &str) -> String {
    match line.char_indices().nth(MAX_LINE_CHARS) {
        None => line.to_string(),
        Some((cut, _)) => format!("{}…", &line[..cut]),
    }
}

/// Text the model gets for a process: header + numbered lines.
pub fn render(info: &Info, lines: &[(u64, String)]) -> String {
    let mut out = format!(
        "id: {}\nstatus: {}\ncommand: {}\nurls: {}\nlines: {} (use since={} for newer output)\n",
        info.id,
        info.status.as_str(),
        info.command,
        if info.urls.is_empty() { "-".to_string() } else { info.urls.join(", ") },
        info.seq,
        info.seq
    );
    if lines.is_empty() {
        out.push_str("(no output)\n");
    } else {
        out.push_str("---\n");
        for (n, l) in lines {
            out.push_str(&format!("{n}: {l}\n"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_loopback_urls_only() {
        assert_eq!(find_urls("  ➜  Local:   http://localhost:5173/"), vec!["http://localhost:5173/"]);
        assert_eq!(find_urls("\x1b[36mhttp://127.0.0.1:8000\x1b[39m."), vec!["http://127.0.0.1:8000"]);
        assert_eq!(find_urls("Listening on http://0.0.0.0:3000"), vec!["http://localhost:3000"]);
        assert_eq!(find_urls("see https://[::1]:8443/app ok"), vec!["https://[::1]:8443/app"]);
        assert!(find_urls("Network: http://192.168.1.5:5173/").is_empty());
        assert!(find_urls("docs at https://vite.dev").is_empty());
    }

    fn ws() -> (tempfile::TempDir, Workspace) {
        let dir = tempfile::tempdir().unwrap();
        let ws = Workspace::new(dir.path().to_str().unwrap()).unwrap();
        (dir, ws)
    }

    fn echo_then_wait() -> &'static str {
        if cfg!(windows) {
            "Write-Output 'ready at http://localhost:4321'; Write-Output 'token=sk-secret'; Start-Sleep -Seconds 30"
        } else {
            "echo 'ready at http://localhost:4321'; echo 'token=sk-secret'; sleep 30"
        }
    }

    fn redact(s: &str) -> String {
        s.replace("sk-secret", "[redacted]")
    }

    #[tokio::test]
    async fn start_wait_read_stop() {
        let (_d, ws) = ws();
        let t = Table::default();
        let id = t.start(&ws, echo_then_wait(), redact, None).unwrap();
        assert!(t.wait_ready(&id, None, Duration::from_secs(20)).await, "url seen");
        let info = t.info(&id).unwrap();
        assert_eq!(info.urls, vec!["http://localhost:4321"]);
        assert!(info.status.running());
        // Second line may land a moment later.
        let re = Regex::new("token").unwrap();
        assert!(t.wait_ready(&id, Some(&re), Duration::from_secs(10)).await);
        let lines = t.lines(&id, 0, Some(&re), 10).unwrap();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].1.contains("[redacted]") && !lines[0].1.contains("sk-secret"));
        assert!(t.stop(&id));
        for _ in 0..100 {
            if !t.info(&id).unwrap().status.running() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert_eq!(t.info(&id).unwrap().status, Status::Stopped);
        assert!(!t.stop(&id), "already stopped");
    }

    #[tokio::test]
    async fn exit_code_is_kept_and_ready_regex_times_out() {
        let (_d, ws) = ws();
        let t = Table::default();
        let cmd = if cfg!(windows) { "Write-Output hi; exit 3" } else { "echo hi; exit 3" };
        let id = t.start(&ws, cmd, |s| s.to_string(), None).unwrap();
        let never = Regex::new("never").unwrap();
        assert!(!t.wait_ready(&id, Some(&never), Duration::from_secs(20)).await);
        for _ in 0..100 {
            if !t.info(&id).unwrap().status.running() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert_eq!(t.info(&id).unwrap().status, Status::Exited(Some(3)));
        let out = render(&t.info(&id).unwrap(), &t.lines(&id, 0, None, 50).unwrap());
        assert!(out.contains("status: exited 3") && out.contains(": hi"), "{out}");
    }

    #[test]
    fn lines_since_and_tail() {
        let t = Table::default();
        let st = Arc::new(Mutex::new(State {
            info: Info { id: "p1".into(), command: "x".into(), status: Status::Running, urls: vec![], seq: 5, started: Instant::now() },
            lines: (1..=5).map(|n| (n, format!("l{n}"))).collect(),
            kill: None,
        }));
        t.procs.lock().unwrap().insert("p1".into(), st);
        let got: Vec<u64> = t.lines("p1", 2, None, 2).unwrap().into_iter().map(|(n, _)| n).collect();
        assert_eq!(got, vec![4, 5]);
        assert!(t.lines("nope", 0, None, 5).is_none());
    }
}
