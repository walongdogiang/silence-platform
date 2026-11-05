use crate::audit::{now_event, AuditLog};
use crate::compact::{compact_if_needed, messages_tokens};
use crate::gateway::{self, ToolCall};
use crate::org::{self, OrgContext};
use crate::redact::redact;
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use silence_mcp::McpHost;
use silence_protocol::{PermissionMode, SessionEvent, SessionMode};
use silence_router::{self, Catalog};
use silence_tools::{self, Workspace};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex};
use uuid::Uuid;

const SYSTEM: &str = r#"You are 5ilence, an internal AI engineer. You work in a local workspace on Windows.
Use tools to read, search, and edit. Prefer grep/read before editing. Do not invent file contents.
Never commit unless asked. Never exfiltrate secrets. Apply the smallest correct change.
When plan mode is on, only gather context and call submit_plan — do not edit.

## User-facing response formatting
- Write user-facing answers in Markdown.
- Match the length and structure to the request. Answer simple questions directly and concisely.
- Use headings, lists, tables, and code fences only when they improve clarity.
- Prefer ## and ### for headings when needed. Do not wrap the entire response in a code fence unless explicitly requested.
- Use fenced code blocks for multiline code and inline code for file paths, identifiers, and short commands.
- Follow explicit user requests for JSON, plain text, code-only output, or other formats.
- Use the appropriate tool schema or structured output format when a task requires machine-readable data.
- Do not dump raw tool or runtime output into the answer; summarize what matters for the user. The product shows tool details separately.
"#;

#[derive(Debug, Clone)]
pub struct PendingEdit {
    pub before: String,
    pub after: String,
    pub tool: String,
}

pub struct Session {
    pub id: String,
    pub workspace: Workspace,
    pub mode: SessionMode,
    pub permission: PermissionMode,
    pub model: String,
    pub messages: Vec<Value>,
    pub org: OrgContext,
    pub allowlist: Vec<String>,
    pub pending_perm: HashMap<String, oneshot::Sender<bool>>,
    /// Staged file proposals awaiting `diff.apply` / `diff.reject`.
    pub pending_edits: HashMap<String, PendingEdit>,
    pub last_plan: Option<String>,
    pub abort: bool,
}

pub struct AppCtx {
    pub catalog: Catalog,
    pub mcp: McpHost,
    pub audit: AuditLog,
    pub sessions: Mutex<HashMap<String, Arc<Mutex<Session>>>>,
    pub events: Mutex<HashMap<String, mpsc::UnboundedSender<SessionEvent>>>,
}

impl AppCtx {
    pub fn new(catalog: Catalog, audit: AuditLog) -> Self {
        Self {
            catalog,
            mcp: McpHost::new(),
            audit,
            sessions: Mutex::new(HashMap::new()),
            events: Mutex::new(HashMap::new()),
        }
    }
}

pub async fn create_session(
    ctx: &AppCtx,
    workspace: &str,
    model: Option<String>,
    mode: SessionMode,
    permission: PermissionMode,
) -> Result<String> {
    let ws = Workspace::new(workspace)?;
    let org = org::load(&ws.root).unwrap_or_default();
    let id = Uuid::new_v4().to_string();
    let mut system = SYSTEM.to_string();
    system.push_str(&org::system_append(&org));
    let session = Session {
        id: id.clone(),
        workspace: ws,
        mode,
        permission,
        model: model.unwrap_or_else(|| "auto".into()),
        messages: vec![json!({"role":"system","content": system})],
        org,
        allowlist: Vec::new(),
        pending_perm: HashMap::new(),
        pending_edits: HashMap::new(),
        last_plan: None,
        abort: false,
    };
    ctx.sessions
        .lock()
        .await
        .insert(id.clone(), Arc::new(Mutex::new(session)));
    Ok(id)
}

pub async fn subscribe(ctx: &AppCtx, session_id: &str) -> mpsc::UnboundedReceiver<SessionEvent> {
    let (tx, rx) = mpsc::unbounded_channel();
    ctx.events.lock().await.insert(session_id.to_string(), tx);
    rx
}

fn emit(tx: &Option<mpsc::UnboundedSender<SessionEvent>>, ev: SessionEvent) {
    if let Some(t) = tx {
        let _ = t.send(ev);
    }
}

