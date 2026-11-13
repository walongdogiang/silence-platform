//! MCP servers per workspace (`.silence/mcp.json`) and the RPC behind Settings → Tools.
//!
//! A server is a command the Engine runs, and a workspace file can come from a cloned repo.
//! So a server from the file only starts after the user on *this machine* allowed that exact
//! command (`<data_dir>/mcp-approved.json`). Adding a server from Studio allows it at once.
//! Env values never leave the Engine: `mcp.list` returns env names only. `${VAR}` in a value
//! is read from the Engine's environment at start, so secrets need not sit in the file.

use crate::agent::AppCtx;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use silence_protocol::McpServerConfig;
use silence_tools::Workspace;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const REL_PATH: &str = ".silence/mcp.json";
const APPROVED_FILE: &str = "mcp-approved.json";
const MAX_NAME: usize = 40;

#[derive(Debug, Default, Serialize, Deserialize)]
struct McpFile {
    #[serde(default)]
    servers: Vec<McpServerConfig>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct ApprovedFile {
    #[serde(default)]
    approved: BTreeSet<String>,
}

/// Tool names are `mcp__<server>__<tool>`: keep server names short and plain.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= MAX_NAME
        && !name.contains("__")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

pub fn load(root: &Path) -> Result<Vec<McpServerConfig>> {
    let path = root.join(REL_PATH);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    let file: McpFile = serde_json::from_str(&raw).with_context(|| format!("parse {}", path.display()))?;
    Ok(file.servers)
}

pub fn save(root: &Path, servers: &[McpServerConfig]) -> Result<()> {
    let path = root.join(REL_PATH);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let file = McpFile { servers: servers.to_vec() };
    std::fs::write(&path, serde_json::to_string_pretty(&file)? + "\n")?;
    Ok(())
}

/// What the user allows: this workspace, this name, this exact command line and env names.
/// Changing any of them in the file needs a new approval.
pub fn fingerprint(root: &Path, cfg: &McpServerConfig) -> String {
    let env: Vec<&str> = cfg.env.iter().map(|(k, _)| k.as_str()).collect();
    format!(
        "{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}",
        root.to_string_lossy(),
        cfg.name,
        cfg.command,
        cfg.args.join("\u{1e}"),
        env.join(",")
    )
}

fn approved_path(data_dir: &Path) -> PathBuf {
    data_dir.join(APPROVED_FILE)
}

fn load_approved(data_dir: &Path) -> BTreeSet<String> {
    std::fs::read_to_string(approved_path(data_dir))
        .ok()
        .and_then(|raw| serde_json::from_str::<ApprovedFile>(&raw).ok())
        .map(|f| f.approved)
        .unwrap_or_default()
}

fn set_approved(data_dir: &Path, fp: String, on: bool) -> Result<()> {
    let mut approved = load_approved(data_dir);
    if on {
        approved.insert(fp);
    } else {
        approved.remove(&fp);
    }
    std::fs::create_dir_all(data_dir)?;
    let file = ApprovedFile { approved };
    std::fs::write(approved_path(data_dir), serde_json::to_string_pretty(&file)?)?;
    Ok(())
}

/// Replace `${VAR}` in env values with the Engine's environment (missing = empty).
pub fn expand_env(cfg: &McpServerConfig) -> McpServerConfig {
    let mut out = cfg.clone();
    for (_, v) in out.env.iter_mut() {
        *v = expand(v, |name| std::env::var(name).ok());
    }
    out
}

fn expand(value: &str, lookup: impl Fn(&str) -> Option<String>) -> String {
    let mut out = String::new();
    let mut rest = value;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find('}') {
            Some(end) => {
                out.push_str(&lookup(&after[..end]).unwrap_or_default());
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

fn workspace_root(params: &Value) -> Result<PathBuf> {
    let ws = params.get("workspace").and_then(Value::as_str).unwrap_or("");
    if ws.is_empty() {
        bail!("workspace is required");
    }
    Ok(Workspace::new(ws)?.root)
}

fn name_param(params: &Value) -> Result<String> {
    let name = params.get("name").and_then(Value::as_str).unwrap_or("").to_string();
    if !valid_name(&name) {
        bail!("invalid MCP server name");
    }
    Ok(name)
}

async fn start(ctx: &AppCtx, cfg: &McpServerConfig) -> Option<String> {
    match ctx.mcp.add(expand_env(cfg)).await {
        Ok(_) => None,
        Err(e) => Some(format!("{e:#}")),
    }
}

/// Start the enabled, approved servers of a workspace that are not running yet.
/// Called when a session opens; failures are logged and shown later by `mcp.list`.
pub async fn autostart(ctx: &AppCtx, workspace: &str) {
    let Ok(ws) = Workspace::new(workspace) else { return };
    let Ok(servers) = load(&ws.root) else { return };
    let approved = load_approved(ctx.audit.dir());
    for cfg in servers {
        if !cfg.enabled || !valid_name(&cfg.name) || ctx.mcp.is_running(&cfg.name).await {
            continue;
        }
        if !approved.contains(&fingerprint(&ws.root, &cfg)) {
            continue;
        }
        if let Some(err) = start(ctx, &cfg).await {
            tracing::warn!("mcp {}: {err}", cfg.name);
        }
    }
}

async fn view(ctx: &AppCtx, root: &Path, cfg: &McpServerConfig, error: Option<String>) -> Value {
    let approved = load_approved(ctx.audit.dir()).contains(&fingerprint(root, cfg));
    let tools = ctx.mcp.tools(&cfg.name).await;
    let status = if tools.is_some() {
        "running"
    } else if error.is_some() {
        "error"
    } else if !cfg.enabled {
        "off"
    } else if !approved {
        "needs_approval"
    } else {
        "stopped"
    };
    json!({
        "name": cfg.name,
        "command": cfg.command,
        "args": cfg.args,
        "env_keys": cfg.env.iter().map(|(k, _)| k).collect::<Vec<_>>(),
        "enabled": cfg.enabled,
        "approved": approved,
        "status": status,
        "error": error,
        "tools": tools.unwrap_or_default().iter()
            .map(|t| json!({"name": t.name, "description": t.description, "read_only": t.read_only}))
            .collect::<Vec<_>>(),
    })
}

/// `mcp.list {workspace}` → `{servers: [...]}`.
pub async fn rpc_list(ctx: &AppCtx, params: &Value) -> Result<Value> {
    let root = workspace_root(params)?;
    let mut out = Vec::new();
    for cfg in load(&root)? {
        out.push(view(ctx, &root, &cfg, None).await);
    }
    Ok(json!({ "servers": out }))
}

/// `mcp.add {workspace, server}`: save (replacing the same name), allow, start if enabled.
pub async fn rpc_add(ctx: &AppCtx, params: &Value) -> Result<Value> {
    let root = workspace_root(params)?;
    let cfg: McpServerConfig =
        serde_json::from_value(params.get("server").cloned().unwrap_or(Value::Null)).context("server")?;
    if !valid_name(&cfg.name) {
        bail!("invalid MCP server name");
    }
    if cfg.command.trim().is_empty() {
        bail!("command is required");
    }
    let mut servers = load(&root)?;
    servers.retain(|s| s.name != cfg.name);
    servers.push(cfg.clone());
    save(&root, &servers)?;
    set_approved(ctx.audit.dir(), fingerprint(&root, &cfg), true)?;
    ctx.mcp.remove(&cfg.name).await;
    let error = if cfg.enabled { start(ctx, &cfg).await } else { None };
    Ok(json!({ "server": view(ctx, &root, &cfg, error).await }))
}

/// `mcp.remove {workspace, name}`: stop, delete from the file, drop the approval.
pub async fn rpc_remove(ctx: &AppCtx, params: &Value) -> Result<Value> {
    let root = workspace_root(params)?;
    let name = name_param(params)?;
    let mut servers = load(&root)?;
    if let Some(cfg) = servers.iter().find(|s| s.name == name) {
        set_approved(ctx.audit.dir(), fingerprint(&root, cfg), false)?;
    }
    servers.retain(|s| s.name != name);
    save(&root, &servers)?;
    ctx.mcp.remove(&name).await;
    Ok(json!({ "ok": true }))
}

/// `mcp.set_enabled {workspace, name, enabled}`. Turning a server on is also the user's
/// approval for that exact command on this machine.
pub async fn rpc_set_enabled(ctx: &AppCtx, params: &Value) -> Result<Value> {
    let root = workspace_root(params)?;
    let name = name_param(params)?;
    let enabled = params.get("enabled").and_then(Value::as_bool).unwrap_or(false);
    let mut servers = load(&root)?;
    let Some(cfg) = servers.iter_mut().find(|s| s.name == name) else {
        bail!("no MCP server named {name}");
    };
    cfg.enabled = enabled;
    let cfg = cfg.clone();
    save(&root, &servers)?;
    ctx.mcp.remove(&name).await;
    let error = if enabled {
        set_approved(ctx.audit.dir(), fingerprint(&root, &cfg), true)?;
        start(ctx, &cfg).await
    } else {
        None
    };
    Ok(json!({ "server": view(ctx, &root, &cfg, error).await }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(name: &str) -> McpServerConfig {
        McpServerConfig {
            name: name.into(),
            command: "node".into(),
            args: vec!["server.js".into()],
            env: vec![("TOKEN".into(), "${SILENCE_TEST_TOKEN}".into())],
            enabled: true,
        }
    }

    #[test]
    fn names_are_short_and_plain() {
        assert!(valid_name("github"));
        assert!(valid_name("my-server_2"));
        assert!(!valid_name(""));
        assert!(!valid_name("a__b"));
        assert!(!valid_name("has space"));
        assert!(!valid_name(&"x".repeat(41)));
    }

    #[test]
    fn file_round_trips_and_missing_file_is_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load(dir.path()).unwrap().is_empty());
        save(dir.path(), &[cfg("a"), cfg("b")]).unwrap();
        let back = load(dir.path()).unwrap();
        assert_eq!(back.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        assert_eq!(back[0].env[0].1, "${SILENCE_TEST_TOKEN}");
    }

    #[test]
    fn approval_follows_the_exact_command() {
        let dir = tempfile::tempdir().unwrap();
        let root = Path::new("D:/ws");
        let a = cfg("a");
        set_approved(dir.path(), fingerprint(root, &a), true).unwrap();
        assert!(load_approved(dir.path()).contains(&fingerprint(root, &a)));
        let mut changed = a.clone();
        changed.args.push("--evil".into());
        assert!(!load_approved(dir.path()).contains(&fingerprint(root, &changed)));
        assert!(!load_approved(dir.path()).contains(&fingerprint(Path::new("D:/other"), &a)));
        set_approved(dir.path(), fingerprint(root, &a), false).unwrap();
        assert!(load_approved(dir.path()).is_empty());
    }

    #[test]
    fn env_refs_expand_from_the_engine_environment() {
        let look = |n: &str| (n == "T").then(|| "secret".to_string());
        assert_eq!(expand("${T}", look), "secret");
        assert_eq!(expand("Bearer ${T}!", look), "Bearer secret!");
        assert_eq!(expand("${MISSING}", look), "");
        assert_eq!(expand("plain", look), "plain");
        assert_eq!(expand("${open", look), "${open");
    }
}
