use crate::agent::{self, AppCtx};
use crate::eval_rpc::{EvalConfig, EvalHost};
use crate::pty::TerminalSession;
use anyhow::Result;
use serde_json::{json, Value};
use silence_protocol::{
    ApprovePlanParams, ChatTitleParams, DiffApplyParams, DiffRejectParams, FsReadParams, FsTreeParams,
    PermissionDecision, PromptParams, RpcNotification, RpcRequest, RpcResponse,
    SessionCreateParams, SessionEvent, TerminalStartParams, TerminalWriteParams,
};
use silence_tools::Workspace;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, Mutex};

pub struct RpcState {
    pub ctx: Arc<AppCtx>,
    pub terminals: Mutex<HashMap<String, Arc<TerminalSession>>>,
    /// `eval.*`: suites under `<repo_root>/evals`, one run at a time.
    pub evals: Arc<EvalHost>,
}

impl RpcState {
    /// Evals resolve against the working directory and `config/models.yaml` there.
    pub fn new(ctx: Arc<AppCtx>) -> Self {
        let root = std::env::current_dir().unwrap_or_else(|_| ".".into());
        let config = root.join("config/models.yaml");
        Self::with_paths(ctx, root, config)
    }

    pub fn with_paths(ctx: Arc<AppCtx>, repo_root: std::path::PathBuf, config_path: std::path::PathBuf) -> Self {
        Self {
            ctx,
            terminals: Mutex::new(HashMap::new()),
            evals: Arc::new(EvalHost::new(repo_root, config_path)),
        }
    }
}

type SharedWriter = Arc<Mutex<Box<dyn AsyncWrite + Unpin + Send>>>;

pub async fn serve_connection<R, W>(state: Arc<RpcState>, reader: R, writer: W) -> Result<()>
where
    R: tokio::io::AsyncRead + Unpin,
    W: tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let writer: SharedWriter = Arc::new(Mutex::new(Box::new(writer)));
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }
        let req: RpcRequest = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(err) => {
                tracing::warn!("bad rpc: {err}");
                continue;
            }
        };
        match dispatch(state.clone(), writer.clone(), req).await {
            Ok(()) => {}
            Err(err) => tracing::warn!("rpc dispatch: {err}"),
        }
    }
    Ok(())
}

async fn write_json(writer: &SharedWriter, value: &Value) -> Result<()> {
    let mut payload = serde_json::to_string(value)?;
    payload.push('\n');
    let mut w = writer.lock().await;
    w.write_all(payload.as_bytes()).await?;
    w.flush().await?;
    Ok(())
}

async fn dispatch(state: Arc<RpcState>, writer: SharedWriter, req: RpcRequest) -> Result<()> {
    let id = req.id.clone();
    // Every failure inside `handle` (bad params, unknown session, …) must become an RPC error
    // response. Never use `?` here: that would skip the reply and the client would hang until
    // its own timeout.
    let resp = match handle(state, writer.clone(), req).await {
        Ok(v) => RpcResponse::ok(id, v),
        Err(err) => RpcResponse::err(id, -32000, format!("{err:#}")),
    };
    write_json(&writer, &serde_json::to_value(&resp)?).await
}

