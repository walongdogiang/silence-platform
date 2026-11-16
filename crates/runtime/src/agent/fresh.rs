//! Stale-write guard. The Engine remembers each file as the agent last read or wrote it. If the
//! file changed on disk since then (the user typing in an editor, another program, a command the
//! agent ran), `write` is refused until the agent reads it again, so those changes are never
//! overwritten silently. `edit` still runs (its `old_string` must match the current text) but the
//! model is told the file moved under it.
//!
//! The hash is for change detection only, not a security boundary.

use super::*;
use std::hash::{Hash, Hasher};

pub(super) fn stamp(text: &str) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut h);
    h.finish()
}

/// Workspace-relative key for a tool `path` argument, so `src/a.rs` and an absolute path match.
fn key(ws: &Workspace, args: &Value) -> Option<String> {
    let rel = args.get("path").and_then(Value::as_str)?;
    ws.resolve(rel).ok().map(|p| ws.rel(&p))
}

/// The file as it is now, if it differs from what the agent last saw. `None` when the agent has
/// not seen it yet (nothing to compare) or it is unchanged.
async fn changed_since_seen(session_arc: &Arc<Mutex<Session>>, args: &Value) -> Option<String> {
    let s = session_arc.lock().await;
    let k = key(&s.workspace, args)?;
    let seen = *s.seen.get(&k)?;
    let path = s.workspace.resolve(&k).ok()?;
    // Deleted since: the write would recreate it, which loses nothing.
    let now = std::fs::read_to_string(path).ok()?;
    (stamp(&now) != seen).then_some(k)
}

/// Refusal text for a `write` over a file that changed since the agent last saw it.
pub(super) async fn stale_write(session_arc: &Arc<Mutex<Session>>, tc: &ToolCall, args: &Value) -> Option<String> {
    if tc.name != "write" {
        return None;
    }
    let path = changed_since_seen(session_arc, args).await?;
    Some(format!(
        "refused: {path} changed on disk since you last read or wrote it (the user, another program, \
         or a command you ran changed it). Read it again and keep those changes, then write."
    ))
}

/// Note for the model when an `edit` lands on a file that changed since the agent last saw it.
pub(super) async fn stale_edit_note(session_arc: &Arc<Mutex<Session>>, tc: &ToolCall, args: &Value) -> Option<String> {
    if tc.name != "edit" {
        return None;
    }
    let path = changed_since_seen(session_arc, args).await?;
    Some(format!(
        "\nNote: {path} had changed on disk since you last read it (the user, another program, or a \
         command you ran). The edit applied to the current text; read the file again if your change \
         depends on other parts of it."
    ))
}

