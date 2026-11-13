//! Claude CLI backend (experimental, personal / internal use).
//!
//! The CLI only plays the model: its built-in tools are off (`--tools ""`) and the only MCP
//! server it may use is `silence` (`--strict-mcp-config`). That server is this Engine: the CLI
//! spawns `silence-engine mcp-bridge`, which pipes MCP stdio to a loopback listener opened for
//! this turn (one-time token). Every `tools/call` runs through `dispatch_tool`, so the Risk
//! Engine, permission prompts, diff cards and audit apply exactly as on the HTTP backends.

use super::*;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpListener;

/// MCP server name the CLI sees; tools appear to the model as `mcp__silence__<tool>`.
pub(crate) const BRIDGE_SERVER: &str = "silence";
const MCP_PROTOCOL: &str = "2025-06-18";
/// Text-only prior turns replayed into the first CLI turn of a session that started elsewhere.
const PRIOR_MAX_CHARS: usize = 24_000;

/// Run one user turn through the CLI. The user message is already in `s.messages`.
pub(super) async fn run_cli_turn(
    ctx: Arc<AppCtx>,
    session_arc: Arc<Mutex<Session>>,
    pick: Pick,
    text: String,
    tx: Option<mpsc::UnboundedSender<SessionEvent>>,
) -> Result<()> {
    let model_id = pick.model_id.clone();
    let model = ctx.catalog.resolve(&model_id)?;
    let provider = ctx.catalog.provider_for(&model)?.clone();
    let Some((program, _version)) = crate::providers::resolve_cli(&provider.command).await else {
        return Err(ProviderError::new(
            ErrorCode::CliNotFound,
            "`claude` not found on PATH (set SILENCE_CLAUDE_CLI to its path)",
        )
        .into());
    };

    let (system, tools, effort, resume, prior, workspace, sid) = {
        let s = session_arc.lock().await;
        let prof = profile(s.mode);
        let msgs = with_mode_system(&s.messages, &turn_system(prof.system, &s.style));
        let system = msgs
            .first()
            .filter(|m| m["role"] == "system")
            .map(|m| crate::images::content_text(m))
            .unwrap_or_default();
        let mut tools = builtin_tools(s.mode);
        if let Some(arr) = tools.as_array_mut() {
            // Images cannot travel back through an MCP text result in this backend.
            arr.retain(|t| t["function"]["name"] != "view_image");
        }
        let prior = if s.cli_session.is_none() { prior_transcript(&s.messages) } else { String::new() };
        (
            system,
            tools,
            model.effective_effort(&s.effort),
            s.cli_session.clone(),
            prior,
            s.workspace.root.clone(),
            s.id.clone(),
        )
    };
    let read_only = profile(session_arc.lock().await.mode).read_only;
    let mut tools = tools;
    if let Some(arr) = tools.as_array_mut() {
        arr.extend(mcp_tools(&ctx, read_only).await);
    }

    emit(&tx, pick.route_event());

    // Loopback MCP listener for this turn only.
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let token = Uuid::new_v4().to_string();
    let server = tokio::spawn(serve_bridge(
        listener,
        token.clone(),
        BridgeCtx { ctx: ctx.clone(), session: session_arc.clone(), tx: tx.clone(), tools: tools.clone() },
    ));

    let dir = std::env::temp_dir().join(format!("silence-cli-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir)?;
    let result = run_cli_process(CliRun {
        program: &program,
        model: &model.api_model,
        effort: effort.as_deref(),
        resume: resume.as_deref(),
        system: &system,
        prompt: &if prior.is_empty() { text.clone() } else { format!("{prior}\n\n{text}") },
        dir: &dir,
        workspace: &workspace,
        port,
        token: &token,
        session: &session_arc,
        tx: &tx,
    })
    .await;
    server.abort();
    let _ = std::fs::remove_dir_all(&dir);
    let out = result?;

    if let Some(id) = &out.session_id {
        session_arc.lock().await.cli_session = Some(id.clone());
    }
    emit(
        &tx,
        SessionEvent::Cost {
            input_tokens: out.input_tokens,
            output_tokens: out.output_tokens,
            usd: out.usd,
            slot: pick.slot_str(),
            baseline_usd: cli_baseline(&ctx.catalog, &pick, out.input_tokens, out.output_tokens, out.usd),
        },
    );
    let _ = ctx
        .audit
        .append(now_event(
            &sid,
            "completion",
            &model_id,
            "",
            "",
            out.input_tokens,
            out.output_tokens,
            out.usd,
            json!({"finish": out.stop, "backend": "claude_cli"}),
        ))
        .await;
    {
        let mut s = session_arc.lock().await;
        s.last_model = Some(model_id.clone());
        s.spent_usd += out.usd;
        s.last_call_usd = out.usd;
        // Auto cannot switch the CLI's model mid-turn: trouble in this turn makes the next one
        // start on Frontier.
        let outcomes = std::mem::take(&mut s.tool_log);
        if pick.slot.is_some() {
            let rules = &ctx.catalog.raw.escalation;
            let mut esc = Escalation::default();
            for o in &outcomes {
                esc.observe_step(std::slice::from_ref(o), rules, s.mode == SessionMode::Debug, false);
            }
            s.cli_hot = esc.hot();
        }
        s.messages.push(json!({"role": "assistant", "content": out.text}));
        persist_messages(&ctx, &mut s).await;
    }
    emit(&tx, SessionEvent::Done { stop: out.stop });
    Ok(())
}

/// "All Opus" price of a CLI turn: the CLI reports only its own USD, so price the tokens on the
/// source's strongest model and scale by the CLI's ratio when the catalog has prices.
fn cli_baseline(catalog: &Catalog, pick: &Pick, input: u32, output: u32, usd: f64) -> f64 {
    if pick.slot.is_none() {
        return usd;
    }
    let (Some(base), Ok(used)) = (catalog.baseline_model(&pick.source), catalog.resolve(&pick.model_id)) else {
        return usd;
    };
    let b = gateway::cost_usd(base, input, output);
    let u = gateway::cost_usd(&used, input, output);
    if b <= 0.0 || u <= 0.0 {
        return usd;
    }
    (usd * b / u).max(usd)
}

/// Earlier user/assistant text, for a session that switches to the CLI mid-way (the CLI has no
/// copy of it). Newest kept when over budget. Empty when there is no earlier exchange.
fn prior_transcript(messages: &[Value]) -> String {
    let mut lines: Vec<String> = Vec::new();
    // The last message is the user turn being sent now.
    let hist = &messages[..messages.len().saturating_sub(1)];
    for m in hist {
        let role = m["role"].as_str().unwrap_or("");
        if role != "user" && role != "assistant" {
            continue;
        }
        let t = crate::images::content_text(m);
        if t.trim().is_empty() || t.starts_with(VIEW_IMAGE_TAG) {
            continue;
        }
        lines.push(format!("{role}: {}", t.trim()));
    }
    if lines.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    for l in lines.iter().rev() {
        if out.len() + l.len() > PRIOR_MAX_CHARS {
            break;
        }
        out = format!("{l}\n{out}");
    }
    format!("<prior_conversation>\n{}</prior_conversation>", out)
}

struct CliRun<'a> {
    program: &'a str,
    model: &'a str,
    effort: Option<&'a str>,
    resume: Option<&'a str>,
    system: &'a str,
    prompt: &'a str,
    dir: &'a std::path::Path,
    workspace: &'a std::path::Path,
    port: u16,
    token: &'a str,
    session: &'a Arc<Mutex<Session>>,
    tx: &'a Option<mpsc::UnboundedSender<SessionEvent>>,
}

#[derive(Debug, Default, PartialEq)]
pub(crate) struct CliOutcome {
    pub text: String,
    pub stop: String,
    pub session_id: Option<String>,
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub usd: f64,
}

/// Arguments for `claude -p`. Pure, so the hardening flags are unit-tested.
pub(crate) fn cli_args(
    model: &str,
    effort: Option<&str>,
    resume: Option<&str>,
    system_file: &str,
    mcp_file: &str,
) -> Vec<String> {
    let mut a: Vec<String> = [
        "-p",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--verbose",
        "--model",
        model,
        // No built-in tools: every action goes through the silence MCP bridge.
        "--tools",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        mcp_file,
        "--allowedTools",
        "mcp__silence",
        // Anything not pre-allowed is denied instead of prompting nobody.
        "--permission-mode",
        "dontAsk",
        "--system-prompt-file",
        system_file,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    if let Some(e) = effort {
        a.extend(["--effort".to_string(), e.to_string()]);
    }
    if let Some(r) = resume {
        a.extend(["--resume".to_string(), r.to_string()]);
    }
    a
}

/// What `cli_args` always enforces, in words, with the flag it comes from (Settings shows this).
pub fn cli_safeguards() -> Vec<(String, String)> {
    [
        ("Built-in CLI tools are off; every action is a 5ilence tool (Risk Engine, diff, audit)", "--tools \"\""),
        ("Only the silence MCP bridge is loaded, none of your other MCP servers", "--strict-mcp-config"),
        ("Only silence tools are allowed", "--allowedTools mcp__silence"),
        ("Anything not allowed is denied, never auto-approved", "--permission-mode dontAsk"),
        ("5ilence's own system prompt replaces the CLI one", "--system-prompt-file"),
    ]
    .iter()
    .map(|(a, b)| (a.to_string(), b.to_string()))
    .collect()
}

async fn run_cli_process(run: CliRun<'_>) -> Result<CliOutcome> {
    let exe = std::env::current_exe()?;
    let mcp = json!({"mcpServers": {BRIDGE_SERVER: {
        "type": "stdio",
        "command": exe.to_string_lossy(),
        "args": ["mcp-bridge", "--port", run.port.to_string(), "--token", run.token],
    }}});
    let mcp_file = run.dir.join("mcp.json");
    let system_file = run.dir.join("system.md");
    std::fs::write(&mcp_file, serde_json::to_vec(&mcp)?)?;
    std::fs::write(&system_file, run.system)?;

    let mut cmd = crate::providers::quiet_command(run.program);
    cmd.args(cli_args(
        run.model,
        run.effort,
        run.resume,
        &system_file.to_string_lossy(),
        &mcp_file.to_string_lossy(),
    ))
    .current_dir(run.workspace)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);
    let mut child = cmd.spawn().map_err(|e| {
        ProviderError::new(ErrorCode::CliNotFound, &format!("cannot start {}: {e}", run.program))
    })?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(run.prompt.as_bytes()).await?;
        drop(stdin);
    }
    let stderr = child.stderr.take();
    let stderr_task = tokio::spawn(async move {
        let mut buf = String::new();
        if let Some(e) = stderr {
            let mut lines = BufReader::new(e).lines();
            while let Ok(Some(l)) = lines.next_line().await {
                if buf.len() < 4000 {
                    buf.push_str(&l);
                    buf.push('\n');
                }
            }
        }
        buf
    });
    let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
    let mut lines = BufReader::new(stdout).lines();
    let mut st = CliStream::default();
    let mut tick = tokio::time::interval(Duration::from_millis(300));
    loop {
        tokio::select! {
            line = lines.next_line() => {
                match line? {
                    Some(l) => {
                        if let Ok(v) = serde_json::from_str::<Value>(&l) {
                            st.ingest(&v, run.tx);
                        }
                    }
                    None => break,
                }
            }
            _ = tick.tick() => {
                if run.session.lock().await.abort {
                    let _ = child.kill().await;
                    return Ok(CliOutcome { text: st.text, stop: "abort".into(), ..Default::default() });
                }
            }
        }
    }
    let status = child.wait().await?;
    let err_text = stderr_task.await.unwrap_or_default();
    st.finish(status.success(), &err_text)
}

