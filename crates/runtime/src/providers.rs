//! Model sources (Settings → Model sources): status, runtime keys, the provider Auto prefers.
//! Keys are written here but never read back out over RPC: status only says `has_key`.

use crate::audit::{AuditEvent, AuditLog};
use anyhow::Result;
use serde_json::{json, Value};
use silence_protocol::{CliAccount, CliInfo, CliUsage, ModelInfo};
use silence_router::{Catalog, Provider};
use std::time::Duration;

/// Executable names to try: on Windows an npm install is `claude.cmd`, a native one `claude.exe`.
pub fn cli_candidates(command: &str) -> Vec<String> {
    let cmd = if command.is_empty() { "claude" } else { command };
    let mut out = vec![cmd.to_string()];
    if cfg!(windows) && std::path::Path::new(cmd).extension().is_none() {
        out.push(format!("{cmd}.cmd"));
    }
    out
}

/// A `tokio` command without a console window (GUI parent on Windows).
pub fn quiet_command(program: &str) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut c = tokio::process::Command::new(program);
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW
        c.creation_flags(0x0800_0000);
    }
    c
}

/// `(program, version)` of the first candidate whose `--version` answers, or `None` when the
/// CLI is missing / does not answer in time.
pub async fn resolve_cli(command: &str) -> Option<(String, String)> {
    for program in cli_candidates(command) {
        let mut c = quiet_command(&program);
        c.arg("--version").kill_on_drop(true);
        let Ok(Ok(out)) = tokio::time::timeout(Duration::from_secs(5), c.output()).await else {
            continue;
        };
        if !out.status.success() {
            continue;
        }
        let v = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !v.is_empty() {
            return Some((program, v));
        }
    }
    None
}

pub async fn cli_version(command: &str) -> Option<String> {
    resolve_cli(command).await.map(|(_, v)| v)
}

/// `claude auth status --json` → account. Free (no model call). `None` on failure / timeout.
async fn cli_account(program: &str) -> Option<CliAccount> {
    let mut c = quiet_command(program);
    c.args(["auth", "status", "--json"]).kill_on_drop(true);
    let out = tokio::time::timeout(Duration::from_secs(8), c.output()).await.ok()?.ok()?;
    // Logged out still prints JSON (`loggedIn: false`) on some versions, with a non-zero exit.
    let v: Value = serde_json::from_slice(&out.stdout).ok()?;
    Some(parse_auth_status(&v))
}

/// Pure mapping of `claude auth status --json` (field names as the CLI prints them).
pub fn parse_auth_status(v: &Value) -> CliAccount {
    let s = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let plan = {
        let p = s("subscriptionType");
        if p.is_empty() { s("planTier") } else { p }
    };
    CliAccount {
        logged_in: v.get("loggedIn").and_then(Value::as_bool).unwrap_or(false),
        email: s("email"),
        org_name: s("orgName"),
        plan,
        auth_method: s("authMethod"),
        api_provider: s("apiProvider"),
        login_expires_at: s("loginExpiresAt"),
        config_dir: s("configDirectory"),
    }
}

/// Turns and CLI-reported cost (`total_cost_usd`) of CLI turns in the audit log; "today" is the
/// local calendar day.
pub fn cli_usage(events: &[AuditEvent], today: chrono::NaiveDate) -> CliUsage {
    let mut u = CliUsage::default();
    for e in events {
        if e.kind != "completion" || e.detail.get("backend").and_then(Value::as_str) != Some("claude_cli") {
            continue;
        }
        u.turns_total += 1;
        u.usd_total += e.usd;
        let day = chrono::DateTime::parse_from_rfc3339(&e.ts)
            .map(|t| t.with_timezone(&chrono::Local).date_naive())
            .ok();
        if day == Some(today) {
            u.turns_today += 1;
            u.usd_today += e.usd;
        }
    }
    u
}