async fn handle(state: Arc<RpcState>, writer: SharedWriter, req: RpcRequest) -> Result<Value> {
    match req.method.as_str() {
        "ping" => Ok(json!({"ok": true, "protocol": silence_protocol::PROTOCOL_VERSION})),
        "session.create" => session_create(state.clone(), writer.clone(), req.params).await,
        "session.list" => Ok(json!({"sessions": state.ctx.store.list()?})),
        // Settings → Dữ liệu. Only `events.jsonl` folders; the audit log is never deleted.
        "session.prune" => {
            let p: silence_protocol::SessionPruneParams = serde_json::from_value(req.params)?;
            if p.older_than_days == 0 {
                anyhow::bail!("older_than_days must be at least 1");
            }
            let mut keep: std::collections::HashSet<String> = p.keep.into_iter().collect();
            // Sessions open in this Engine are in use: never prune them.
            keep.extend(state.ctx.sessions.lock().await.keys().cloned());
            let cutoff = chrono::Utc::now() - chrono::Duration::days(i64::from(p.older_than_days));
            Ok(json!({"deleted": state.ctx.store.prune(cutoff, &keep).await?}))
        }
        "session.delete" => {
            let p: silence_protocol::SessionDeleteParams = serde_json::from_value(req.params)?;
            let mut deleted = Vec::new();
            for id in p.session_ids {
                if state.ctx.store.delete(&id).await? {
                    deleted.push(id);
                }
            }
            Ok(json!({"deleted": deleted}))
        }
        "engine.data_dir" => Ok(json!({"path": state.ctx.audit.dir().to_string_lossy()})),
        "session.resume" => session_resume(state.clone(), writer.clone(), req.params).await,
        "session.prompt" => {
            let p: PromptParams = serde_json::from_value(req.params)?;
            let text = match p.context.as_deref().map(str::trim) {
                Some(c) if !c.is_empty() => format!(
                    "{}\n\n<ui_context>\n{}\n</ui_context>",
                    p.text,
                    crate::redact::redact(c)
                ),
                _ => p.text,
            };
            crate::images::validate(&p.images)?;
            agent::prompt_with_images(state.ctx.clone(), p.session_id, text, p.images).await?;
            Ok(json!({"ok": true}))
        }
        "permissions.list" => {
            let ws = req.params.get("workspace").and_then(|v| v.as_str()).unwrap_or("");
            Ok(json!({"allow": agent::list_permissions(ws)?}))
        }
        "permissions.revoke" => {
            let ws = req.params.get("workspace").and_then(|v| v.as_str()).unwrap_or("");
            let entry = req.params.get("entry").and_then(|v| v.as_str()).unwrap_or("");
            agent::revoke_permission(&state.ctx, ws, entry).await?;
            Ok(json!({"allow": agent::list_permissions(ws)?}))
        }
        "session.set_mode" => {
            let sid = req.params.get("session_id").and_then(|v| v.as_str()).unwrap_or("");
            let mode: silence_protocol::SessionMode = serde_json::from_value(
                req.params.get("mode").cloned().unwrap_or_default(),
            )?;
            agent::set_mode(&state.ctx, sid, mode).await?;
            Ok(json!({"ok": true}))
        }
        "session.set_model" => {
            let sid = req.params.get("session_id").and_then(|v| v.as_str()).unwrap_or("");
            let model = req.params.get("model").and_then(|v| v.as_str()).unwrap_or("auto");
            let source = req.params.get("source").and_then(|v| v.as_str());
            agent::set_model(&state.ctx, sid, model, source).await?;
            Ok(json!({"ok": true}))
        }
        // The UI's per-thread spend, for a new live session of the same chat. Only raises it.
        "session.carry_spend" => {
            let sid = req.params.get("session_id").and_then(|v| v.as_str()).unwrap_or("");
            let usd = req.params.get("usd").and_then(|v| v.as_f64()).unwrap_or(0.0);
            agent::carry_spend(&state.ctx, sid, usd).await?;
            Ok(json!({"ok": true}))
        }
        // One more turn past the Auto spend cap (the UI's "Continue one turn").
        "session.budget_continue" => {
            let sid = req.params.get("session_id").and_then(|v| v.as_str()).unwrap_or("");
            agent::budget_continue(&state.ctx, sid).await?;
            Ok(json!({"ok": true}))
        }
        "session.set_effort" => {
            let p: silence_protocol::SetEffortParams = serde_json::from_value(req.params)?;
            agent::set_effort(&state.ctx, &p.session_id, &p.effort).await?;
            Ok(json!({"ok": true}))
        }
        "session.set_style" => {
            let p: silence_protocol::SetStyleParams = serde_json::from_value(req.params)?;
            agent::set_style(&state.ctx, &p.session_id, &p.style).await?;
            Ok(json!({"ok": true}))
        }
        "session.set_permission" => {
            let p: silence_protocol::SetPermissionParams = serde_json::from_value(req.params)?;
            agent::set_permission(&state.ctx, &p.session_id, p.permission).await?;
            Ok(json!({"ok": true}))
        }
        "session.abort" => {
            let sid = req
                .params
                .get("session_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            agent::abort(&state.ctx, sid).await?;
            Ok(json!({"ok": true}))
        }
        "session.permission" => {
            let p: PermissionDecision = serde_json::from_value(req.params)?;
            agent::decide_permission_scoped(
                &state.ctx,
                &p.session_id,
                &p.request_id,
                p.allow,
                p.effective_scope(),
            )
            .await?;
            Ok(json!({"ok": true}))
        }
        "session.approve_plan" => {
            let p: ApprovePlanParams = serde_json::from_value(req.params)?;
            agent::approve_plan(state.ctx.clone(), &p.session_id).await?;
            Ok(json!({"ok": true}))
        }
        "session.context" => {
            let sid = req.params.get("session_id").and_then(|v| v.as_str()).unwrap_or("");
            let mode: Option<silence_protocol::SessionMode> = match req.params.get("mode") {
                Some(v) if !v.is_null() => Some(serde_json::from_value(v.clone())?),
                _ => None,
            };
            let model = req.params.get("model").and_then(|v| v.as_str());
            Ok(serde_json::to_value(
                agent::context_usage(&state.ctx, sid, mode, model).await?,
            )?)
        }
        "chat.title" => {
            let p: ChatTitleParams = serde_json::from_value(req.params)?;
            let title =
                crate::title::generate_title(&state.ctx, &p.session_id, &p.user_text, &p.reply_text)
                    .await?;
            Ok(json!({"title": title}))
        }
        "models.list" => Ok(json!({
            "models": crate::providers::model_infos(&state.ctx.catalog).await,
            "default": "auto",
            "preferred": state.ctx.catalog.preferred(),
        })),
        "providers.status" => Ok(crate::providers::status(&state.ctx.catalog).await),
        "providers.cli_info" => Ok(serde_json::to_value(
            crate::providers::cli_info(&state.ctx.catalog, &state.ctx.audit).await?,
        )?),
        // Studio main process only (the renderer path is blocked in main). Never echoes the key.
        "providers.set_credential" => {
            let p: silence_protocol::SetCredentialParams = serde_json::from_value(req.params)?;
            state.ctx.catalog.set_credential(&p.provider, p.key.trim())?;
            Ok(json!({"ok": true}))
        }
        "eval.catalog" => state.evals.catalog(&state.ctx.catalog).await,
        "eval.estimate" => {
            let cfg: EvalConfig = serde_json::from_value(req.params)?;
            state.evals.estimate(&cfg, &state.ctx.catalog)
        }
        "eval.start" => {
            let cfg: EvalConfig = serde_json::from_value(req.params)?;
            let rx = state.evals.start(&cfg, &state.ctx.catalog)?;
            pump_eval(writer, rx);
            Ok(json!({"ok": true}))
        }
        "eval.cancel" => Ok(json!({"cancelled": state.evals.cancel()})),
        "eval.runs" => Ok(state.evals.runs(20)),
        "eval.task" => {
            let suite = req.params.get("suite").and_then(|v| v.as_str()).unwrap_or("");
            let task = req.params.get("task_id").and_then(|v| v.as_str()).unwrap_or("");
            let attempt = req.params.get("attempt").and_then(|v| v.as_u64()).map(|n| n as u32);
            state.evals.task_detail(suite, task, attempt)
        }
        "auto.set_config" => {
            let p: silence_protocol::SetAutoConfigParams = serde_json::from_value(req.params)?;
            state.ctx.catalog.set_auto(&p.provider, p.config)?;
            Ok(json!({"ok": true}))
        }
        "session.spend" => {
            let sid = req.params.get("session_id").and_then(|v| v.as_str()).unwrap_or("");
            Ok(agent::session_spend(&state.ctx, sid).await?)
        }
        "providers.set_preferred" => {
            let p: silence_protocol::SetPreferredParams = serde_json::from_value(req.params)?;
            state.ctx.catalog.set_preferred(&p.provider)?;
            Ok(json!({"ok": true}))
        }
        "fs.tree" => {
            let p: FsTreeParams = serde_json::from_value(req.params)?;
            let ws = Workspace::new(&p.workspace)?;
            let tree = silence_tools::tree(&ws, p.max_entries.unwrap_or(400)).await?;
            Ok(json!({"tree": tree}))
        }
        "fs.read" => {
            let p: FsReadParams = serde_json::from_value(req.params)?;
            let ws = Workspace::new(&p.workspace)?;
            let text = silence_tools::read_raw(&ws, &p.path).await?;
            Ok(json!({"text": text}))
        }
        "fs.read_image" => {
            let p: FsReadParams = serde_json::from_value(req.params)?;
            let ws = Workspace::new(&p.workspace)?;
            let img = silence_tools::read_image(&ws, &p.path)?;
            Ok(serde_json::to_value(silence_protocol::FsReadImageResult {
                path: img.path,
                mime: img.mime.to_string(),
                bytes: img.bytes,
                data_url: img.data_url,
            })?)
        }
        "diff.apply" => {
            let p: DiffApplyParams = serde_json::from_value(req.params)?;
            let output = agent::apply_diff(&state.ctx, &p.session_id, &p.path, &p.after).await?;
            Ok(json!({"ok": true, "output": output}))
        }
        "diff.reject" => {
            let p: DiffRejectParams = serde_json::from_value(req.params)?;
            agent::reject_diff(&state.ctx, &p.session_id, &p.path).await?;
            Ok(json!({"ok": true}))
        }
        // Settings → Tools. Per workspace (`.silence/mcp.json`); see `mcp_config`.
        "mcp.list" => crate::mcp_config::rpc_list(&state.ctx, &req.params).await,
        "mcp.add" => crate::mcp_config::rpc_add(&state.ctx, &req.params).await,
        "mcp.remove" => crate::mcp_config::rpc_remove(&state.ctx, &req.params).await,
        "mcp.set_enabled" => crate::mcp_config::rpc_set_enabled(&state.ctx, &req.params).await,
        "audit.query" => {
            let sid = req.params.get("session_id").and_then(|v| v.as_str());
            let limit = req
                .params
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(200) as usize;
            let events = state.ctx.audit.query(sid, limit)?;
            Ok(json!({"events": events}))
        }
        "cost.summary" => state.ctx.audit.cost_summary(),
        "terminal.start" => terminal_start(state, writer.clone(), req.params).await,
        "terminal.write" => {
            let p: TerminalWriteParams = serde_json::from_value(req.params)?;
            let term = state
                .terminals
                .lock()
                .await
                .get(&p.session_id)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("no terminal"))?;
            term.write(&p.data).await?;
            Ok(json!({"ok": true}))
        }
        other => Err(anyhow::anyhow!("unknown method {other}")),
    }
}

