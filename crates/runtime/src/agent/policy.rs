use super::*;
use crate::risk::{self, RiskCtx, Tier, Verdict};

/// Outcome of gating one tool call (docs/security/permissions.md).
pub(super) enum Gate {
    /// Run it. The verdict is kept for audit and taint.
    Run(Verdict),
    /// The user said no (or `allowlist` mode had no matching entry).
    Denied,
    /// Tier 3: refused without asking. Text for the model.
    Blocked(String),
}

/// Does this mode ask for a call at `tier` (before looking at remembered entries)?
fn mode_asks(mode: PermissionMode, tier: Tier) -> bool {
    match mode {
        PermissionMode::Yolo => false,
        PermissionMode::Balanced | PermissionMode::Autonomous => tier >= Tier::Ask,
        PermissionMode::Ask | PermissionMode::Allowlist => tier >= Tier::Logged,
    }
}

/// Classify with the Risk Engine, then run / ask / block according to the session mode.
/// Tier 3 is blocked in every mode (YOLO included). Remembered entries never cover a
/// verdict with a `never_remember` code.
pub(super) async fn gate(
    ctx: &AppCtx,
    session_arc: &Arc<Mutex<Session>>,
    tx: &Option<mpsc::UnboundedSender<SessionEvent>>,
    name: &str,
    args: &Value,
    mcp_read_only: bool,
) -> Result<Gate> {
    let (mode, root, tainted, sid) = {
        let s = session_arc.lock().await;
        (s.permission, s.workspace.root.clone(), s.tainted, s.id.clone())
    };
    let verdict = risk::classify(name, args, &RiskCtx { workspace: &root, tainted, mcp_read_only });

    if verdict.tier == Tier::Block {
        let _ = ctx
            .audit
            .append(now_event(&sid, "tool.blocked", "", name, "", 0, 0, 0.0, json!({"codes": verdict.codes})))
            .await;
        // UI shows a "Đã chặn" step with the Vietnamese reason (the model gets the English hint).
        let info = risk::policy().codes.get(verdict.primary());
        emit(
            tx,
            SessionEvent::Trace {
                event: "policy.blocked".into(),
                detail: json!({
                    "code": verdict.primary(),
                    "title": info.map(|i| i.title.as_str()).unwrap_or(""),
                    "detail": info.map(|i| i.detail.as_str()).unwrap_or(""),
                    "tool": name,
                }),
            },
        );
        return Ok(Gate::Blocked(verdict.block_message()));
    }
    if !mode_asks(mode, verdict.tier) {
        return Ok(Gate::Run(verdict));
    }
    if !verdict.never_remember() {
        let s = session_arc.lock().await;
        let covered = |list: &[String]| list.iter().any(|k| permissions::entry_matches(k, name, args));
        if covered(&s.allowlist) || covered(&s.session_allow) {
            return Ok(Gate::Run(verdict));
        }
    }
    if mode == PermissionMode::Allowlist {
        return Ok(Gate::Denied);
    }

    let entry = if verdict.never_remember() || !permissions::is_rememberable(name) {
        String::new()
    } else {
        permissions::entry_for(name, args)
    };
    let pattern = (!entry.is_empty()).then(|| entry.split_once(':').map(|(_, p)| p).unwrap_or(&entry).to_string());
    let (ptx, prx) = oneshot::channel();
    let request_id = Uuid::new_v4().to_string();
    session_arc
        .lock()
        .await
        .pending_perm
        .insert(request_id.clone(), (name.to_string(), entry, ptx));
    emit(
        tx,
        SessionEvent::Permission {
            request_id,
            name: name.into(),
            input: args.clone(),
            reason: verdict.title(),
            risk: Some(verdict.to_protocol(pattern)),
        },
    );
    Ok(if prx.await.unwrap_or(false) { Gate::Run(verdict) } else { Gate::Denied })
}

/// Test helper: `true` when the call would run.
#[cfg(test)]
pub(super) async fn ask_perm(
    ctx: &AppCtx,
    session_arc: &Arc<Mutex<Session>>,
    tx: &Option<mpsc::UnboundedSender<SessionEvent>>,
    name: &str,
    args: &Value,
) -> Result<bool> {
    Ok(matches!(gate(ctx, session_arc, tx, name, args, false).await?, Gate::Run(_)))
}

/// Legacy entry point: `remember` = save for the workspace.
pub async fn decide_permission(
    ctx: &AppCtx,
    session_id: &str,
    request_id: &str,
    allow: bool,
    remember: bool,
) -> Result<()> {
    let scope = if remember { PermissionScope::Workspace } else { PermissionScope::Once };
    decide_permission_scoped(ctx, session_id, request_id, allow, scope).await
}

pub async fn decide_permission_scoped(
    ctx: &AppCtx,
    session_id: &str,
    request_id: &str,
    allow: bool,
    scope: PermissionScope,
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
    // An empty entry means the Engine decided this call cannot be remembered (pipeline,
    // never_remember code); the client's scope is ignored then and it counts as `once`.
    if allow && !entry.is_empty() && permissions::is_rememberable(&name) {
        match scope {
            PermissionScope::Once => {}
            PermissionScope::Session => {
                if !s.session_allow.contains(&entry) {
                    s.session_allow.push(entry);
                }
            }
            PermissionScope::Workspace => {
                if !s.allowlist.contains(&entry) {
                    s.allowlist.push(entry);
                    if let Err(e) = permissions::save(&s.workspace.root, &s.allowlist) {
                        eprintln!("permissions: cannot persist allowlist: {e:#}");
                    }
                }
            }
        }
    }
    let _ = tx.send(allow);
    Ok(())
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