/// Accumulates `claude -p --output-format stream-json` lines.
#[derive(Default)]
pub(crate) struct CliStream {
    text: String,
    result: Option<Value>,
    session_id: Option<String>,
}

impl CliStream {
    pub(crate) fn ingest(&mut self, v: &Value, tx: &Option<mpsc::UnboundedSender<SessionEvent>>) {
        match v["type"].as_str().unwrap_or("") {
            "system" => {
                if let Some(id) = v["session_id"].as_str() {
                    self.session_id = Some(id.to_string());
                }
            }
            "stream_event" => {
                let ev = &v["event"];
                if ev["type"] == "content_block_delta" {
                    let d = &ev["delta"];
                    match d["type"].as_str().unwrap_or("") {
                        "text_delta" => {
                            let t = d["text"].as_str().unwrap_or("");
                            if !t.is_empty() {
                                self.text.push_str(t);
                                emit(tx, SessionEvent::Token { text: t.to_string() });
                            }
                        }
                        "thinking_delta" => {
                            let t = d["thinking"].as_str().unwrap_or("");
                            if !t.is_empty() {
                                emit(tx, SessionEvent::Thinking { text: t.to_string() });
                            }
                        }
                        _ => {}
                    }
                }
            }
            "result" => {
                if let Some(id) = v["session_id"].as_str() {
                    self.session_id = Some(id.to_string());
                }
                self.result = Some(v.clone());
            }
            _ => {}
        }
    }