pub async fn prompt(ctx: Arc<AppCtx>, session_id: String, text: String) -> Result<()> {
    let session_arc = ctx
        .sessions
        .lock()
        .await
        .get(&session_id)
        .cloned()
        .ok_or_else(|| anyhow!("unknown session"))?;
    let tx = ctx.events.lock().await.get(&session_id).cloned();
    tokio::spawn(async move {
        if let Err(err) = run_turn(ctx, session_arc, text, tx.clone()).await {
            emit(&tx, SessionEvent::Error {
                message: err.to_string(),
            });
        }
    });
    Ok(())
}

async fn run_turn(
    ctx: Arc<AppCtx>,
    session_arc: Arc<Mutex<Session>>,
    text: String,
    tx: Option<mpsc::UnboundedSender<SessionEvent>>,
) -> Result<()> {
    {
        let mut s = session_arc.lock().await;
        s.abort = false;
        s.messages
            .push(json!({"role":"user","content": redact(&text)}));
    }
    let mut empty_streak = 0;
    let mut loops = 0;
    loop {
        loops += 1;
        if loops > 24 {
            emit(
                &tx,
                SessionEvent::Error {
                    message: "tool loop stuck".into(),
                },
            );
            break;
        }
        let (model_id, task_class, reason, read_only, context_window) = {
            let s = session_arc.lock().await;
            if s.abort {
                emit(
                    &tx,
                    SessionEvent::Done {
                        stop: "abort".into(),
                    },
                );
                return Ok(());
            }
            let last = text.as_str();
            let decision = silence_router::route(&ctx.catalog, &s.model, last)?;
            let model = ctx.catalog.resolve(&decision.model_id)?;
            (
                decision.model_id,
                decision.task_class.as_str().to_string(),
                decision.reason,
                s.mode == SessionMode::Plan,
                model.context_window,
            )
        };
        emit(
            &tx,
            SessionEvent::Route {
                task_class: task_class.clone(),
                model_id: model_id.clone(),
                reason: reason.clone(),
            },
        );
        let _ = ctx
            .audit
            .append(now_event(
                &session_arc.lock().await.id,
                "route",
                &model_id,
                "",
                "",
                0,
                0,
                0.0,
                json!({"reason": reason, "class": task_class}),
            ))
            .await;

        let (messages, tools) = {
            let mut s = session_arc.lock().await;
            compact_if_needed(&mut s.messages, context_window);
            let mut tools = silence_tools::openai_tools(read_only);
            if read_only {
                let arr = tools.as_array_mut().unwrap();
                arr.push(json!({
                    "type": "function",
                    "function": {
                        "name": "submit_plan",
                        "description": "Submit an implementation plan. Do not edit files.",
                        "parameters": {
                            "type": "object",
                            "properties": {"markdown": {"type": "string"}},
                            "required": ["markdown"]
                        }
                    }
                }));
            }
            arr_extend_mcp(&ctx, &mut tools).await;
            arr_extend_task(&mut tools, read_only);
            (s.messages.clone(), tools)
        };

        let mut token_buf = String::new();
        let result = gateway::chat(
            &ctx.catalog,
            &model_id,
            &messages,
            &tools,
            |tok| {
                token_buf.push_str(tok);
                emit(&tx, SessionEvent::Token { text: tok.to_string() });
            },
            |th| {
                emit(
                    &tx,
                    SessionEvent::Thinking {
                        text: th.to_string(),
                    },
                );
            },
        )
        .await;

        let result = match result {
            Ok(r) => r,
            Err(err) => {
                let upgraded = silence_router::escalate(&ctx.catalog, "timeout")?;
                if upgraded != model_id {
                    emit(
                        &tx,
                        SessionEvent::Trace {
                            event: "escalate".into(),
                            detail: json!({"from": model_id, "to": upgraded, "err": err.to_string()}),
                        },
                    );
                    gateway::chat(
                        &ctx.catalog,
                        &upgraded,
                        &messages,
                        &tools,
                        |tok| {
                            emit(&tx, SessionEvent::Token { text: tok.to_string() });
                        },
                        |th| {
                            emit(
                                &tx,
                                SessionEvent::Thinking {
                                    text: th.to_string(),
                                },
                            );
                        },
                    )
                    .await?
                } else {
                    return Err(err);
                }
            }
        };

        let model_entry = ctx.catalog.resolve(&model_id)?;
        let usd = gateway::cost_usd(&model_entry, result.input_tokens, result.output_tokens);
        emit(
            &tx,
            SessionEvent::Cost {
                input_tokens: result.input_tokens,
                output_tokens: result.output_tokens,
                usd,
            },
        );
        let sid = session_arc.lock().await.id.clone();
        let _ = ctx
            .audit
            .append(now_event(
                &sid,
                "completion",
                &model_id,
                "",
                "",
                result.input_tokens,
                result.output_tokens,
                usd,
                json!({"finish": result.finish_reason}),
            ))
            .await;

        if result.tool_calls.is_empty() {
            {
                let mut s = session_arc.lock().await;
                s.messages.push(json!({
                    "role": "assistant",
                    "content": result.content,
                }));
            }
            if result.content.trim().is_empty() {
                empty_streak += 1;
                if empty_streak >= 2 {
                    let _ = silence_router::escalate(&ctx.catalog, "empty_output");
                }
            }
            emit(
                &tx,
                SessionEvent::Done {
                    stop: result.finish_reason,
                },
            );
            return Ok(());
        }

        let mut assistant_tools = Vec::new();
        for tc in &result.tool_calls {
            assistant_tools.push(json!({
                "id": tc.id,
                "type": "function",
                "function": {"name": tc.name, "arguments": tc.arguments}
            }));
        }
        {
            let mut s = session_arc.lock().await;
            s.messages.push(json!({
                "role": "assistant",
                "content": result.content,
                "tool_calls": assistant_tools
            }));
        }

        for tc in result.tool_calls {
            let output = dispatch_tool(&ctx, &session_arc, &tx, &tc).await;
            let text = match output {
                Ok(t) => t,
                Err(e) => format!("ERROR: {e}"),
            };
            let mut s = session_arc.lock().await;
            s.messages.push(json!({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": redact(&text)
            }));
        }
        let _ = messages_tokens;
    }
    Ok(())
}

