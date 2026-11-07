use crate::audit::{now_event, AuditLog};
use crate::compact::{compact_if_needed, messages_tokens};
use crate::gateway::{self, ToolCall};
use crate::org::{self, OrgContext};
use crate::permissions;
use crate::provider_error::{sanitize, ErrorCode, ProviderError};
use crate::redact::redact;
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use silence_mcp::McpHost;
use silence_protocol::{ErrorInfo, PermissionMode, SessionEvent, SessionMode};
use silence_router::{self, Catalog};
use silence_tools::{self, Workspace};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex};
use uuid::Uuid;

const SYSTEM: &str = r#"You are 5ilence, an internal AI engineer. You work in a local workspace on Windows.
Use tools to read, search, and edit. Prefer grep/read before editing. Do not invent file contents.
Never commit unless asked. Never exfiltrate secrets. Apply the smallest correct change.

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

/// What a session mode changes in the loop. The mode is re-read every turn
/// (`session.set_mode`), so its instructions are injected per call, not stored in history.
pub struct ModeProfile {
    pub read_only: bool,
    pub submit_plan: bool,
    /// Tier to use when the session model is `auto`.
    pub tier: Option<&'static str>,
    pub system: &'static str,
}

pub fn profile(mode: SessionMode) -> ModeProfile {
    let (submit_plan, tier, system) = match mode {
        SessionMode::Agent => (false, None, ""),
        SessionMode::Plan => (
            true,
            None,
            "## Mode: Plan\nOnly gather context with read-only tools, then call submit_plan with a concrete step-by-step plan (files, changes, how to verify). Do not edit. If the user gives feedback on a plan, revise it and call submit_plan again.",
        ),
        SessionMode::Ask => (
            false,
            None,
            "## Mode: Ask\nAnswer questions about the code using read-only tools. Never edit, write, or run shell. If the user wants a change, explain what you would change and tell them to switch to Agent mode.",
        ),
        SessionMode::Debug => (
            false,
            Some("strong"),
            "## Mode: Debug\nWork evidence-first: 1) reproduce or locate the failure (read logs in <ui_context>, run the failing test/command with shell), 2) state hypotheses, 3) confirm one with evidence (logs, test output, code reading), 4) make the smallest fix, 5) re-run to verify. Do not edit before you have evidence. Report root cause, fix, and verification result.",
        ),
        SessionMode::Review => (
            false,
            Some("strong"),
            "## Mode: Review\nReview code; never edit. Default scope: uncommitted changes (git_status, git_diff); otherwise the files or paths the user names. Read surrounding code before judging. Report findings ordered by severity (bug, security, correctness, then maintainability), each with `path:line`, the concrete failure scenario, and a suggested fix. Skip style nits unless asked. If nothing is wrong, say so. End by offering to apply fixes in Agent mode.",
        ),
        SessionMode::Multitask => (
            false,
            None,
            "## Mode: MultiTask\nSplit the request into independent sub-tasks that touch different files. Delegate each to a sub-agent with the task tool (implement for changes, explore for research), giving each a self-contained prompt. Do sequential or overlapping work yourself. Finish with a short per-sub-task summary: what changed, what is left.",
        ),
    };
    ModeProfile {
        read_only: mode.read_only(),
        submit_plan,
        tier,
        system,
    }
}

/// History with the mode instructions appended to the system message (not persisted).
fn with_mode_system(messages: &[Value], extra: &str) -> Vec<Value> {
    let mut out = messages.to_vec();
    if extra.is_empty() {
        return out;
    }
    if let Some(first) = out.first_mut() {
        if first.get("role").and_then(|r| r.as_str()) == Some("system") {
            let base = first.get("content").and_then(|c| c.as_str()).unwrap_or("");
            first["content"] = Value::String(format!("{base}\n\n{extra}"));
        }
    }
    out
}

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
    /// request_id → (tool name, decision channel). The name is resolved here, server-side,
    /// so `session.permission` never trusts a client-supplied tool name (T-01-09).
    /// The allowlist entry to store on "remember" (`edit:src/**` or a bare tool name) is
    /// computed here from the real tool args, never taken from the client.
    pub pending_perm: HashMap<String, (String, String, oneshot::Sender<bool>)>,
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
    let allowlist = permissions::load(&ws.root).unwrap_or_default();
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
        allowlist,
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
            emit(&tx, error_event(&err));
        }
    });
    Ok(())
}

