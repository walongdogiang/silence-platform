use super::*;
use crate::session::{replay_messages, summarize};
use silence_protocol::SessionResumeResult;

/// Does replayed history already contain outside content (MCP output, fetched URLs)?
/// Same rule as live taint (`Verdict::brings_external_content`).
pub(super) fn history_tainted(messages: &[Value], root: &std::path::Path) -> bool {
    messages
        .iter()
        .filter_map(|m| m.get("tool_calls").and_then(Value::as_array))
        .flatten()
        .any(|tc| {
            let f = &tc["function"];
            let name = f["name"].as_str().unwrap_or("");
            let args: Value = f["arguments"]
                .as_str()
                .and_then(|a| serde_json::from_str(a).ok())
                .unwrap_or(Value::Null);
            let ctx = crate::risk::RiskCtx { workspace: root, tainted: false, mcp_read_only: true };
            name.starts_with("mcp__") || crate::risk::classify(name, &args, &ctx).brings_external_content()
        })
}

/// USD the session spent, from the `cost` events in its log (turns, sub-agents, titles).
pub(super) fn logged_spend(records: &[silence_protocol::LogRecord]) -> f64 {
    records
        .iter()
        .filter_map(|r| match &r.body {
            LogBody::Event { event: SessionEvent::Cost { usd, .. } } => Some(*usd),
            _ => None,
        })
        .sum()
}

/// Bring a past session back from its event log. If the session is still live in memory it is
/// left as is. Pending permission requests and staged diffs are not restored.
///
/// The caller subscribes to the session's events afterwards, as for `session.create`.
pub async fn resume_session(ctx: &AppCtx, session_id: &str) -> Result<SessionResumeResult> {
    let records = ctx.store.load(session_id)?;
    let summary = summarize(&records).ok_or_else(|| anyhow!("unknown session"))?;
    let (workspace, permission) = match records.first().map(|r| &r.body) {
        Some(LogBody::SessionStart {
            workspace,
            permission,
            ..
        }) => (workspace.clone(), *permission),
        _ => return Err(anyhow!("unknown session")),
    };

    let mut live = ctx.sessions.lock().await;
    if !live.contains_key(session_id) {
        let ws = Workspace::new(&workspace)?;
        let org = org::load(&ws.root).unwrap_or_default();
        let allowlist = permissions::load(&ws.root).unwrap_or_default();
        let messages = replay_messages(&records);
        let tainted = history_tainted(&messages, &ws.root);
        let session = Session {
            id: session_id.to_string(),
            workspace: ws,
            mode: summary.mode,
            permission,
            model: summary.model.clone(),
            effort: "auto".into(),
            style: "default".into(),
            cli_session: None,
            logged_len: messages.len(),
            messages,
            org,
            allowlist,
            session_allow: Vec::new(),
            pending_perm: HashMap::new(),
            pending_edits: HashMap::new(),
            last_plan: None,
            abort: false,
            last_model: None,
            last_prompt_tokens: None,
            last_call_usd: 0.0,
            tainted,
            source: String::new(),
            spent_usd: logged_spend(&records),
            budget_pass: false,
            cli_hot: false,
            tool_log: Vec::new(),
        };
        live.insert(session_id.to_string(), Arc::new(Mutex::new(session)));
    }
    drop(live);

    Ok(SessionResumeResult {
        summary,
        permission,
        records: records
            .into_iter()
            .filter(|r| !matches!(r.body, LogBody::MessagesReplaced { .. }))
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(data: &std::path::Path) -> AppCtx {
        let raw = serde_json::from_value(json!({"version": 1, "providers": [], "models": []})).unwrap();
        AppCtx::new(Catalog::from_raw(raw), AuditLog::open(data).unwrap())
    }

    #[tokio::test]
    async fn resume_restores_history_mode_and_records_after_restart() {
        let data = tempfile::tempdir().unwrap();
        let ws = tempfile::tempdir().unwrap();
        let first = ctx(data.path());
        let id = create_session(&first, ws.path().to_str().unwrap(), None, SessionMode::Agent, PermissionMode::Ask)
            .await
            .unwrap();
        {
            let s = first.sessions.lock().await.get(&id).cloned().unwrap();
            let mut s = s.lock().await;
            s.messages.push(json!({"role":"user","content":"hello there"}));
            s.messages.push(json!({"role":"assistant","content":"hi"}));
            persist_messages(&first, &mut s).await;
        }
        set_mode(&first, &id, SessionMode::Plan).await.unwrap();

        // New process: nothing in memory, only the log on disk.
        let second = ctx(data.path());
        assert!(second.sessions.lock().await.is_empty());
        let out = resume_session(&second, &id).await.unwrap();
        assert_eq!(out.summary.title, "hello there");
        assert_eq!(out.summary.turns, 1);
        assert_eq!(out.summary.mode, SessionMode::Plan);
        assert_eq!(out.permission, PermissionMode::Ask);
        assert!(out.records.iter().any(|r| matches!(r.body, LogBody::Message { .. })));

        let s = second.sessions.lock().await.get(&id).cloned().unwrap();
        let s = s.lock().await;
        assert_eq!(s.messages.len(), 3, "system + user + assistant");
        assert_eq!(s.logged_len, 3);
        assert_eq!(s.mode, SessionMode::Plan);
    }

    #[tokio::test]
    async fn resume_unknown_or_malformed_id_errors() {
        let data = tempfile::tempdir().unwrap();
        let c = ctx(data.path());
        assert!(resume_session(&c, &uuid::Uuid::new_v4().to_string()).await.is_err());
        assert!(resume_session(&c, "../etc").await.is_err());
    }

    #[tokio::test]
    async fn resume_does_not_replace_a_live_session() {
        let data = tempfile::tempdir().unwrap();
        let ws = tempfile::tempdir().unwrap();
        let c = ctx(data.path());
        let id = create_session(&c, ws.path().to_str().unwrap(), None, SessionMode::Agent, PermissionMode::Ask)
            .await
            .unwrap();
        c.sessions.lock().await.get(&id).unwrap().lock().await.last_plan = Some("keep".into());
        resume_session(&c, &id).await.unwrap();
        let s = c.sessions.lock().await.get(&id).cloned().unwrap();
        assert_eq!(s.lock().await.last_plan.as_deref(), Some("keep"));
    }
    #[tokio::test]
    async fn subscribe_logs_events_but_not_tokens_and_still_forwards_all() {
        let data = tempfile::tempdir().unwrap();
        let ws = tempfile::tempdir().unwrap();
        let c = ctx(data.path());
        let id = create_session(&c, ws.path().to_str().unwrap(), None, SessionMode::Agent, PermissionMode::Ask)
            .await
            .unwrap();
        let mut rx = subscribe(&c, &id).await;
        let tx = c.events.lock().await.get(&id).cloned();
        emit(&tx, SessionEvent::Token { text: "t".into() });
        emit(&tx, SessionEvent::Done { stop: "stop".into() });
        assert!(matches!(rx.recv().await, Some(SessionEvent::Token { .. })));
        assert!(matches!(rx.recv().await, Some(SessionEvent::Done { .. })));
        // `Done` is forwarded after it is written, so the log already holds it.
        let events: Vec<SessionEvent> = c
            .store
            .load(&id)
            .unwrap()
            .into_iter()
            .filter_map(|r| match r.body {
                LogBody::Event { event } => Some(event),
                _ => None,
            })
            .collect();
        assert_eq!(events, vec![SessionEvent::Done { stop: "stop".into() }]);
    }
}