async fn arr_extend_mcp(ctx: &AppCtx, tools: &mut Value) {
    let extra = ctx.mcp.all_tools().await;
    if let Some(arr) = tools.as_array_mut() {
        for (server, tool) in extra {
            arr.push(json!({
                "type": "function",
                "function": {
                    "name": format!("mcp__{}__{}", server, tool.name),
                    "description": tool.description,
                    "parameters": tool.schema
                }
            }));
        }
    }
}

fn arr_extend_task(tools: &mut Value, plan: bool) {
    if plan {
        return;
    }
    if let Some(arr) = tools.as_array_mut() {
        arr.push(json!({
            "type": "function",
            "function": {
                "name": "task",
                "description": "Delegate to a sub-agent: explore (read-only, fast), implement, or review (read-only, strong).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "subagent_type": {"type": "string", "enum": ["explore","implement","review"]},
                        "prompt": {"type": "string"}
                    },
                    "required": ["subagent_type", "prompt"]
                }
            }
        }));
    }
}

async fn dispatch_tool(
    ctx: &AppCtx,
    session_arc: &Arc<Mutex<Session>>,
    tx: &Option<mpsc::UnboundedSender<SessionEvent>>,
    tc: &ToolCall,
) -> Result<String> {
    let args: Value = serde_json::from_str(&tc.arguments).unwrap_or(json!({}));
    emit(
        tx,
        SessionEvent::ToolStart {
            call_id: tc.id.clone(),
            name: tc.name.clone(),
            input: args.clone(),
        },
    );
    if tc.name == "submit_plan" {
        let md = args
            .get("markdown")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        session_arc.lock().await.last_plan = Some(md.clone());
        emit(tx, SessionEvent::Plan { markdown: md.clone() });
        emit(
            tx,
            SessionEvent::ToolEnd {
                call_id: tc.id.clone(),
                name: tc.name.clone(),
                ok: true,
                output: "plan submitted; waiting for user approve".into(),
            },
        );
        return Ok("plan submitted".into());
    }
    if let Some(rest) = tc.name.strip_prefix("mcp__") {
        let mut parts = rest.splitn(2, "__");
        let server = parts.next().unwrap_or("");
        let tool = parts.next().unwrap_or("");
        let allowed = ask_perm(ctx, session_arc, tx, &tc.name, &args).await?;
        if !allowed {
            return Ok("permission denied".into());
        }
        let out = ctx.mcp.call(server, tool, args).await?;
        emit(
            tx,
            SessionEvent::ToolEnd {
                call_id: tc.id.clone(),
                name: tc.name.clone(),
                ok: true,
                output: out.clone(),
            },
        );
        return Ok(out);
    }
    if tc.name == "task" {
        let kind = args
            .get("subagent_type")
            .and_then(|v| v.as_str())
            .unwrap_or("explore");
        let prompt = args
            .get("prompt")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let out = run_subagent(ctx, session_arc, kind, &prompt, tx).await?;
        emit(
            tx,
            SessionEvent::ToolEnd {
                call_id: tc.id.clone(),
                name: tc.name.clone(),
                ok: true,
                output: out.clone(),
            },
        );
        return Ok(out);
    }
    if silence_tools::mutates(&tc.name) {
        let allowed = ask_perm(ctx, session_arc, tx, &tc.name, &args).await?;
        if !allowed {
            return Ok("permission denied".into());
        }
        if tc.name == "shell" {
            let payload = args.to_string();
            let org = session_arc.lock().await.org.clone();
            let _ = org::run_hook(&org, "beforeShell", &payload).await;
        }
    }

    // Product Ask/Allowlist path: stage write/edit until Apply. YOLO (evals) still commits.
    let permission = session_arc.lock().await.permission;
    let stage_files = matches!(tc.name.as_str(), "write" | "edit")
        && !matches!(permission, PermissionMode::Yolo);
    if stage_files {
        return stage_file_tool(ctx, session_arc, tx, tc, &args).await;
    }

    let ws = session_arc.lock().await.workspace.clone();
    let result = silence_tools::execute(&ws, &tc.name, &args).await;
    match result {
        Ok(out) => {
            if let Some(diff) = &out.diff {
                emit(
                    tx,
                    SessionEvent::Diff {
                        path: diff.path.clone(),
                        before: diff.before.clone(),
                        after: diff.after.clone(),
                    },
                );
                let org = session_arc.lock().await.org.clone();
                let _ = org::run_hook(&org, "afterFileEdit", &diff.path).await;
            }
            let sid = session_arc.lock().await.id.clone();
            let path = out
                .diff
                .as_ref()
                .map(|d| d.path.clone())
                .unwrap_or_default();
            let _ = ctx
                .audit
                .append(now_event(
                    &sid,
                    "tool",
                    "",
                    &tc.name,
                    &path,
                    0,
                    0,
                    0.0,
                    json!({"ok": out.ok}),
                ))
                .await;
            emit(
                tx,
                SessionEvent::ToolEnd {
                    call_id: tc.id.clone(),
                    name: tc.name.clone(),
                    ok: out.ok,
                    output: out.output.clone(),
                },
            );
            Ok(out.output)
        }
        Err(err) => {
            emit(
                tx,
                SessionEvent::ToolEnd {
                    call_id: tc.id.clone(),
                    name: tc.name.clone(),
                    ok: false,
                    output: err.to_string(),
                },
            );
            Err(err)
        }
    }
}

