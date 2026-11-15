//! Rewind and fork: cut a session's model-visible history before one of the user's messages.
//!
//! The Studio counts user bubbles; the Engine counts user prompts in `messages`. They can drift
//! (a failed first call rolls the prompt back), so the client also sends the text of the first
//! message to drop and the Engine looks for it near the expected position.

use super::*;
use crate::session::replay_messages;
use silence_protocol::{SessionForkParams, SessionRewindParams, SessionRewindResult};

/// Indices of real user prompts in `messages` (not the `[view_image]` follow-ups).
fn user_prompt_indices(messages: &[Value]) -> Vec<usize> {
    messages
        .iter()
        .enumerate()
        .filter(|(_, m)| m.get("role").and_then(Value::as_str) == Some("user"))
        .filter(|(_, m)| !crate::images::content_text(m).starts_with(VIEW_IMAGE_TAG))
        .map(|(i, _)| i)
        .collect()
}

/// The user's words of a prompt message, without the `<ui_context>` block the Studio appends.
fn prompt_words(m: &Value) -> String {
    let content = crate::images::content_text(m);
    content.split("\n\n<ui_context>").next().unwrap_or("").trim().to_string()
}

/// Where to cut `messages` so the first `keep` user prompts (and everything they led to) stay.
///
/// `text` = the first prompt to drop, as the user wrote it. When it is given and the prompt at
/// position `keep` does not match, the nearest earlier prompt with that text wins (the history
/// can only hold fewer prompts than the UI shows). A prompt that never reached the history (its
/// turn failed) cuts nothing. Errors when the text is found nowhere and later prompts exist:
/// cutting there would drop the wrong turn.
pub(crate) fn cut_index(messages: &[Value], keep: usize, text: Option<&str>) -> Result<usize> {
    let prompts = user_prompt_indices(messages);
    let Some(text) = text.map(|t| redact(t.trim())).filter(|t| !t.is_empty()) else {
        return Ok(prompts.get(keep).copied().unwrap_or(messages.len()));
    };
    let matches = |i: usize| prompt_words(&messages[i]) == text;
    if let Some(&i) = prompts.get(keep).filter(|&&i| matches(i)) {
        return Ok(i);
    }
    if let Some(&i) = prompts.iter().take(keep.min(prompts.len())).rev().find(|&&i| matches(i)) {
        return Ok(i);
    }
    if keep >= prompts.len() {
        return Ok(messages.len());
    }
    bail!("message not found in session history")
}

/// History taint after a cut: only what is left counts.
fn retaint(s: &mut Session) {
    s.tainted = super::resume::history_tainted(&s.messages, &s.workspace.root);
}

async fn audit(ctx: &AppCtx, session_id: &str, kind: &str, detail: Value) {
    if let Err(err) = ctx.audit.append(now_event(session_id, kind, "", "", "", 0, 0, 0.0, detail)).await {
        tracing::warn!("audit: {err}");
    }
}

/// `session.rewind`: drop a user message and everything after it from a live session.
/// Files in the workspace are not touched (that is Checkpoint → Restore).
pub async fn rewind_session(ctx: &AppCtx, p: &SessionRewindParams) -> Result<SessionRewindResult> {
    let session = ctx
        .sessions
        .lock()
        .await
        .get(&p.session_id)
        .cloned()
        .ok_or_else(|| anyhow!("unknown session"))?;
    let mut s = session.lock().await;
    if !s.pending_perm.is_empty() {
        bail!("a turn is waiting for approval; stop it before rewinding");
    }
    let cut = cut_index(&s.messages, p.keep_user_turns as usize, p.text.as_deref())?;
    // Never drop the system prompt.
    let cut = cut.max(1).min(s.messages.len());
    let dropped = s.messages.len() - cut;
    if dropped > 0 {
        s.messages.truncate(cut);
        s.logged_len = s.messages.len();
        let snapshot = s.messages.clone();
        let id = s.id.clone();
        log_append(ctx, &id, LogBody::MessagesReplaced { messages: snapshot }).await;
    }
    // The CLI keeps its own copy of the conversation: start over from the cut history.
    s.cli_session = None;
    s.cli_hot = false;
    s.pending_edits.clear();
    s.last_plan = None;
    s.last_prompt_tokens = None;
    s.tool_log.clear();
    retaint(&mut s);
    let id = s.id.clone();
    drop(s);
    audit(ctx, &id, "session.rewind", json!({"keep_user_turns": p.keep_user_turns, "dropped": dropped})).await;
    Ok(SessionRewindResult { dropped: dropped as u32 })
}

