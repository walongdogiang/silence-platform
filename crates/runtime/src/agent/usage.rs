use super::*;

/// Size of what the session's next request sends (`session.context`). Built from the same
/// pieces as `run_turn` so the number matches the real request. `mode` / `model` preview the
/// UI's current pick (the UI only syncs them to the session right before a prompt).
pub async fn context_usage(
    ctx: &AppCtx,
    session_id: &str,
    mode: Option<SessionMode>,
    model: Option<&str>,
) -> Result<ContextUsage> {
    let session_arc = ctx
        .sessions
        .lock()
        .await
        .get(session_id)
        .cloned()
        .ok_or_else(|| anyhow!("unknown session"))?;
    let (est, model, measured, read_only) = {
        let s = session_arc.lock().await;
        let mode = mode.unwrap_or(s.mode);
        let requested = model.unwrap_or(&s.model);
        let est = estimate_parts(&s, mode);
        let model = match (&s.last_model, requested) {
            (Some(m), "auto") => m.clone(),
            _ => pick_model_for(&ctx.catalog, requested, mode, "")?.model_id,
        };
        (est, model, s.last_prompt_tokens, profile(mode).read_only)
    };
    let mcp: usize = mcp_tools(ctx, read_only)
        .await
        .iter()
        .map(|t| estimate_tokens(&t.to_string()))
        .sum();
    let window = ctx.catalog.resolve(&model)?.context_window;
    Ok(build_usage(est, mcp as u32, measured, model, window))
}

/// Per-part estimates (chars/4) of a session, MCP tools excluded (they live on `AppCtx`).
pub(super) fn estimate_parts(s: &Session, mode: SessionMode) -> ContextParts {
    let tok = |t: &str| if t.is_empty() { 0 } else { estimate_tokens(t) as u32 };
    let rules_text = org::system_append(&s.org);
    let mut system = tok(profile(mode).system);
    let mut rules = 0;
    let mut summarized = 0;
    let mut conversation = 0;
    for (i, m) in s.messages.iter().enumerate() {
        let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("");
        let content = m.get("content").and_then(|c| c.as_str()).unwrap_or("");
        if i == 0 && role == "system" {
            // First message = SYSTEM + workspace rules (`create_session`).
            let base = content.strip_suffix(rules_text.as_str()).unwrap_or(content);
            system += tok(base);
            rules = tok(&rules_text).min(tok(content));
        } else if role == "system" {
            summarized += tok(content);
        } else {
            conversation += crate::images::message_tokens(m) as u32;
        }
    }
    let tools = builtin_tools(mode)
        .as_array()
        .map(|a| a.iter().map(|t| estimate_tokens(&t.to_string()) as u32).sum())
        .unwrap_or(0);
    ContextParts {
        system,
        rules,
        tools,
        mcp_tools: 0,
        summarized,
        conversation,
    }
}

/// Combine estimates with the provider's measured total: when measured, each part is scaled
/// so the parts add up exactly to `used` (rounding goes to conversation).
pub(super) fn build_usage(
    mut parts: ContextParts,
    mcp_tools: u32,
    measured: Option<u32>,
    model: String,
    window: u32,
) -> ContextUsage {
    parts.mcp_tools = mcp_tools;
    let est = parts.system
        + parts.rules
        + parts.tools
        + parts.mcp_tools
        + parts.summarized
        + parts.conversation;
    let Some(total) = measured.filter(|_| est > 0) else {
        return ContextUsage {
            used: est,
            window,
            model,
            measured: false,
            parts,
        };
    };
    let f = total as f64 / est as f64;
    let scale = |n: u32| (n as f64 * f).round() as u32;
    let mut scaled = ContextParts {
        system: scale(parts.system),
        rules: scale(parts.rules),
        tools: scale(parts.tools),
        mcp_tools: scale(parts.mcp_tools),
        summarized: scale(parts.summarized),
        conversation: 0,
    };
    let others = scaled.system + scaled.rules + scaled.tools + scaled.mcp_tools + scaled.summarized;
    scaled.conversation = total.saturating_sub(others);
    ContextUsage {
        used: others + scaled.conversation,
        window,
        model,
        measured: true,
        parts: scaled,
    }
}