    pub(crate) fn finish(self, exited_ok: bool, stderr: &str) -> Result<CliOutcome> {
        let Some(r) = self.result else {
            let detail = if stderr.trim().is_empty() { "Claude CLI exited without a result" } else { stderr };
            return Err(cli_error(detail, exited_ok).into());
        };
        let msg = r["result"].as_str().unwrap_or("").to_string();
        if r["is_error"].as_bool().unwrap_or(false) || r["subtype"].as_str().is_some_and(|s| s.starts_with("error")) {
            return Err(cli_error(if msg.is_empty() { stderr } else { &msg }, exited_ok).into());
        }
        let u = &r["usage"];
        let n = |k: &str| u[k].as_u64().unwrap_or(0) as u32;
        Ok(CliOutcome {
            // Streamed deltas cover every assistant message; `result` is the last one only.
            text: if self.text.trim().is_empty() { msg } else { self.text },
            stop: "stop".into(),
            session_id: self.session_id,
            input_tokens: n("input_tokens") + n("cache_read_input_tokens") + n("cache_creation_input_tokens"),
            output_tokens: n("output_tokens"),
            usd: r["total_cost_usd"].as_f64().unwrap_or(0.0),
        })
    }
}

fn cli_error(detail: &str, _exited_ok: bool) -> ProviderError {
    let d = detail.to_lowercase();
    let code = if d.contains("login") || d.contains("not logged in") || d.contains("api key") || d.contains("authenticat") {
        ErrorCode::CliAuth
    } else if d.contains("rate limit") || d.contains("usage limit") {
        ErrorCode::ProviderRate
    } else if d.contains("overloaded") {
        ErrorCode::ProviderUnavailable
    } else {
        ErrorCode::Unknown
    };
    ProviderError::new(code, detail)
}