async fn session_create(state: Arc<RpcState>, writer: SharedWriter, params: Value) -> Result<Value> {
    let p: SessionCreateParams = serde_json::from_value(params)?;
    client_permission_allowed(p.permission)?;
    let id = agent::create_session(&state.ctx, &p.workspace, p.model, p.mode, p.permission).await?;
    // Approved MCP servers of this workspace come up with its first session.
    crate::mcp_config::autostart(&state.ctx, &p.workspace).await;
    if let Some(effort) = p.effort.as_deref() {
        agent::set_effort(&state.ctx, &id, effort).await?;
    }
    if let Some(style) = p.style.as_deref() {
        agent::set_style(&state.ctx, &id, style).await?;
    }
    let rx = agent::subscribe(&state.ctx, &id).await;
    pump_events(writer, id.clone(), rx);
    Ok(json!({"session_id": id}))
}

/// RPC clients may never open a YOLO session: it skips every permission check.
/// Only the in-process eval runner creates one (docs/security/permissions.md).
fn client_permission_allowed(mode: silence_protocol::PermissionMode) -> Result<()> {
    if mode == silence_protocol::PermissionMode::Yolo {
        anyhow::bail!("permission mode `yolo` is not allowed over RPC");
    }
    Ok(())
}

#[cfg(test)]
mod permission_mode_tests {
    use super::client_permission_allowed;
    use silence_protocol::PermissionMode;

