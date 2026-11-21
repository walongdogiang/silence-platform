//! Agent tools for background processes: `proc_start`, `proc_logs`, `proc_stop`, `proc_list`.
//! The mechanics live in `silence_tools::procs`; this file adds sessions, permission, audit and
//! the `proc` event the Studio shows in its Ports tab.
//!
//! `proc_start` is gated exactly like `shell` (same Risk Engine rules, same remembered
//! patterns): starting `npm run dev` in the background is the same command as running it.

use super::*;
use silence_tools::procs::{self, Info, Table};
use std::time::Duration;

/// Seconds `proc_start` waits for readiness by default, and at most.
const READY_DEFAULT_S: u64 = 20;
const READY_MAX_S: u64 = 120;
/// Lines `proc_logs` returns by default, and at most.
const LOGS_DEFAULT: usize = 80;
const LOGS_MAX: usize = 400;

pub(super) const NAMES: [&str; 4] = ["proc_start", "proc_logs", "proc_stop", "proc_list"];

/// The session's process table (created on first use).
pub(crate) async fn table(ctx: &AppCtx, session_id: &str) -> Arc<Table> {
    ctx.procs.lock().await.entry(session_id.to_string()).or_default().clone()
}

/// Model-facing name of the grouped tool. Calls are dispatched as `proc_<op>` (see
/// `expand_grouped_call`), so risk rules, audit, events and evals keep the per-op names.
pub(super) const TOOL: &str = "proc";

/// One schema for the whole family (fewer prompt tokens than four tools; the tool list is part of
/// the cached prefix). Read-only modes get only `logs` and `list`.
pub(super) fn spec(read_only: bool) -> Value {
    let (ops, desc): (Vec<&str>, &str) = if read_only {
        (
            vec!["logs", "list"],
            "Background processes of this session. \
             op=logs: output of `id`; `since` = last line number you saw (only new lines), `grep` = regex filter, \
             `tail` = max lines (default 80, max 400). op=list: processes with status and URLs.",
        )
    } else {
        (
            vec!["start", "logs", "stop", "list"],
            "Background processes: dev servers, watchers, anything long-running (`shell` blocks until exit). \
             op=start: run `command` in the background and wait until `ready` (regex) matches an output line, \
             or else until a localhost URL is printed, the process exits, or `timeout_s` passes (default 20, max 120); \
             returns id, status, URLs and the last lines. \
             op=logs: output of `id`; `since` = last line number you saw (only new lines), `grep` = regex filter, \
             `tail` = max lines (default 80, max 400). \
             op=stop: stop `id` and its child processes. op=list: processes with status and URLs. \
             Stop what you started when you are done.",
        )
    };
    let mut props = json!({"op": {"type": "string", "enum": ops}});
    if !read_only {
        props["command"] = json!({"type": "string"});
        props["ready"] = json!({"type": "string"});
        props["timeout_s"] = json!({"type": "integer"});
    }
    props["id"] = json!({"type": "string"});
    props["since"] = json!({"type": "integer"});
    props["grep"] = json!({"type": "string"});
    props["tail"] = json!({"type": "integer"});
    json!({
        "type": "function",
        "function": {
            "name": TOOL,
            "description": desc,
            "parameters": {"type": "object", "properties": props, "required": ["op"]}
        }
    })
}

pub(super) fn event(info: &Info) -> SessionEvent {
    SessionEvent::Proc {
        id: info.id.clone(),
        command: info.command.clone(),
        status: info.status.as_str(),
        urls: info.urls.clone(),
    }
}

fn end(tx: &Option<mpsc::UnboundedSender<SessionEvent>>, tc: &ToolCall, ok: bool, out: String) -> String {
    emit(
        tx,
        SessionEvent::ToolEnd {
            call_id: tc.id.clone(),
            name: tc.name.clone(),
            ok,
            output: out.clone(),
        },
    );
    out
}

fn regex_arg(args: &Value, key: &str) -> Result<Option<regex::Regex>> {
    match args.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => Ok(Some(regex::Regex::new(p).map_err(|e| anyhow!("invalid `{key}` regex: {e}"))?)),
        None => Ok(None),
    }
}

