use super::*;

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
pub(super) fn save_plan(root: &std::path::Path, plan: &str) -> Result<String> {
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