#[derive(Clone)]
struct BridgeCtx {
    ctx: Arc<AppCtx>,
    session: Arc<Mutex<Session>>,
    tx: Option<mpsc::UnboundedSender<SessionEvent>>,
    tools: Value,
}

/// Accept bridge connections for this turn. The first line must be the turn's token; anything
/// else is dropped. Loopback only.
async fn serve_bridge(listener: TcpListener, token: String, b: BridgeCtx) {
    while let Ok((stream, peer)) = listener.accept().await {
        if !peer.ip().is_loopback() {
            continue;
        }
        let b = b.clone();
        let token = token.clone();
        tokio::spawn(async move {
            let (r, mut w) = stream.into_split();
            let mut lines = BufReader::new(r).lines();
            match lines.next_line().await {
                Ok(Some(first)) if first.trim() == token => {}
                _ => return,
            }
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(req) = serde_json::from_str::<Value>(&line) else { continue };
                if let Some(resp) = handle_mcp(&b, &req).await {
                    let mut out = serde_json::to_vec(&resp).unwrap_or_default();
                    out.push(b'\n');
                    if w.write_all(&out).await.is_err() {
                        return;
                    }
                }
            }
        });
    }
}

/// MCP tool list from OpenAI-shaped tool definitions.
pub(crate) fn mcp_tool_list(tools: &Value) -> Value {
    let list: Vec<Value> = tools
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|t| {
            let f = &t["function"];
            Some(json!({
                "name": f["name"].as_str()?,
                "description": f["description"].as_str().unwrap_or(""),
                "inputSchema": if f["parameters"].is_object() { f["parameters"].clone() } else { json!({"type": "object"}) },
            }))
        })
        .collect();
    json!({"tools": list})
}