async fn stage_file_tool(
    ctx: &AppCtx,
    session_arc: &Arc<Mutex<Session>>,
    tx: &Option<mpsc::UnboundedSender<SessionEvent>>,
    tc: &ToolCall,
    args: &Value,
) -> Result<String> {
    let ws = session_arc.lock().await.workspace.clone();
    let result = match tc.name.as_str() {
        "write" => silence_tools::stage_write(&ws, args),
        "edit" => silence_tools::stage_edit(&ws, args),
        other => Err(anyhow!("not a staging tool: {other}")),
    };
    match result {
        Ok(out) => {
            if let Some(diff) = &out.diff {
                {
                    let mut s = session_arc.lock().await;
                    s.pending_edits.insert(
                        diff.path.clone(),
                        PendingEdit {
                            before: diff.before.clone(),
                            after: diff.after.clone(),
                            tool: tc.name.clone(),
                        },
                    );
                }
                emit(
                    tx,
                    SessionEvent::Diff {
                        path: diff.path.clone(),
                        before: diff.before.clone(),
                        after: diff.after.clone(),
                    },
                );
            }
            let sid = session_arc.lock().await.id.clone();
            let path = out
                .diff
                .as_ref()
                .map(|d| d.path.clone())
                .unwrap_or_default();
            let _ = ctx
                .audit
                .append(now_event(
                    &sid,
                    "tool",
                    "",
                    &tc.name,
                    &path,
                    0,
                    0,
                    0.0,
                    json!({"ok": out.ok, "staged": true}),
                ))
                .await;
            let message = if path.is_empty() {
                out.output.clone()
            } else {
                format!("proposed edit for {path}; waiting for user Apply/Reject")
            };
            emit(
                tx,
                SessionEvent::ToolEnd {
                    call_id: tc.id.clone(),
                    name: tc.name.clone(),
                    ok: out.ok,
                    output: message.clone(),
                },
            );
            Ok(message)
        }
        Err(err) => {
            emit(
                tx,
                SessionEvent::ToolEnd {
                    call_id: tc.id.clone(),
                    name: tc.name.clone(),
                    ok: false,
                    output: err.to_string(),
                },
            );
            Err(err)
        }
    }
}

