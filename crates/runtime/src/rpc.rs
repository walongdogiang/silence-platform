use crate::agent::{self, AppCtx};
use crate::pty::TerminalSession;
use anyhow::Result;
use serde_json::{json, Value};
use silence_protocol::{
    ApprovePlanParams, DiffApplyParams, DiffRejectParams, FsReadParams, FsTreeParams,
    McpServerConfig, PermissionDecision, PromptParams, RpcNotification, RpcRequest, RpcResponse,
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
}

impl RpcState {
    pub fn new(ctx: Arc<AppCtx>) -> Self {
        Self {
            ctx,
            terminals: Mutex::new(HashMap::new()),
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
    let result = match req.method.as_str() {
        "ping" => Ok(json!({"ok": true, "protocol": silence_protocol::PROTOCOL_VERSION})),
        "session.create" => session_create(state.clone(), writer.clone(), req.params).await,
        "session.prompt" => {
            let p: PromptParams = serde_json::from_value(req.params)?;
            agent::prompt(state.ctx.clone(), p.session_id, p.text).await?;
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
            agent::decide_permission(
                &state.ctx,
                &p.session_id,
                &p.request_id,
                p.allow,
                p.remember,
            )
            .await?;
            Ok(json!({"ok": true}))
        }
        "session.approve_plan" => {
            let p: ApprovePlanParams = serde_json::from_value(req.params)?;
            agent::approve_plan(&state.ctx, &p.session_id).await?;
            Ok(json!({"ok": true}))
        }
        "models.list" => Ok(json!({"models": state.ctx.catalog.infos(), "default": "auto"})),
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
        "mcp.list" => Ok(json!({"servers": state.ctx.mcp.list().await})),
        "mcp.add" => {
            let cfg: McpServerConfig = serde_json::from_value(req.params)?;
            let tools = state.ctx.mcp.add(cfg).await?;
            Ok(json!({
                "tools": tools.iter().map(|t| json!({"name": t.name, "description": t.description})).collect::<Vec<_>>()
            }))
        }
        "mcp.remove" => {
            let name = req
                .params
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            state.ctx.mcp.remove(name).await;
            Ok(json!({"ok": true}))
        }
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
    };
    let resp = match result {
        Ok(v) => RpcResponse::ok(id, v),
        Err(err) => RpcResponse::err(id, -32000, err.to_string()),
    };
    write_json(&writer, &serde_json::to_value(&resp)?).await
}

async fn session_create(state: Arc<RpcState>, writer: SharedWriter, params: Value) -> Result<Value> {
    let p: SessionCreateParams = serde_json::from_value(params)?;
    let id = agent::create_session(&state.ctx, &p.workspace, p.model, p.mode, p.permission).await?;
    let rx = agent::subscribe(&state.ctx, &id).await;
    pump_events(writer, id.clone(), rx);
    Ok(json!({"session_id": id}))
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