/// Run one `proc_*` call. `ToolStart` was already emitted by `dispatch_tool`.
pub(super) async fn dispatch(
    ctx: &AppCtx,
    session_arc: &Arc<Mutex<Session>>,
    tx: &Option<mpsc::UnboundedSender<SessionEvent>>,
    tc: &ToolCall,
    args: &Value,
) -> Result<String> {
    let (sid, read_only, ws) = {
        let s = session_arc.lock().await;
        (s.id.clone(), s.mode.read_only(), s.workspace.clone())
    };
    let t = table(ctx, &sid).await;
    match tc.name.as_str() {
        "proc_start" => {
            if read_only {
                return Ok(refuse(tx, tc, "is not available in a read-only mode"));
            }
            let command = args.get("command").and_then(Value::as_str).unwrap_or("").trim().to_string();
            let ready = match regex_arg(args, "ready") {
                Ok(r) => r,
                Err(e) => return Ok(end(tx, tc, false, e.to_string())),
            };
            // Same gate as `shell`: rules, prompts and remembered patterns all apply.
            let verdict = match gate(ctx, session_arc, tx, "shell", &json!({"command": command}), false).await? {
                Gate::Run(v) => v,
                // Autonomous with a ready sandbox: `shell` runs contained, but a process that keeps
                // running is not wrapped yet. Never fall back to an unsandboxed run.
                Gate::Sandbox { .. } => {
                    return Ok(end(
                        tx,
                        tc,
                        false,
                        "proc_start does not run inside the Autonomous-mode sandbox yet, so it is refused.                          Use `shell` for commands that finish; to start a dev server the user must switch to                          Balanced mode (or start it themselves in the terminal)."
                            .into(),
                    ))
                }
                Gate::Denied => return Ok(DENIED_BY_USER.into()),
                Gate::Blocked(msg) => return Ok(blocked(tx, tc, msg)),
            };
            if verdict.brings_external_content() {
                session_arc.lock().await.tainted = true;
            }
            let notify_tx = tx.clone();
            let notify: procs::Notify = Arc::new(move |info: &Info| emit(&notify_tx, event(info)));
            let id = match t.start(&ws, &command, |s| redact(s), Some(notify)) {
                Ok(id) => id,
                Err(e) => {
                    record_outcome(session_arc, tc, false, false, false).await;
                    return Ok(end(tx, tc, false, e.to_string()));
                }
            };
            if let Some(info) = t.info(&id) {
                emit(tx, event(&info));
            }
            let secs = args.get("timeout_s").and_then(Value::as_u64).unwrap_or(READY_DEFAULT_S).clamp(1, READY_MAX_S);
            let ready_ok = t.wait_ready(&id, ready.as_ref(), Duration::from_secs(secs)).await;
            let info = t.info(&id).ok_or_else(|| anyhow!("process vanished"))?;
            let lines = t.lines(&id, 0, None, 40).unwrap_or_default();
            let mut out = procs::render(&info, &lines);
            out.push_str(match (ready_ok, info.status.running()) {
                (true, _) => "ready: yes\n",
                (false, true) => "ready: not yet (still running; check proc_logs)\n",
                (false, false) => "ready: no — the process ended; read the output above\n",
            });
            let ok = ready_ok || info.status.running();
            record_outcome(session_arc, tc, ok, false, false).await;
            let _ = ctx
                .audit
                .append(now_event(
                    &sid,
                    "tool",
                    "",
                    &tc.name,
                    "",
                    0,
                    0,
                    0.0,
                    json!({"ok": ok, "tier": verdict.tier.as_str(), "codes": verdict.codes, "command": redact(&command), "id": id}),
                ))
                .await;
            Ok(end(tx, tc, ok, out))
        }
        "proc_logs" => {
            let id = args.get("id").and_then(Value::as_str).unwrap_or("");
            let grep = match regex_arg(args, "grep") {
                Ok(r) => r,
                Err(e) => return Ok(end(tx, tc, false, e.to_string())),
            };
            let since = args.get("since").and_then(Value::as_u64).unwrap_or(0);
            let tail = args.get("tail").and_then(Value::as_u64).map(|n| n as usize).unwrap_or(LOGS_DEFAULT).clamp(1, LOGS_MAX);
            match (t.info(id), t.lines(id, since, grep.as_ref(), tail)) {
                (Some(info), Some(lines)) => Ok(end(tx, tc, true, procs::render(&info, &lines))),
                _ => Ok(end(tx, tc, false, format!("unknown process `{id}`; see proc_list"))),
            }
        }
        "proc_stop" => {
            if read_only {
                return Ok(refuse(tx, tc, "is not available in a read-only mode"));
            }
            let id = args.get("id").and_then(Value::as_str).unwrap_or("");
            let stopped = t.stop(id);
            let _ = ctx
                .audit
                .append(now_event(&sid, "tool", "", &tc.name, "", 0, 0, 0.0, json!({"ok": stopped, "id": id})))
                .await;
            let msg = if stopped { format!("{id} stopped") } else { format!("`{id}` is not running") };
            Ok(end(tx, tc, stopped, msg))
        }
        _ => {
            let list = t.list();
            if list.is_empty() {
                return Ok(end(tx, tc, true, "no background processes".into()));
            }
            let rows: Vec<String> = list
                .iter()
                .map(|i| {
                    let urls = if i.urls.is_empty() { String::new() } else { format!(" {}", i.urls.join(" ")) };
                    format!("{} [{}] {}{urls}", i.id, i.status.as_str(), i.command)
                })
                .collect();
            Ok(end(tx, tc, true, rows.join("\n")))
        }
    }
}