/// `session.fork`: a new live session whose history is the source's, cut like `rewind`.
/// The source stays as it is. Works from the log when the source is no longer in memory.
/// The caller subscribes to the new session's events, as for `session.create`.
pub async fn fork_session(ctx: &AppCtx, p: &SessionForkParams) -> Result<String> {
    let live = ctx.sessions.lock().await.get(&p.session_id).cloned();
    let (workspace, mode, model, permission, messages) = match live {
        Some(src) => {
            let s = src.lock().await;
            (s.workspace.root.to_string_lossy().into_owned(), s.mode, s.model.clone(), s.permission, s.messages.clone())
        }
        None => {
            let records = ctx.store.load(&p.session_id)?;
            let summary = crate::session::summarize(&records).ok_or_else(|| anyhow!("unknown session"))?;
            let permission = match records.first().map(|r| &r.body) {
                Some(LogBody::SessionStart { permission, .. }) => *permission,
                _ => bail!("unknown session"),
            };
            (summary.workspace, summary.mode, summary.model, permission, replay_messages(&records))
        }
    };
    let mut kept = match p.keep_user_turns {
        Some(k) => {
            let cut = cut_index(&messages, k as usize, p.text.as_deref())?;
            messages[..cut.min(messages.len())].to_vec()
        }
        None => messages,
    };
    let id = create_session(ctx, &workspace, Some(model), mode, permission).await?;
    let session = ctx.sessions.lock().await.get(&id).cloned().ok_or_else(|| anyhow!("unknown session"))?;
    {
        let mut s = session.lock().await;
        // Keep the new session's own system prompt (fresh org rules); the source's is dropped.
        if kept.first().and_then(|m| m.get("role")).and_then(Value::as_str) == Some("system") {
            kept.remove(0);
        }
        s.messages.truncate(1);
        s.messages.extend(kept);
        s.logged_len = s.messages.len();
        let snapshot = s.messages.clone();
        log_append(ctx, &id, LogBody::MessagesReplaced { messages: snapshot }).await;
        retaint(&mut s);
    }
    audit(ctx, &id, "session.fork", json!({"from": p.session_id, "keep_user_turns": p.keep_user_turns})).await;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(data: &std::path::Path) -> AppCtx {
        let raw = serde_json::from_value(json!({"version": 1, "providers": [], "models": []})).unwrap();
        AppCtx::new(Catalog::from_raw(raw), AuditLog::open(data).unwrap())
    }

    fn convo() -> Vec<Value> {
        vec![
            json!({"role":"system","content":"S"}),
            json!({"role":"user","content":"one"}),
            json!({"role":"assistant","content":"a1"}),
            json!({"role":"user","content":format!("{VIEW_IMAGE_TAG} Images from your view_image calls: x.png")}),
            json!({"role":"user","content":"two\n\n<ui_context>\nlog\n</ui_context>"}),
            json!({"role":"assistant","content":"a2"}),
            json!({"role":"user","content":[{"type":"text","text":"three"},{"type":"image_url","image_url":{"url":"data:x"}}]}),
            json!({"role":"assistant","content":"a3"}),
        ]
    }

    #[test]
    fn cut_by_position_skips_view_image_messages() {
        let m = convo();
        assert_eq!(cut_index(&m, 0, None).unwrap(), 1);
        assert_eq!(cut_index(&m, 1, None).unwrap(), 4);
        assert_eq!(cut_index(&m, 2, None).unwrap(), 6);
        assert_eq!(cut_index(&m, 3, None).unwrap(), m.len());
    }

    #[test]
    fn cut_by_text_matches_ui_context_and_images() {
        let m = convo();
        assert_eq!(cut_index(&m, 1, Some("two")).unwrap(), 4);
        assert_eq!(cut_index(&m, 2, Some(" three ")).unwrap(), 6);
    }

    #[test]
    fn cut_by_text_falls_back_to_an_earlier_prompt() {
        // The UI shows one more bubble than the history holds (a rolled-back failed turn).
        let m = convo();
        assert_eq!(cut_index(&m, 2, Some("two")).unwrap(), 4);
        // A prompt that never reached the history cuts nothing.
        assert_eq!(cut_index(&m, 3, Some("four")).unwrap(), m.len());
        // Unknown text with later prompts left: refuse rather than drop the wrong turn.
        assert!(cut_index(&m, 1, Some("nope")).is_err());
    }

    async fn seeded(c: &AppCtx, ws: &std::path::Path) -> String {
        let id = create_session(c, ws.to_str().unwrap(), None, SessionMode::Agent, PermissionMode::Ask)
            .await
            .unwrap();
        let s = c.sessions.lock().await.get(&id).cloned().unwrap();
        let mut s = s.lock().await;
        s.messages.extend(convo().into_iter().skip(1));
        s.cli_session = Some("cli".into());
        persist_messages(c, &mut s).await;
        id
    }

    #[tokio::test]
    async fn rewind_cuts_memory_and_log() {
        let data = tempfile::tempdir().unwrap();
        let ws = tempfile::tempdir().unwrap();
        let c = ctx(data.path());
        let id = seeded(&c, ws.path()).await;
        let r = rewind_session(
            &c,
            &SessionRewindParams { session_id: id.clone(), keep_user_turns: 1, text: Some("two".into()) },
        )
        .await
        .unwrap();
        assert_eq!(r.dropped, 4);
        let s = c.sessions.lock().await.get(&id).cloned().unwrap();
        {
            let s = s.lock().await;
            assert_eq!(s.messages.len(), 4);
            assert_eq!(s.logged_len, 4);
            assert!(s.cli_session.is_none());
        }
        let records = c.store.load(&id).unwrap();
        assert_eq!(replay_messages(&records).len(), 4, "the cut survives a restart");
        let audit = c.audit.query(Some(&id), 10).unwrap();
        assert!(audit.iter().any(|e| e.kind == "session.rewind"));
    }

    #[tokio::test]
    async fn rewind_unknown_session_errors() {
        let data = tempfile::tempdir().unwrap();
        let c = ctx(data.path());
        let p = SessionRewindParams { session_id: "nope".into(), keep_user_turns: 0, text: None };
        assert!(rewind_session(&c, &p).await.is_err());
    }

    #[tokio::test]
    async fn fork_copies_history_up_to_the_cut_and_keeps_the_source() {
        let data = tempfile::tempdir().unwrap();
        let ws = tempfile::tempdir().unwrap();
        let c = ctx(data.path());
        let src = seeded(&c, ws.path()).await;
        let p = SessionForkParams { session_id: src.clone(), keep_user_turns: Some(2), text: Some("three".into()) };
        let fork = fork_session(&c, &p).await.unwrap();
        assert_ne!(fork, src);
        let f = c.sessions.lock().await.get(&fork).cloned().unwrap();
        {
            let f = f.lock().await;
            assert_eq!(f.messages.len(), 6, "system + two turns (with the view_image follow-up)");
            assert_eq!(f.messages[0]["role"], "system");
            assert!(f.cli_session.is_none());
        }
        assert_eq!(replay_messages(&c.store.load(&fork).unwrap()).len(), 6);
        let s = c.sessions.lock().await.get(&src).cloned().unwrap();
        assert_eq!(s.lock().await.messages.len(), 8, "source untouched");
    }

    #[tokio::test]
    async fn fork_works_from_the_log_after_a_restart() {
        let data = tempfile::tempdir().unwrap();
        let ws = tempfile::tempdir().unwrap();
        let src = seeded(&ctx(data.path()), ws.path()).await;
        let second = ctx(data.path());
        let p = SessionForkParams { session_id: src, keep_user_turns: None, text: None };
        let fork = fork_session(&second, &p).await.unwrap();
        let f = second.sessions.lock().await.get(&fork).cloned().unwrap();
        assert_eq!(f.lock().await.messages.len(), 8);
    }
}