async fn handle_mcp(b: &BridgeCtx, req: &Value) -> Option<Value> {
    let id = req.get("id").cloned()?; // notifications get no reply
    let method = req["method"].as_str().unwrap_or("");
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": req["params"]["protocolVersion"].as_str().unwrap_or(MCP_PROTOCOL),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": BRIDGE_SERVER, "version": env!("CARGO_PKG_VERSION")},
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(mcp_tool_list(&b.tools)),
        "tools/call" => {
            let name = req["params"]["name"].as_str().unwrap_or("").to_string();
            let known = b.tools.as_array().into_iter().flatten().any(|t| t["function"]["name"] == name.as_str());
            if !known {
                Ok(json!({"content": [{"type": "text", "text": format!("unknown tool {name}")}], "isError": true}))
            } else {
                let args = req["params"]["arguments"].clone();
                let tc = ToolCall {
                    id: format!("cli-{}", Uuid::new_v4()),
                    name,
                    arguments: if args.is_object() { args.to_string() } else { "{}".into() },
                };
                let (text, is_error) = match dispatch_tool(&b.ctx, &b.session, &b.tx, &tc).await {
                    Ok(t) => (t, false),
                    Err(e) => (format!("ERROR: {e}"), true),
                };
                Ok(json!({"content": [{"type": "text", "text": redact(&text)}], "isError": is_error}))
            }
        }
        _ => Err(json!({"code": -32601, "message": format!("method not found: {method}")})),
    };
    Some(match result {
        Ok(r) => json!({"jsonrpc": "2.0", "id": id, "result": r}),
        Err(e) => json!({"jsonrpc": "2.0", "id": id, "error": e}),
    })
}