/// Lỗi lượt → event có cấu trúc. Không đưa raw body ra ngoài.
fn error_event(err: &anyhow::Error) -> SessionEvent {
    let (code, status, detail) = match err.downcast_ref::<ProviderError>() {
        Some(pe) => (pe.code, pe.status, pe.detail.clone()),
        None => (ErrorCode::Unknown, None, sanitize(&format!("{err:#}"), "")),
    };
    SessionEvent::Error {
        message: format!("turn failed: {}", code.as_str()),
        error: Some(ErrorInfo {
            code: code.as_str().to_string(),
            status,
            retryable: code.retryable(),
            detail,
        }),
    }
}

/// Lỗi ngay ở lần gọi model đầu tiên → bỏ câu hỏi vừa push để user gửi lại không bị nhân đôi.
async fn rollback_user_message(session_arc: &Arc<Mutex<Session>>, loops: u32, text: &str) {
    if loops != 1 {
        return;
    }
    let mut s = session_arc.lock().await;
    let is_ours = s.messages.last().is_some_and(|m| {
        m.get("role").and_then(|r| r.as_str()) == Some("user")
            && m.get("content").and_then(|c| c.as_str()) == Some(redact(text).as_str())
    });
    if is_ours {
        s.messages.pop();
    }
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
    let mut loops: u32 = 0;
    loop {
        loops += 1;
        if loops > 24 {
            emit(
                &tx,
                SessionEvent::Error {
                    message: "tool loop stuck".into(),
                    error: None,
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
            let mut decision = silence_router::route(&ctx.catalog, &s.model, last)?;
            let prof = profile(s.mode);
            // On Auto, a mode may pin a tier (Debug/Review → strong). Explicit picks win.
            if s.model == "auto" {
                if let Some(tier) = prof.tier {
                    if let Ok(m) = ctx.catalog.by_tier(tier) {
                        decision.model_id = m.id.clone();
                        decision.reason = format!("mode {:?} -> tier {tier}", s.mode);
                    }
                }
            }
            let model = ctx.catalog.resolve(&decision.model_id)?;
            (
                decision.model_id,
                decision.task_class.as_str().to_string(),
                decision.reason,
                prof.read_only,
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
            let prof = profile(s.mode);
            let mut tools = silence_tools::openai_tools(read_only);
            if prof.submit_plan {
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
            arr_extend_mcp(&ctx, &mut tools, read_only).await;
            arr_extend_task(&mut tools, read_only);
            (with_mode_system(&s.messages, prof.system), tools)
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
                // Chỉ escalate/retry lỗi tạm thời; hết credit / key sai thì dừng ngay.
                let retryable = err
                    .downcast_ref::<ProviderError>()
                    .map(|e| e.code.retryable())
                    .unwrap_or(false);
                let upgraded = if retryable {
                    silence_router::escalate(&ctx.catalog, "timeout")?
                } else {
                    model_id.clone()
                };
                if upgraded != model_id {
                    emit(
                        &tx,
                        SessionEvent::Trace {
                            event: "escalate".into(),
                            detail: json!({"from": model_id, "to": upgraded, "err": err.to_string()}),
                        },
                    );
                    match gateway::chat(
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
                    .await
                    {
                        Ok(r) => r,
                        Err(err2) => {
                            rollback_user_message(&session_arc, loops, &text).await;
                            return Err(err2);
                        }
                    }
                } else {
                    rollback_user_message(&session_arc, loops, &text).await;
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

/// Read-only modes only get MCP tools the server marks `readOnlyHint: true`.
async fn arr_extend_mcp(ctx: &AppCtx, tools: &mut Value, read_only: bool) {
    let extra = ctx.mcp.all_tools().await;
    if let Some(arr) = tools.as_array_mut() {
        for (server, tool) in extra {
            if read_only && !tool.read_only {
                continue;
            }
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

/// Close a tool call with a refusal (ToolEnd ok=false) and return the text for the model.
fn refuse(tx: &Option<mpsc::UnboundedSender<SessionEvent>>, tc: &ToolCall, why: &str) -> String {
    let msg = format!("{} {why}", tc.name);
    emit(
        tx,
        SessionEvent::ToolEnd {
            call_id: tc.id.clone(),
            name: tc.name.clone(),
            ok: false,
            output: msg.clone(),
        },
    );
    msg
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
        if session_arc.lock().await.mode != SessionMode::Plan {
            return Ok(refuse(tx, tc, "is only available in Plan mode"));
        }
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
        if session_arc.lock().await.mode.read_only() {
            let ro = ctx
                .mcp
                .all_tools()
                .await
                .into_iter()
                .any(|(s, t)| s == server && t.name == tool && t.read_only);
            if !ro {
                return Ok(refuse(tx, tc, "is not read-only and this mode is read-only"));
            }
        }
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
        if session_arc.lock().await.mode.read_only() {
            return Ok(refuse(tx, tc, "is not available in a read-only mode"));
        }
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
        // Defence in depth: read-only modes never offer these tools, but a model can still
        // hallucinate a call, so refuse here before any permission prompt.
        if session_arc.lock().await.mode.read_only() {
            return Ok(refuse(tx, tc, "is not available in a read-only mode"));
        }
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
                if s.allowlist.iter().any(|k| permissions::entry_matches(k, name, args)) {
                    return Ok(true);
                }
            }
            let (ptx, prx) = oneshot::channel();
            let request_id = Uuid::new_v4().to_string();
            session_arc.lock().await.pending_perm.insert(
                request_id.clone(),
                (name.to_string(), permissions::entry_for(name, args), ptx),
            );
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
) -> Result<()> {
    let session = ctx
        .sessions
        .lock()
        .await
        .get(session_id)
        .cloned()
        .ok_or_else(|| anyhow!("unknown session"))?;
    let mut s = session.lock().await;
    let Some((name, entry, tx)) = s.pending_perm.remove(request_id) else {
        return Ok(());
    };
    // Deny never persists; only known mutating/MCP tools can be remembered.
    if allow && remember && permissions::is_rememberable(&name) && !s.allowlist.contains(&entry) {
        s.allowlist.push(entry);
        if let Err(e) = permissions::save(&s.workspace.root, &s.allowlist) {
            eprintln!("permissions: cannot persist allowlist: {e:#}");
        }
    }
    let _ = tx.send(allow);
    Ok(())
}

/// Approve the last submitted plan: switch to Agent, save the plan under
/// `.silence/plans/`, and start the implementation turn right away.
pub async fn approve_plan(ctx: Arc<AppCtx>, session_id: &str) -> Result<()> {
    let session = ctx
        .sessions
        .lock()
        .await
        .get(session_id)
        .cloned()
        .ok_or_else(|| anyhow!("unknown session"))?;
    let (plan, root) = {
        let mut s = session.lock().await;
        let plan = s.last_plan.take().ok_or_else(|| anyhow!("no plan to approve"))?;
        s.mode = SessionMode::Agent;
        (plan, s.workspace.root.clone())
    };
    let saved = save_plan(&root, &plan)
        .map(|p| format!("\n\n(Saved at `{p}`.)"))
        .unwrap_or_default();
    prompt(
        ctx,
        session_id.to_string(),
        format!("Plan approved. Implement it.{saved}\n\n{plan}"),
    )
    .await
}

/// Write an approved plan to `.silence/plans/<unix-seconds>.md`; returns the relative path.
fn save_plan(root: &std::path::Path, plan: &str) -> Result<String> {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs();
    let rel = format!(".silence/plans/{secs}.md");
    let path = root.join(&rel);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&path, plan)?;
    Ok(rel)
}

/// Remembered permission entries of a workspace (read from disk).
pub fn list_permissions(workspace: &str) -> Result<Vec<String>> {
    let ws = Workspace::new(workspace)?;
    permissions::load(&ws.root)
}

/// Remove one remembered entry from disk and from every live session of that workspace.
pub async fn revoke_permission(ctx: &AppCtx, workspace: &str, entry: &str) -> Result<()> {
    let ws = Workspace::new(workspace)?;
    let mut list = permissions::load(&ws.root)?;
    list.retain(|e| e != entry);
    permissions::save(&ws.root, &list)?;
    let sessions: Vec<_> = ctx.sessions.lock().await.values().cloned().collect();
    for s in sessions {
        let mut s = s.lock().await;
        if s.workspace.root == ws.root {
            s.allowlist.retain(|e| e != entry);
        }
    }
    Ok(())
}

/// Switch the mode (agent / plan / ask) of a live session.
pub async fn set_mode(ctx: &AppCtx, session_id: &str, mode: SessionMode) -> Result<()> {
    let session = ctx
        .sessions
        .lock()
        .await
        .get(session_id)
        .cloned()
        .ok_or_else(|| anyhow!("unknown session"))?;
    session.lock().await.mode = mode;
    Ok(())
}

/// Switch the model of a live session (the picker changes after `session.create`).
pub async fn set_model(ctx: &AppCtx, session_id: &str, model: &str) -> Result<()> {
    if model != "auto" {
        ctx.catalog.resolve(model)?;
    }
    let session = ctx
        .sessions
        .lock()
        .await
        .get(session_id)
        .cloned()
        .ok_or_else(|| anyhow!("unknown session"))?;
    session.lock().await.model = model.to_string();
    Ok(())
}

pub async fn abort(ctx: &AppCtx, session_id: &str) -> Result<()> {
    if let Some(s) = ctx.sessions.lock().await.get(session_id) {
        s.lock().await.abort = true;
    }
    Ok(())
}

const SUBAGENT_MAX_ROUNDS: usize = 8;

/// One sub-agent tool call. Mutating calls go through the parent's normal path
/// (`dispatch_tool`: read-only-mode guard, permission ask, diff staging, audit) — a sub-agent
/// never writes the workspace silently. No nested sub-agents.
async fn subagent_tool(
    ctx: &AppCtx,
    parent: &Arc<Mutex<Session>>,
    tx: &Option<mpsc::UnboundedSender<SessionEvent>>,
    tc: &ToolCall,
    read_only: bool,
) -> String {
    if tc.name == "task" || tc.name == "submit_plan" {
        return format!("{} is not available to sub-agents", tc.name);
    }
    if read_only && silence_tools::mutates(&tc.name) {
        return "read-only subagent cannot mutate".into();
    }
    match Box::pin(dispatch_tool(ctx, parent, tx, tc)).await {
        Ok(out) => out,
        Err(e) => format!("ERROR: {e}"),
    }
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
    let parent_id = parent.lock().await.id.clone();
    let (model, read_only) = match kind {
        "explore" => (ctx.catalog.by_tier("fast")?.id.clone(), true),
        "review" => (ctx.catalog.by_tier("strong")?.id.clone(), true),
        _ => (ctx.catalog.by_tier("mid")?.id.clone(), false),
    };
    let tools = silence_tools::openai_tools(read_only);
    let mut msgs = vec![
        json!({"role":"system","content": format!("{SYSTEM}\nYou are a {kind} sub-agent. You cannot spawn sub-agents. Return a concise summary.")}),
        json!({"role":"user","content": prompt}),
    ];
    let mut acc = String::new();
    for _round in 0..SUBAGENT_MAX_ROUNDS {
        let result = gateway::chat(&ctx.catalog, &model, &msgs, &tools, |_| {}, |_| {}).await?;
        if result.tool_calls.is_empty() {
            acc = result.content;
            break;
        }
        acc = result.content.clone();
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
            let out = subagent_tool(ctx, parent, tx, &tc, read_only).await;
            msgs.push(json!({"role":"tool","tool_call_id": tc.id, "content": redact(&out)}));
        }
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

#[cfg(test)]
mod permission_tests {
    use super::*;
    use std::time::Duration;

    fn test_ctx(data: &std::path::Path) -> Arc<AppCtx> {
        let raw = serde_json::from_value(json!({"version": 1, "providers": [], "models": [], "routes": {}})).unwrap();
        let audit = AuditLog::open(data).unwrap();
        Arc::new(AppCtx::new(Catalog { raw }, audit))
    }

    async fn new_session(ctx: &AppCtx, ws: &std::path::Path) -> (String, Arc<Mutex<Session>>) {
        let id = create_session(
            ctx,
            ws.to_str().unwrap(),
            None,
            SessionMode::Agent,
            PermissionMode::Ask,
        )
        .await
        .unwrap();
        let s = ctx.sessions.lock().await.get(&id).cloned().unwrap();
        (id, s)
    }

    /// Run `ask_perm` for `tool`, wait for the pending request, then answer it.
    /// Returns (decision seen by the tool, whether an ask was needed).
    async fn ask_and_answer(
        ctx: &Arc<AppCtx>,
        sid: &str,
        s: &Arc<Mutex<Session>>,
        tool: &str,
        allow: bool,
        remember: bool,
    ) -> (bool, bool) {
        let (c, sc, name) = (ctx.clone(), s.clone(), tool.to_string());
        let h = tokio::spawn(async move {
            ask_perm(&c, &sc, &None, &name, &json!({})).await.unwrap()
        });
        let mut asked = false;
        for _ in 0..50 {
            let rid = s.lock().await.pending_perm.keys().next().cloned();
            if let Some(rid) = rid {
                asked = true;
                decide_permission(ctx, sid, &rid, allow, remember).await.unwrap();
                break;
            }
            if h.is_finished() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        (h.await.unwrap(), asked)
    }

    #[tokio::test]
    async fn remember_allow_pushes_tool_name() {
        let (_d, data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let ctx = test_ctx(data.path());
        let (sid, s) = new_session(&ctx, _d.path()).await;
        let (ok, asked) = ask_and_answer(&ctx, &sid, &s, "edit", true, true).await;
        assert!(ok && asked);
        assert_eq!(s.lock().await.allowlist, vec!["edit".to_string()]);
        assert_eq!(permissions::load(_d.path()).unwrap(), vec!["edit".to_string()]);
    }

    #[tokio::test]
    async fn second_call_skips_ask_when_allowlisted() {
        let (ws, data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let ctx = test_ctx(data.path());
        let (sid, s) = new_session(&ctx, ws.path()).await;
        ask_and_answer(&ctx, &sid, &s, "edit", true, true).await;
        let (ok, asked) = ask_and_answer(&ctx, &sid, &s, "edit", true, true).await;
        assert!(ok, "remembered tool must be allowed");
        assert!(!asked, "remembered tool must not emit a second ask");
    }

    #[tokio::test]
    async fn create_session_loads_allowlist() {
        let (ws, data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        permissions::save(ws.path(), &["write".to_string()]).unwrap();
        let ctx = test_ctx(data.path());
        let (_sid, s) = new_session(&ctx, ws.path()).await;
        assert_eq!(s.lock().await.allowlist, vec!["write".to_string()]);
    }

    #[tokio::test]
    async fn deny_never_persists() {
        let (ws, data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let ctx = test_ctx(data.path());
        let (sid, s) = new_session(&ctx, ws.path()).await;
        let (ok, asked) = ask_and_answer(&ctx, &sid, &s, "shell", false, true).await;
        assert!(asked && !ok);
        assert!(s.lock().await.allowlist.is_empty());
        assert!(!ws.path().join(".silence/permissions.json").exists());
    }

    #[test]
    fn unknown_tool_names_are_dropped_on_load() {
        let ws = tempfile::tempdir().unwrap();
        permissions::save(ws.path(), &["read".into(), "edit".into(), "rm -rf".into()]).unwrap();
        assert_eq!(permissions::load(ws.path()).unwrap(), vec!["edit".to_string()]);
    }

    fn edit_call(path: &str) -> ToolCall {
        ToolCall {
            id: "c1".into(),
            name: "edit".into(),
            arguments: json!({"path": path, "old_string": "a = 1", "new_string": "a = 2"}).to_string(),
        }
    }

    #[test]
    fn mode_profiles() {
        for m in [SessionMode::Plan, SessionMode::Ask, SessionMode::Review] {
            assert!(profile(m).read_only, "{m:?} must be read-only");
        }
        for m in [SessionMode::Agent, SessionMode::Debug, SessionMode::Multitask] {
            assert!(!profile(m).read_only, "{m:?} must allow edits");
        }
        assert!(profile(SessionMode::Plan).submit_plan);
        assert!(!profile(SessionMode::Ask).submit_plan);
        assert_eq!(profile(SessionMode::Debug).tier, Some("strong"));
        assert_eq!(profile(SessionMode::Review).tier, Some("strong"));
        assert_eq!(profile(SessionMode::Agent).tier, None);
    }

    #[test]
    fn mode_system_is_appended_not_persisted() {
        let hist = vec![json!({"role":"system","content":"BASE"}), json!({"role":"user","content":"hi"})];
        let out = with_mode_system(&hist, "## Mode: Ask");
        assert_eq!(out[0]["content"], "BASE\n\n## Mode: Ask");
        assert_eq!(hist[0]["content"], "BASE");
        assert_eq!(with_mode_system(&hist, "")[0]["content"], "BASE");
    }

    #[tokio::test]
    async fn read_only_modes_refuse_edit_without_asking() {
        for mode in [SessionMode::Ask, SessionMode::Review, SessionMode::Plan] {
            let (ws, data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
            std::fs::write(ws.path().join("a.py"), "a = 1\n").unwrap();
            let ctx = test_ctx(data.path());
            let (_sid, s) = new_session(&ctx, ws.path()).await;
            s.lock().await.mode = mode;
            let out = dispatch_tool(&ctx, &s, &None, &edit_call("a.py")).await.unwrap();
            assert!(out.contains("read-only"), "{mode:?}: {out}");
            assert!(s.lock().await.pending_perm.is_empty(), "{mode:?} must not ask");
            assert_eq!(std::fs::read_to_string(ws.path().join("a.py")).unwrap(), "a = 1\n");
        }
    }

    #[tokio::test]
    async fn subagent_edit_goes_through_permission() {
        let (ws, data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        std::fs::write(ws.path().join("a.py"), "a = 1\n").unwrap();
        let ctx = test_ctx(data.path());
        let (sid, s) = new_session(&ctx, ws.path()).await;
        let (c, sc) = (ctx.clone(), s.clone());
        let h = tokio::spawn(async move { subagent_tool(&c, &sc, &None, &edit_call("a.py"), false).await });
        let mut asked = false;
        for _ in 0..50 {
            let rid = s.lock().await.pending_perm.keys().next().cloned();
            if let Some(rid) = rid {
                asked = true;
                decide_permission(&ctx, &sid, &rid, false, false).await.unwrap();
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let out = h.await.unwrap();
        assert!(asked, "sub-agent edit must emit a permission ask");
        assert_eq!(out, "permission denied");
        assert_eq!(std::fs::read_to_string(ws.path().join("a.py")).unwrap(), "a = 1\n");
    }

    #[tokio::test]
    async fn read_only_subagent_and_nesting_refused() {
        let (ws, data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let ctx = test_ctx(data.path());
        let (_sid, s) = new_session(&ctx, ws.path()).await;
        let out = subagent_tool(&ctx, &s, &None, &edit_call("a.py"), true).await;
        assert_eq!(out, "read-only subagent cannot mutate");
        let task = ToolCall { id: "t".into(), name: "task".into(), arguments: "{}".into() };
        assert!(subagent_tool(&ctx, &s, &None, &task, false).await.contains("not available"));
    }
}
