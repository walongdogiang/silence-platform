use super::*;

pub(super) const SUBAGENT_MAX_ROUNDS: usize = 8;

/// One sub-agent tool call. Mutating calls go through the parent's normal path
/// (`dispatch_tool`: read-only-mode guard, permission ask, diff staging, audit) — a sub-agent
/// never writes the workspace silently. No nested sub-agents.
pub(super) async fn subagent_tool(
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

pub(super) async fn run_subagent(
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
    let (parent_id, parent_effort) = {
        let p = parent.lock().await;
        (p.id.clone(), p.effort.clone())
    };
    // Explore is reading-heavy and cheap by design; the others follow the user's pick.
    let effort = if kind == "explore" { "low".to_string() } else { parent_effort };
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
        let result = gateway::chat(&ctx.catalog, &model, &msgs, &tools, &effort, |_| {}, |_| {}).await?;
        if result.tool_calls.is_empty() {
            acc = result.content;
            break;
        }
        acc = result.content.clone();
        msgs.push(result.assistant_message(Some(
            result
                .tool_calls
                .iter()
                .map(|tc| {
                    json!({
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.name, "arguments": tc.arguments}
                    })
                })
                .collect(),
        )));
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