/// `silence-engine mcp-bridge`: pipe MCP stdio (from the CLI) to the Engine's per-turn
/// listener. Sends the token first; everything after is relayed byte for byte.
pub async fn run_bridge(port: u16, token: &str) -> Result<()> {
    let stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await?;
    let (mut r, mut w) = stream.into_split();
    w.write_all(format!("{token}\n").as_bytes()).await?;
    let mut stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let up = async {
        tokio::io::copy(&mut stdin, &mut w).await?;
        w.shutdown().await
    };
    let down = async {
        tokio::io::copy(&mut r, &mut stdout).await?;
        stdout.flush().await
    };
    tokio::select! {
        r = up => r?,
        r = down => r?,
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_disable_builtin_tools_and_pin_mcp() {
        let a = cli_args("claude-opus-5-5", Some("high"), Some("sess-1"), "sys.md", "mcp.json");
        let pos = |flag: &str| a.iter().position(|x| x == flag).unwrap_or_else(|| panic!("{flag} missing: {a:?}"));
        assert_eq!(a[pos("--tools") + 1], "", "built-in tools off");
        assert!(a.contains(&"--strict-mcp-config".to_string()));
        assert_eq!(a[pos("--mcp-config") + 1], "mcp.json");
        assert_eq!(a[pos("--allowedTools") + 1], "mcp__silence");
        assert_eq!(a[pos("--permission-mode") + 1], "dontAsk");
        assert_eq!(a[pos("--effort") + 1], "high");
        assert_eq!(a[pos("--resume") + 1], "sess-1");
        assert!(!a.iter().any(|x| x.contains("dangerously") || x == "bypassPermissions"));
        let b = cli_args("m", None, None, "s", "m");
        assert!(!b.contains(&"--effort".to_string()) && !b.contains(&"--resume".to_string()));
    }

    #[test]
    fn safeguards_match_the_real_args() {
        let a = cli_args("m", None, None, "s", "m").join(" ");
        for (_, flag) in cli_safeguards() {
            let head = flag.split_whitespace().next().unwrap();
            assert!(a.contains(head), "{flag} not in {a}");
        }
        assert!(a.contains("--allowedTools mcp__silence"));
        assert!(a.contains("--permission-mode dontAsk"));
    }

    #[test]
    fn stream_collects_text_cost_and_session() {
        let lines = [
            json!({"type": "system", "subtype": "init", "session_id": "abc"}),
            json!({"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"type": "thinking_delta", "thinking": "hmm"}}}),
            json!({"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": "Done."}}}),
            json!({"type": "result", "subtype": "success", "is_error": false, "result": "Done.", "session_id": "abc",
                   "total_cost_usd": 0.0123, "usage": {"input_tokens": 10, "cache_read_input_tokens": 90, "output_tokens": 5}}),
        ];
        let (tx, mut rx) = mpsc::unbounded_channel();
        let tx = Some(tx);
        let mut st = CliStream::default();
        for l in &lines {
            st.ingest(l, &tx);
        }
        let out = st.finish(true, "").unwrap();
        assert_eq!(out.text, "Done.");
        assert_eq!(out.session_id.as_deref(), Some("abc"));
        assert_eq!(out.input_tokens, 100);
        assert_eq!(out.output_tokens, 5);
        assert!((out.usd - 0.0123).abs() < 1e-9);
        let mut kinds = Vec::new();
        while let Ok(ev) = rx.try_recv() {
            kinds.push(match ev {
                SessionEvent::Thinking { .. } => "thinking",
                SessionEvent::Token { .. } => "token",
                _ => "other",
            });
        }
        assert_eq!(kinds, ["thinking", "token"]);
    }

    #[test]
    fn login_error_maps_to_cli_auth() {
        let mut st = CliStream::default();
        st.ingest(&json!({"type": "result", "subtype": "success", "is_error": true, "result": "Invalid API key · Please run /login"}), &None);
        let err = st.finish(true, "").unwrap_err();
        assert_eq!(err.downcast_ref::<ProviderError>().unwrap().code, ErrorCode::CliAuth);
        let err = CliStream::default().finish(false, "").unwrap_err();
        assert_eq!(err.downcast_ref::<ProviderError>().unwrap().code, ErrorCode::Unknown);
    }

    #[test]
    fn mcp_list_uses_input_schema() {
        let tools = json!([{"type": "function", "function": {"name": "read", "description": "Read", "parameters": {"type": "object", "properties": {"path": {"type": "string"}}}}}]);
        let l = mcp_tool_list(&tools);
        assert_eq!(l["tools"][0]["name"], "read");
        assert_eq!(l["tools"][0]["inputSchema"]["properties"]["path"]["type"], "string");
    }

    #[test]
    fn prior_transcript_skips_current_turn_and_tools() {
        let msgs = vec![
            json!({"role": "system", "content": "S"}),
            json!({"role": "user", "content": "first"}),
            json!({"role": "assistant", "content": "", "tool_calls": []}),
            json!({"role": "tool", "tool_call_id": "t", "content": "out"}),
            json!({"role": "assistant", "content": "answer"}),
            json!({"role": "user", "content": "now"}),
        ];
        let p = prior_transcript(&msgs);
        assert!(p.contains("user: first") && p.contains("assistant: answer"));
        assert!(!p.contains("now") && !p.contains("out"));
        assert_eq!(prior_transcript(&msgs[..2]), "");
    }
}
