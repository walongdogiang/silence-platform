use anyhow::Result;
use serde::Deserialize;
use std::path::Path;
use tokio::process::Command;

#[derive(Debug, Clone, Default)]
pub struct OrgContext {
    pub agents_md: String,
    pub skills: Vec<Skill>,
    pub hooks: Vec<Hook>,
}

#[derive(Debug, Clone)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub body: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Hook {
    pub event: String,
    #[serde(default)]
    pub command: String,
}

pub fn load(workspace: &Path) -> Result<OrgContext> {
    let mut ctx = OrgContext::default();
    for name in ["AGENTS.md", ".silence/AGENTS.md"] {
        let p = workspace.join(name);
        if p.exists() {
            ctx.agents_md = std::fs::read_to_string(p)?;
            break;
        }
    }
    let skills_dir = workspace.join(".silence/skills");
    if skills_dir.is_dir() {
        for entry in std::fs::read_dir(skills_dir)? {
            let entry = entry?;
            let skill = entry.path().join("SKILL.md");
            if skill.is_file() {
                let body = std::fs::read_to_string(&skill)?;
                let (description, rest) = parse_skill(&body);
                ctx.skills.push(Skill {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    description,
                    body: rest,
                });
            }
        }
    }
    let hooks_dir = workspace.join(".silence/hooks");
    if hooks_dir.is_dir() {
        for entry in std::fs::read_dir(hooks_dir)? {
            let path = entry?.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                let text = std::fs::read_to_string(&path)?;
                if let Ok(hook) = serde_json::from_str::<Hook>(&text) {
                    ctx.hooks.push(hook);
                }
            }
        }
    }
    Ok(ctx)
}

fn parse_skill(body: &str) -> (String, String) {
    if let Some(rest) = body.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let yaml = &rest[..end];
            let desc = yaml
                .lines()
                .find_map(|l| l.strip_prefix("description:"))
                .map(|s| s.trim().trim_matches('"').to_string())
                .unwrap_or_default();
            return (desc, rest[end + 4..].trim().to_string());
        }
    }
    let first = body.lines().next().unwrap_or("").to_string();
    (first, body.to_string())
}

pub fn system_append(ctx: &OrgContext) -> String {
    let mut s = String::new();
    if !ctx.agents_md.is_empty() {
        s.push_str("\n\n# Workspace AGENTS.md\n");
        s.push_str(&ctx.agents_md);
    }
    if !ctx.skills.is_empty() {
        s.push_str("\n\n# Skills (use when description matches)\n");
        for skill in &ctx.skills {
            s.push_str(&format!("## {}\n{}\n{}\n", skill.name, skill.description, skill.body));
        }
    }
    s
}

pub async fn run_hook(ctx: &OrgContext, event: &str, payload: &str) -> Result<String> {
    let mut logs = Vec::new();
    for hook in ctx.hooks.iter().filter(|h| h.event == event) {
        if hook.command.is_empty() {
            continue;
        }
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("powershell");
            c.args(["-NoProfile", "-Command", &hook.command]);
            c
        } else {
            let mut c = Command::new("bash");
            c.args(["-lc", &hook.command]);
            c
        };
        cmd.env("SILENCE_HOOK_PAYLOAD", payload);
        let out = cmd.output().await?;
        logs.push(String::from_utf8_lossy(&out.stdout).into_owned());
    }
    Ok(logs.join("\n"))
}