/// Remember what the agent now knows of a file after a successful tool call.
pub(super) async fn after_tool(session_arc: &Arc<Mutex<Session>>, tool: &str, args: &Value, out: &silence_tools::ToolOutput) {
    if !out.ok {
        return;
    }
    let mut s = session_arc.lock().await;
    match tool {
        "write" | "edit" => {
            if let Some(d) = &out.diff {
                let h = stamp(&d.after);
                s.seen.insert(d.path.clone(), h);
            }
        }
        "read" | "outline" => {
            let Some(k) = key(&s.workspace, args) else { return };
            let Ok(path) = s.workspace.resolve(&k) else { return };
            if let Ok(text) = std::fs::read_to_string(path) {
                s.seen.insert(k, stamp(&text));
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(name: &str) -> ToolCall {
        ToolCall {
            id: "c1".into(),
            name: name.into(),
            arguments: String::new(),
        }
    }

    fn ok_out() -> silence_tools::ToolOutput {
        silence_tools::ToolOutput {
            ok: true,
            output: String::new(),
            diff: None,
        }
    }

    fn test_ctx(data: &std::path::Path) -> AppCtx {
        let raw = serde_json::from_value(json!({"version": 1, "providers": [], "models": []})).unwrap();
        AppCtx::new(Catalog::from_raw(raw), AuditLog::open(data).unwrap())
    }

    async fn balanced(ctx: &AppCtx, ws: &std::path::Path) -> Arc<Mutex<Session>> {
        let id = create_session(ctx, ws.to_str().unwrap(), None, SessionMode::Agent, PermissionMode::Balanced)
            .await
            .unwrap();
        ctx.sessions.lock().await.get(&id).cloned().unwrap()
    }

    async fn session_in(dir: &std::path::Path) -> Arc<Mutex<Session>> {
        let data = tempfile::tempdir().unwrap();
        let ctx = test_ctx(data.path());
        balanced(&ctx, dir).await
    }

    fn tool(name: &str, args: Value) -> ToolCall {
        ToolCall {
            id: "c1".into(),
            name: name.into(),
            arguments: args.to_string(),
        }
    }

    /// End to end through `dispatch_tool`: the user's change survives an agent `write`.
    #[tokio::test]
    async fn dispatch_keeps_the_users_change() {
        let (ws, data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let file = ws.path().join("a.py");
        std::fs::write(&file, "a = 1\n").unwrap();
        let ctx = test_ctx(data.path());
        let s = balanced(&ctx, ws.path()).await;

        dispatch_tool(&ctx, &s, &None, &tool("read", json!({"path": "a.py"}))).await.unwrap();
        std::fs::write(&file, "a = 1\nb = 2  # typed by the user\n").unwrap();
        let w = tool("write", json!({"path": "a.py", "contents": "a = 3\n"}));
        let out = dispatch_tool(&ctx, &s, &None, &w).await.unwrap();
        assert!(out.contains("refused"), "{out}");
        assert!(s.lock().await.pending_perm.is_empty(), "refusal must not ask the user first");
        assert!(std::fs::read_to_string(&file).unwrap().contains("typed by the user"));

        // After a fresh read the same write goes through.
        dispatch_tool(&ctx, &s, &None, &tool("read", json!({"path": "a.py"}))).await.unwrap();
        let out = dispatch_tool(&ctx, &s, &None, &w).await.unwrap();
        assert!(!out.contains("refused"), "{out}");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "a = 3\n");

        // Its own write is the baseline: a second write needs no re-read.
        let w2 = tool("write", json!({"path": "a.py", "contents": "a = 4\n"}));
        dispatch_tool(&ctx, &s, &None, &w2).await.unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "a = 4\n");

        // An edit over an outside change runs, with a note for the model.
        std::fs::write(&file, "a = 4\nc = 5\n").unwrap();
        let e = tool("edit", json!({"path": "a.py", "old_string": "a = 4", "new_string": "a = 6"}));
        let out = dispatch_tool(&ctx, &s, &None, &e).await.unwrap();
        assert!(out.contains("had changed on disk"), "{out}");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "a = 6\nc = 5\n");
    }

    /// Ask/Allowlist: Apply on a proposal whose file changed since is refused, disk untouched.
    #[tokio::test]
    async fn staged_apply_refused_when_file_moved_on() {
        let (ws, data) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let file = ws.path().join("a.py");
        std::fs::write(&file, "a = 1\n").unwrap();
        let ctx = test_ctx(data.path());
        let s = balanced(&ctx, ws.path()).await;
        let sid = s.lock().await.id.clone();
        let pending = |after: &str| PendingEdit {
            before: "a = 1\n".into(),
            after: after.into(),
            tool: "edit".into(),
        };

        s.lock().await.pending_edits.insert("a.py".into(), pending("a = 2\n"));
        std::fs::write(&file, "a = 1\nb = 2\n").unwrap();
        let err = apply_diff(&ctx, &sid, "a.py", "").await.unwrap_err().to_string();
        assert!(err.contains("changed on disk"), "{err}");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "a = 1\nb = 2\n");

        // Unchanged file: Apply writes and becomes the agent's baseline.
        std::fs::write(&file, "a = 1\n").unwrap();
        s.lock().await.pending_edits.insert("a.py".into(), pending("a = 2\n"));
        apply_diff(&ctx, &sid, "a.py", "").await.unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "a = 2\n");
        assert!(stale_write(&s, &call("write"), &json!({"path": "a.py"})).await.is_none());
    }

    #[tokio::test]
    async fn write_refused_after_outside_change_until_reread() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "v1").unwrap();
        let s = session_in(dir.path()).await;
        let args = json!({"path": "a.txt"});

        // Never read: nothing to compare, write goes ahead.
        assert!(stale_write(&s, &call("write"), &args).await.is_none());

        after_tool(&s, "read", &args, &ok_out()).await;
        assert!(stale_write(&s, &call("write"), &args).await.is_none(), "unchanged file");

        std::fs::write(dir.path().join("a.txt"), "v2 from the user").unwrap();
        let msg = stale_write(&s, &call("write"), &args).await.expect("refused");
        assert!(msg.contains("a.txt") && msg.contains("Read it again"), "{msg}");

        // Re-reading takes the new text as the baseline.
        after_tool(&s, "read", &args, &ok_out()).await;
        assert!(stale_write(&s, &call("write"), &args).await.is_none());
    }

    #[tokio::test]
    async fn own_write_is_the_new_baseline() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "v1").unwrap();
        let s = session_in(dir.path()).await;
        let args = json!({"path": "a.txt"});
        after_tool(&s, "read", &args, &ok_out()).await;

        std::fs::write(dir.path().join("a.txt"), "v2").unwrap();
        let out = silence_tools::ToolOutput {
            ok: true,
            output: String::new(),
            diff: Some(silence_tools::FileDiff {
                path: "a.txt".into(),
                before: "v1".into(),
                after: "v2".into(),
            }),
        };
        after_tool(&s, "write", &args, &out).await;
        assert!(stale_write(&s, &call("write"), &args).await.is_none());
    }

    #[tokio::test]
    async fn edit_gets_a_note_not_a_refusal() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "v1").unwrap();
        let s = session_in(dir.path()).await;
        let args = json!({"path": "./a.txt"});
        after_tool(&s, "read", &args, &ok_out()).await;
        std::fs::write(dir.path().join("a.txt"), "v2").unwrap();

        assert!(stale_write(&s, &call("edit"), &args).await.is_none());
        let note = stale_edit_note(&s, &call("edit"), &json!({"path": "a.txt"})).await.expect("note");
        assert!(note.contains("a.txt"), "{note}");
    }

    #[tokio::test]
    async fn deleted_file_is_not_stale() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "v1").unwrap();
        let s = session_in(dir.path()).await;
        let args = json!({"path": "a.txt"});
        after_tool(&s, "read", &args, &ok_out()).await;
        std::fs::remove_file(dir.path().join("a.txt")).unwrap();
        assert!(stale_write(&s, &call("write"), &args).await.is_none());
    }
}