/// Commit a staged (or client-supplied) file edit via tools commit path + audit.
pub async fn apply_diff(ctx: &AppCtx, session_id: &str, path: &str, after: &str) -> Result<String> {
    let session_arc = ctx
        .sessions
        .lock()
        .await
        .get(session_id)
        .cloned()
        .ok_or_else(|| anyhow!("unknown session"))?;
    let (ws, contents, tool, had_pending) = {
        let mut s = session_arc.lock().await;
        if let Some(pending) = s.pending_edits.remove(path) {
            (
                s.workspace.clone(),
                pending.after,
                pending.tool,
                true,
            )
        } else {
            (
                s.workspace.clone(),
                after.to_string(),
                "write".to_string(),
                false,
            )
        }
    };
    let args = json!({"path": path, "contents": contents});
    let out = silence_tools::commit_staged(&ws, &args)?;
    let org = session_arc.lock().await.org.clone();
    let _ = org::run_hook(&org, "afterFileEdit", path).await;
    let _ = ctx
        .audit
        .append(now_event(
            session_id,
            "diff.apply",
            "",
            &tool,
            path,
            0,
            0,
            0.0,
            json!({"ok": out.ok, "had_pending": had_pending}),
        ))
        .await;
    Ok(out.output)
}

/// Drop a staged edit without writing disk.
pub async fn reject_diff(ctx: &AppCtx, session_id: &str, path: &str) -> Result<()> {
    let session_arc = ctx
        .sessions
        .lock()
        .await
        .get(session_id)
        .cloned()
        .ok_or_else(|| anyhow!("unknown session"))?;
    let mut s = session_arc.lock().await;
    s.pending_edits.remove(path);
    let _ = silence_tools::reject_staged(&s.workspace, path);
    Ok(())
}

async fn ask_perm(
    _ctx: &AppCtx,
    session_arc: &Arc<Mutex<Session>>,
    tx: &Option<mpsc::UnboundedSender<SessionEvent>>,
    name: &str,
    args: &Value,
) -> Result<bool> {
    let (mode, remember_key) = {
        let s = session_arc.lock().await;
        let key = format!("{name}:{}", args);
        (s.permission, key)
    };
    match mode {
        PermissionMode::Yolo => Ok(true),
        PermissionMode::Allowlist => {
            let s = session_arc.lock().await;
            Ok(s.allowlist.iter().any(|k| k == name || remember_key.starts_with(k)))
        }
        PermissionMode::Ask => {
            {
                let s = session_arc.lock().await;
                if s.allowlist.iter().any(|k| k == name) {
                    return Ok(true);
                }
            }
            let (ptx, prx) = oneshot::channel();
            let request_id = Uuid::new_v4().to_string();
            session_arc
                .lock()
                .await
                .pending_perm
                .insert(request_id.clone(), ptx);
            emit(
                tx,
                SessionEvent::Permission {
                    request_id: request_id.clone(),
                    name: name.into(),
                    input: args.clone(),
                    reason: "mutating tool".into(),
                },
            );
            Ok(prx.await.unwrap_or(false))
        }
    }
}