    #[test]
    fn rpc_rejects_yolo_but_allows_others() {
        assert!(client_permission_allowed(PermissionMode::Yolo).is_err());
        assert!(client_permission_allowed(PermissionMode::Ask).is_ok());
        assert!(client_permission_allowed(PermissionMode::Allowlist).is_ok());
    }
}

async fn session_resume(state: Arc<RpcState>, writer: SharedWriter, params: Value) -> Result<Value> {
    let p: silence_protocol::SessionResumeParams = serde_json::from_value(params)?;
    let result = agent::resume_session(&state.ctx, &p.session_id).await?;
    let rx = agent::subscribe(&state.ctx, &p.session_id).await;
    pump_events(writer, p.session_id, rx);
    Ok(serde_json::to_value(result)?)
}

/// `eval.progress` notifications for a Studio eval run.
fn pump_eval(writer: SharedWriter, mut rx: mpsc::UnboundedReceiver<crate::eval_runner::EvalProgress>) {
    tokio::spawn(async move {
        while let Some(p) = rx.recv().await {
            let notice = RpcNotification::new("eval.progress", json!(p));
            if let Ok(v) = serde_json::to_value(&notice) {
                let _ = write_json(&writer, &v).await;
            }
        }
    });
}

fn pump_events(
    writer: SharedWriter,
    session_id: String,
    mut rx: mpsc::UnboundedReceiver<SessionEvent>,
) {
    tokio::spawn(async move {
        while let Some(ev) = rx.recv().await {
            let notice = RpcNotification::new(
                "session.event",
                json!({"session_id": session_id, "event": ev}),
            );
            if let Ok(v) = serde_json::to_value(&notice) {
                let _ = write_json(&writer, &v).await;
            }
        }
    });
}