/// `proc.list` RPC row (Studio Ports tab).
pub fn rows(t: &Table) -> Value {
    json!(t
        .list()
        .iter()
        .map(|i| json!({"id": i.id, "command": i.command, "status": i.status.as_str(), "urls": i.urls}))
        .collect::<Vec<_>>())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(data: &std::path::Path) -> AppCtx {
        let raw = serde_json::from_value(json!({"version": 1, "providers": [], "models": []})).unwrap();
        AppCtx::new(Catalog::from_raw(raw), AuditLog::open(data).unwrap())
    }

    fn call(name: &str, args: Value) -> ToolCall {
        ToolCall { id: format!("c-{name}"), name: name.into(), arguments: args.to_string() }
    }

    #[test]
    fn read_only_modes_cannot_start_or_stop() {
        let ops = |ro: bool| spec(ro)["function"]["parameters"]["properties"]["op"]["enum"].clone();
        assert_eq!(ops(true), json!(["logs", "list"]));
        assert_eq!(ops(false), json!(["start", "logs", "stop", "list"]));
        assert!(spec(true)["function"]["parameters"]["properties"].get("command").is_none());
        // Every op maps to a dispatched name.
        for op in ["start", "logs", "stop", "list"] {
            assert!(NAMES.contains(&format!("proc_{op}").as_str()));
        }
    }

    #[tokio::test]
    #[ignore = "fails intermittently on the Windows CI runner (PR #41, #42); the Rust Engine is frozen and removed in phase 2 (docs/adapters/migration.md). Run locally with --ignored."]
    async fn start_logs_list_stop_through_dispatch() {
        let (ws, data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let c = ctx(data.path());
        // Autonomous: the echo/sleep command runs without a prompt.
        let sid = create_session(&c, ws.path().to_str().unwrap(), None, SessionMode::Agent, PermissionMode::Yolo)
            .await
            .unwrap();
        let s = c.sessions.lock().await.get(&sid).cloned().unwrap();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let tx = Some(tx);
        let cmd = if cfg!(windows) {
            "Write-Output 'Local: http://localhost:5199/'; Start-Sleep -Seconds 30"
        } else {
            "echo 'Local: http://localhost:5199/'; sleep 30"
        };
        let out = dispatch_tool(&c, &s, &tx, &call("proc_start", json!({"command": cmd, "timeout_s": 20})))
            .await
            .unwrap();
        assert!(out.contains("id: p1") && out.contains("http://localhost:5199/") && out.contains("ready: yes"), "{out}");

        let out = dispatch_tool(&c, &s, &tx, &call("proc_list", json!({}))).await.unwrap();
        assert!(out.contains("p1 [running]"), "{out}");
        let out = dispatch_tool(&c, &s, &tx, &call("proc_logs", json!({"id": "p1", "grep": "Local"}))).await.unwrap();
        assert!(out.contains("1: Local: http://localhost:5199/"), "{out}");
        let out = dispatch_tool(&c, &s, &tx, &call("proc_stop", json!({"id": "p1"}))).await.unwrap();
        assert_eq!(out, "p1 stopped");

        let mut saw_url = false;
        let mut saw_stop = false;
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while std::time::Instant::now() < deadline && !(saw_url && saw_stop) {
            match tokio::time::timeout(Duration::from_millis(200), rx.recv()).await {
                Ok(Some(SessionEvent::Proc { urls, status, .. })) => {
                    saw_url |= !urls.is_empty();
                    saw_stop |= status == "stopped";
                }
                Ok(Some(_)) => {}
                _ => {}
            }
        }
        assert!(saw_url && saw_stop, "proc events: url {saw_url}, stop {saw_stop}");
        let audit = c.audit.query(Some(&sid), 20).unwrap();
        assert!(audit.iter().any(|e| e.tool == "proc_start"));
    }

    /// `http_check` sits next to `proc_*` in the "verify your work" ladder; its agent-level rules.
    #[tokio::test]
    async fn http_check_read_only_and_remote_rules() {
        let (ws, data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let c = ctx(data.path());
        let sid = create_session(&c, ws.path().to_str().unwrap(), None, SessionMode::Ask, PermissionMode::Yolo)
            .await
            .unwrap();
        let s = c.sessions.lock().await.get(&sid).cloned().unwrap();
        let names: Vec<String> = builtin_tools(SessionMode::Ask)
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["function"]["name"].as_str().unwrap().to_string())
            .collect();
        assert!(names.contains(&"http_check".to_string()), "Ask mode can check routes");
        let post = call("http_check", json!({"url": "http://127.0.0.1:9/x", "method": "POST"}));
        let out = dispatch_tool(&c, &s, &None, &post).await.unwrap();
        assert!(out.contains("only allows GET"), "{out}");
        let remote = call("http_check", json!({"url": "https://example.com/"}));
        let out = dispatch_tool(&c, &s, &None, &remote).await.unwrap();
        assert!(out.contains("HTTP_NOT_LOCAL"), "{out}");
        // A closed local port is an answer, not an error.
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        drop(l);
        let get = call("http_check", json!({"url": format!("http://127.0.0.1:{port}/")}));
        let out = dispatch_tool(&c, &s, &None, &get).await.unwrap();
        // The freed port can be handed to a server of a test running in parallel; then there is nothing to check.
        assert!(out.contains("no response") || out.contains("status:"), "{out}");
        assert!(!s.lock().await.tainted, "loopback checks never taint");
    }

    #[tokio::test]
    async fn blocked_command_never_starts() {
        let (ws, data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let c = ctx(data.path());
        let sid = create_session(&c, ws.path().to_str().unwrap(), None, SessionMode::Agent, PermissionMode::Yolo)
            .await
            .unwrap();
        let s = c.sessions.lock().await.get(&sid).cloned().unwrap();
        let out = dispatch_tool(&c, &s, &None, &call("proc_start", json!({"command": "format c:"}))).await.unwrap();
        assert!(out.contains("SYSTEM_CHANGE"), "{out}");
        assert!(table(&c, &sid).await.list().is_empty());
    }

    /// Autonomous + ready sandbox: `shell` runs contained, but a background process is not wrapped
    /// yet, so `proc_start` must refuse instead of starting it as the real user.
    #[tokio::test]
    async fn autonomous_sandbox_refuses_background_processes() {
        let (ws, data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let c = ctx(data.path());
        c.sandbox.pin_status_for_tests(Some(silence_sandbox::SandboxStatus::Ready));
        let sid = create_session(&c, ws.path().to_str().unwrap(), None, SessionMode::Agent, PermissionMode::Autonomous)
            .await
            .unwrap();
        let s = c.sessions.lock().await.get(&sid).cloned().unwrap();
        let out = dispatch_tool(&c, &s, &None, &call("proc_start", json!({"command": "echo hi"}))).await.unwrap();
        assert!(out.contains("Autonomous-mode sandbox"), "{out}");
        assert!(table(&c, &sid).await.list().is_empty(), "nothing was started");
    }
}