/// `providers.cli_info`: everything Settings shows about the Claude CLI source.
pub async fn cli_info(catalog: &Catalog, audit: &AuditLog) -> Result<CliInfo> {
    let p = catalog
        .raw
        .providers
        .iter()
        .find(|p| p.is_cli())
        .ok_or_else(|| anyhow::anyhow!("no Claude CLI source in the catalog"))?;
    let models = catalog
        .raw
        .models
        .iter()
        .filter(|m| m.provider == p.id)
        .map(|m| (if m.label.is_empty() { m.id.clone() } else { m.label.clone() }, m.api_model.clone()))
        .collect();
    let events = audit.query(None, 50_000).unwrap_or_default();
    let usage = cli_usage(&events, chrono::Local::now().date_naive());
    let mut info = CliInfo {
        provider: p.id.clone(),
        safeguards: crate::agent::cli_safeguards(),
        models,
        usage,
        ..Default::default()
    };
    if let Some((program, version)) = resolve_cli(&p.command).await {
        info.installed = true;
        info.account = cli_account(&program).await;
        info.program = program;
        info.version = version;
    } else {
        info.program = if p.command.is_empty() { "claude".into() } else { p.command.clone() };
    }
    Ok(info)
}

async fn provider_status(catalog: &Catalog, p: &Provider) -> Value {
    let needs_key = !p.api_key_env.is_empty();
    let has_key = needs_key && !catalog.api_key(p).is_empty();
    let (cli, available, reason) = if p.is_cli() {
        match cli_version(&p.command).await {
            Some(v) => (Some(v), true, String::new()),
            None => (None, false, "`claude` (Claude CLI) not found on this machine".to_string()),
        }
    } else if needs_key && !has_key {
        (None, false, format!("No {} key", p.display_label()))
    } else {
        (None, true, String::new())
    };
    json!({
        "id": p.id,
        "label": p.display_label(),
        "kind": p.kind,
        "has_key": has_key,
        "needs_key": needs_key,
        "cli_version": cli.unwrap_or_default(),
        "available": available,
        "unavailable_reason": reason,
    })
}

/// `providers.status`
pub async fn status(catalog: &Catalog) -> Value {
    let mut rows = Vec::new();
    for p in &catalog.raw.providers {
        rows.push(provider_status(catalog, p).await);
    }
    json!({"providers": rows, "preferred": catalog.preferred()})
}

/// `models.list` rows, with CLI models marked unavailable when the CLI is missing.
pub async fn model_infos(catalog: &Catalog) -> Vec<ModelInfo> {
    let mut infos = catalog.infos();
    for p in catalog.raw.providers.iter().filter(|p| p.is_cli()) {
        if !infos.iter().any(|m| m.provider == p.id) {
            continue;
        }
        if cli_version(&p.command).await.is_none() {
            for m in infos.iter_mut().filter(|m| m.provider == p.id) {
                m.available = false;
                m.unavailable_reason = "Claude CLI not installed".into();
            }
        }
    }
    infos
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn auth_status_maps_fields() {
        let v = json!({"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty",
            "email": "a@b.c", "orgName": "Org", "subscriptionType": "max",
            "loginExpiresAt": "2026-12-06T22:45:56.206Z", "configDirectory": "C:\\cfg"});
        let a = parse_auth_status(&v);
        assert!(a.logged_in);
        assert_eq!(a.plan, "max");
        assert_eq!(a.auth_method, "claude.ai");
        assert_eq!(a.config_dir, "C:\\cfg");
        let fallback = parse_auth_status(&json!({"loggedIn": false, "planTier": "pro"}));
        assert!(!fallback.logged_in);
        assert_eq!(fallback.plan, "pro");
        assert_eq!(fallback.email, "");
    }

    #[test]
    fn usage_counts_only_cli_completions() {
        let ev = |ts: &str, kind: &str, backend: Option<&str>, usd: f64| AuditEvent {
            ts: ts.into(),
            session_id: "s".into(),
            kind: kind.into(),
            model: "m".into(),
            tool: String::new(),
            path: String::new(),
            input_tokens: 0,
            output_tokens: 0,
            usd,
            detail: match backend {
                Some(b) => json!({"backend": b}),
                None => json!({}),
            },
        };
        let now = chrono::Local::now();
        let today = now.date_naive();
        let events = vec![
            ev(&now.to_rfc3339(), "completion", Some("claude_cli"), 0.5),
            ev("2020-01-01T00:00:00Z", "completion", Some("claude_cli"), 1.0),
            ev(&now.to_rfc3339(), "completion", None, 9.0),
            ev(&now.to_rfc3339(), "tool", Some("claude_cli"), 9.0),
        ];
        let u = cli_usage(&events, today);
        assert_eq!((u.turns_today, u.turns_total), (1, 2));
        assert!((u.usd_today - 0.5).abs() < 1e-9 && (u.usd_total - 1.5).abs() < 1e-9);
    }
}