async fn terminal_start(state: Arc<RpcState>, writer: SharedWriter, params: Value) -> Result<Value> {
    let p: TerminalStartParams = serde_json::from_value(params)?;
    let sessions = state.ctx.sessions.lock().await;
    let s = sessions
        .get(&p.session_id)
        .ok_or_else(|| anyhow::anyhow!("unknown session"))?
        .clone();
    drop(sessions);
    let cwd = s.lock().await.workspace.root.to_string_lossy().into_owned();
    let term = Arc::new(TerminalSession::start(
        &cwd,
        p.cols.unwrap_or(80),
        p.rows.unwrap_or(24),
    )?);
    state
        .terminals
        .lock()
        .await
        .insert(p.session_id.clone(), term.clone());
    let sid = p.session_id.clone();
    tokio::spawn(async move {
        loop {
            let mut rx = term.rx.lock().await;
            match rx.recv().await {
                Some(bytes) => {
                    drop(rx);
                    let data = String::from_utf8_lossy(&bytes).into_owned();
                    let notice = RpcNotification::new(
                        "session.event",
                        json!({"session_id": sid, "event": SessionEvent::Terminal { data }}),
                    );
                    if let Ok(v) = serde_json::to_value(&notice) {
                        let _ = write_json(&writer, &v).await;
                    }
                }
                None => break,
            }
        }
    });
    Ok(json!({"ok": true}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audit::AuditLog;
    use silence_router::Catalog;
    use std::time::Duration;
    use tokio::io::{duplex, split, AsyncBufReadExt, AsyncWriteExt, BufReader};

    /// Send one request line through `serve_connection` and return the parsed reply.
    async fn roundtrip(line: &str) -> Value {
        let data = tempfile::tempdir().unwrap();
        let raw = serde_json::from_value(json!({
            "version": 1, "providers": [], "models": []
        }))
        .unwrap();
        let ctx = Arc::new(AppCtx::new(
            Catalog::from_raw(raw),
            AuditLog::open(data.path()).unwrap(),
        ));
        let state = Arc::new(RpcState::new(ctx));

        let (client, server) = duplex(64 * 1024);
        let (sr, sw) = split(server);
        tokio::spawn(serve_connection(state, sr, sw));

        let (cr, mut cw) = split(client);
        cw.write_all(format!("{line}\n").as_bytes()).await.unwrap();
        let mut lines = BufReader::new(cr).lines();
        // A missing reply is exactly the bug this guards against, so fail instead of hanging.
        let reply = tokio::time::timeout(Duration::from_secs(3), lines.next_line())
            .await
            .expect("engine must reply to a failing request, not stay silent")
            .unwrap()
            .expect("connection closed without a reply");
        serde_json::from_str(&reply).unwrap()
    }

    #[tokio::test]
    async fn prompt_on_unknown_session_returns_error_response() {
        let v = roundtrip(
            r#"{"jsonrpc":"2.0","id":7,"method":"session.prompt","params":{"session_id":"nope","text":"hi"}}"#,
        )
        .await;
        assert_eq!(v["id"], 7);
        assert!(
            v["error"]["message"].as_str().unwrap().contains("unknown session"),
            "got {v}"
        );
    }

    #[tokio::test]
    async fn malformed_params_return_error_response() {
        let v = roundtrip(
            r#"{"jsonrpc":"2.0","id":8,"method":"session.prompt","params":{"session_id":5}}"#,
        )
        .await;
        assert_eq!(v["id"], 8);
        assert!(v["error"]["message"].is_string(), "got {v}");
    }

    #[tokio::test]
    async fn chat_title_errors_without_text_or_fast_model() {
        let v = roundtrip(r#"{"jsonrpc":"2.0","id":9,"method":"chat.title","params":{}}"#).await;
        assert_eq!(v["id"], 9);
        assert!(v["error"]["message"].is_string(), "got {v}");
        // Empty catalog: no `fast` tier, so the engine must reply with an error, not hang.
        let v = roundtrip(
            r#"{"jsonrpc":"2.0","id":10,"method":"chat.title","params":{"user_text":"hi"}}"#,
        )
        .await;
        assert_eq!(v["id"], 10);
        assert!(v["error"]["message"].is_string(), "got {v}");
    }

    #[tokio::test]
    async fn ping_still_ok() {
        let v = roundtrip(r#"{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}"#).await;
        assert_eq!(v["result"]["ok"], true);
    }
}
