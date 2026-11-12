use super::*;

pub(super) async fn stage_file_tool(
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
                        applied: false,
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