pub async fn decide_permission(
    ctx: &AppCtx,
    session_id: &str,
    request_id: &str,
    allow: bool,
    remember: bool,
    name_hint: Option<String>,
) -> Result<()> {
    let session = ctx
        .sessions
        .lock()
        .await
        .get(session_id)
        .cloned()
        .ok_or_else(|| anyhow!("unknown session"))?;
    let mut s = session.lock().await;
    if remember {
        if let Some(n) = name_hint {
            s.allowlist.push(n);
        }
    }
    if let Some(tx) = s.pending_perm.remove(request_id) {
        let _ = tx.send(allow);
    }
    Ok(())
}

pub async fn approve_plan(ctx: &AppCtx, session_id: &str) -> Result<()> {
    let session = ctx
        .sessions
        .lock()
        .await
        .get(session_id)
        .cloned()
        .ok_or_else(|| anyhow!("unknown session"))?;
    let mut s = session.lock().await;
    s.mode = SessionMode::Agent;
    let plan = s.last_plan.clone();
    if let Some(plan) = plan {
        s.messages.push(json!({
            "role": "user",
            "content": format!("Plan approved. Implement it.\n\n{plan}")
        }));
    }
    Ok(())
}

pub async fn abort(ctx: &AppCtx, session_id: &str) -> Result<()> {
    if let Some(s) = ctx.sessions.lock().await.get(session_id) {
        s.lock().await.abort = true;
    }
    Ok(())
}

async fn run_subagent(
    ctx: &AppCtx,
    parent: &Arc<Mutex<Session>>,
    kind: &str,
    prompt: &str,
    tx: &Option<mpsc::UnboundedSender<SessionEvent>>,
) -> Result<String> {
    emit(
        tx,
        SessionEvent::Trace {
            event: "subagent.start".into(),
            detail: json!({"kind": kind, "prompt": prompt}),
        },
    );
    let (workspace, parent_id) = {
        let p = parent.lock().await;
        (p.workspace.root.clone(), p.id.clone())
    };
    let (model, read_only) = match kind {
        "explore" => (ctx.catalog.by_tier("fast")?.id.clone(), true),
        "review" => (ctx.catalog.by_tier("strong")?.id.clone(), true),
        _ => (ctx.catalog.by_tier("mid")?.id.clone(), false),
    };
    let ws = Workspace::new(&workspace)?;
    let tools = silence_tools::openai_tools(read_only);
    let messages = vec![
        json!({"role":"system","content": format!("{SYSTEM}\nYou are a {kind} sub-agent. You cannot spawn sub-agents. Return a concise summary.")}),
        json!({"role":"user","content": prompt}),
    ];
    let mut acc = String::new();
    let mut msgs = messages;
    let result = gateway::chat(&ctx.catalog, &model, &msgs, &tools, |_| {}, |_| {}).await?;
    acc.push_str(&result.content);
    if !result.tool_calls.is_empty() {
        msgs.push(json!({
            "role": "assistant",
            "content": result.content,
            "tool_calls": result.tool_calls.iter().map(|tc| json!({
                "id": tc.id,
                "type": "function",
                "function": {"name": tc.name, "arguments": tc.arguments}
            })).collect::<Vec<_>>()
        }));
        for tc in result.tool_calls {
            let args: Value = serde_json::from_str(&tc.arguments).unwrap_or(json!({}));
            let out = if silence_tools::mutates(&tc.name) && read_only {
                "read-only subagent cannot mutate".into()
            } else {
                silence_tools::execute(&ws, &tc.name, &args)
                    .await
                    .map(|o| o.output)
                    .unwrap_or_else(|e| e.to_string())
            };
            msgs.push(json!({"role":"tool","tool_call_id": tc.id, "content": redact(&out)}));
        }
        let result2 = gateway::chat(&ctx.catalog, &model, &msgs, &tools, |_| {}, |_| {}).await?;
        acc.push('\n');
        acc.push_str(&result2.content);
    }
    let _ = ctx
        .audit
        .append(now_event(
            &parent_id,
            "subagent",
            &model,
            kind,
            "",
            0,
            0,
            0.0,
            json!({"kind": kind}),
        ))
        .await;
    emit(
        tx,
        SessionEvent::Trace {
            event: "subagent.done".into(),
            detail: json!({"kind": kind}),
        },
    );
    Ok(acc)
}
