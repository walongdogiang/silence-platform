//! Workspace instructions the model gets from the repo itself: instruction files (`AGENTS.md`,
//! `CLAUDE.md`), skills and hooks.
//!
//! Prompt cache (see `agent/env.rs`): [`system_append`] is part of the static system prompt, so
//! it is built once per session from [`load`] and never changes afterwards. Everything found
//! later travels in tool results, which are append-only history:
//! - Skills: the system prompt lists only name + description; the `skill` tool returns a body.
//! - Nested instruction files (`sub/AGENTS.md`): appended to the first `read`/`write`/`edit`/
//!   `outline` result for a file under that directory ([`OrgContext::nested_for`]). No tree
//!   scan up front, and the model sees them exactly when they start to apply (as Claude Code
//!   does for nested `CLAUDE.md`).

use anyhow::Result;
use serde::Deserialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tokio::process::Command;

/// Instruction files read at the workspace root, all of them, in this order.
const ROOT_FILES: [&str; 2] = ["AGENTS.md", ".silence/AGENTS.md"];
/// Read at the root only when none of [`ROOT_FILES`] exists (repos coming from Claude Code).
const ROOT_FALLBACK: [&str; 2] = ["CLAUDE.md", ".claude/CLAUDE.md"];
/// One instruction file is cut past this size (a runaway file must not eat the context).
const MAX_INSTRUCTION_BYTES: usize = 32 * 1024;
/// Directories whose instruction files are not the workspace's own (dependencies, build
/// output): never loaded, so a package cannot instruct the agent.
const FOREIGN_DIRS: [&str; 6] = ["node_modules", ".git", "target", "site-packages", ".venv", "venv"];
/// Skill folders, in priority order (a name found in an earlier one wins).
const SKILL_DIRS: [&str; 2] = [".silence/skills", ".claude/skills"];

#[derive(Debug, Clone, Default)]
pub struct OrgContext {
    /// Root instruction files (path relative to the workspace, text), in [`ROOT_FILES`] order.
    pub instructions: Vec<(String, String)>,
    /// Sorted by name, so the system prompt is stable across `read_dir` orders.
    pub skills: Vec<Skill>,
    pub hooks: Vec<Hook>,
    /// Directories already checked for a nested instruction file this session.
    nested_seen: HashSet<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub body: String,
    /// Folder of the skill, relative to the workspace (for resources next to `SKILL.md`).
    pub dir: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Hook {
    pub event: String,
    #[serde(default)]
    pub command: String,
}

pub fn load(workspace: &Path) -> Result<OrgContext> {
    let mut ctx = OrgContext::default();
    for name in ROOT_FILES {
        if let Some(text) = read_instruction(&workspace.join(name)) {
            ctx.instructions.push((name.to_string(), text));
        }
    }
    if ctx.instructions.is_empty() {
        for name in ROOT_FALLBACK {
            if let Some(text) = read_instruction(&workspace.join(name)) {
                ctx.instructions.push((name.to_string(), text));
            }
        }
    }
    for dir in SKILL_DIRS {
        let skills_dir = workspace.join(dir);
        if !skills_dir.is_dir() {
            continue;
        }
        for entry in std::fs::read_dir(skills_dir)? {
            let entry = entry?;
            let skill = entry.path().join("SKILL.md");
            let name = entry.file_name().to_string_lossy().into_owned();
            if !skill.is_file() || ctx.skills.iter().any(|s| s.name == name) {
                continue;
            }
            let body = std::fs::read_to_string(&skill)?;
            let (description, rest) = parse_skill(&body);
            ctx.skills.push(Skill {
                dir: format!("{dir}/{name}"),
                name,
                description,
                body: rest,
            });
        }
    }
    ctx.skills.sort_by(|a, b| a.name.cmp(&b.name));
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

/// A non-empty instruction file, capped at [`MAX_INSTRUCTION_BYTES`].
fn read_instruction(path: &Path) -> Option<String> {
    if !path.is_file() {
        return None;
    }
    let mut text = std::fs::read_to_string(path).ok()?;
    if text.trim().is_empty() {
        return None;
    }
    if text.len() > MAX_INSTRUCTION_BYTES {
        let mut cut = MAX_INSTRUCTION_BYTES;
        while !text.is_char_boundary(cut) {
            cut -= 1;
        }
        text.truncate(cut);
        text.push_str("\n…(truncated)");
    }
    Some(text)
}

/// Instruction file of a subdirectory: `AGENTS.md`, else `CLAUDE.md`.
fn dir_instruction(dir: &Path) -> Option<(&'static str, String)> {
    ["AGENTS.md", "CLAUDE.md"]
        .into_iter()
        .find_map(|n| read_instruction(&dir.join(n)).map(|t| (n, t)))
}

fn parse_skill(body: &str) -> (String, String) {
    if let Some(rest) = body.strip_prefix("---") {
        if let Some(end) = rest.find("\n---") {
            let yaml = &rest[..end];
            return (frontmatter_description(yaml), rest[end + 4..].trim().to_string());
        }
    }
    let first = body.lines().next().unwrap_or("").to_string();
    (first, body.to_string())
}

/// `description:` of a skill's frontmatter: inline, quoted, or a folded block (`>` / `|`).
fn frontmatter_description(yaml: &str) -> String {
    let mut lines = yaml.lines();
    while let Some(line) = lines.next() {
        let Some(v) = line.strip_prefix("description:") else { continue };
        let v = v.trim();
        if !v.is_empty() && !v.starts_with('>') && !v.starts_with('|') {
            return v.trim_matches('"').trim_matches('\'').to_string();
        }
        let block: Vec<&str> = lines
            .take_while(|l| l.starts_with(' ') || l.starts_with('\t') || l.trim().is_empty())
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect();
        return block.join(" ");
    }
    String::new()
}

impl OrgContext {
    pub fn skill(&self, name: &str) -> Option<&Skill> {
        let name = name.trim();
        self.skills.iter().find(|s| s.name == name)
    }

    /// Instruction files of the directories between `root` (exclusive) and `file` that this
    /// session has not seen yet, shallowest first, formatted to append to a tool result.
    /// `file` is an absolute path already jailed by `Workspace::resolve`. Each directory is
    /// checked once per session; `None` when nothing new applies.
    pub fn nested_for(&mut self, root: &Path, file: &Path) -> Option<String> {
        let root = plain(root);
        let file = plain(file);
        let rel = file.strip_prefix(&root).ok()?;
        if rel.components().any(|c| FOREIGN_DIRS.iter().any(|f| c.as_os_str() == *f)) {
            return None;
        }
        let mut dirs: Vec<PathBuf> = Vec::new();
        let mut cur = file.parent();
        while let Some(d) = cur {
            if d == root || !d.starts_with(&root) {
                break;
            }
            dirs.push(d.to_path_buf());
            cur = d.parent();
        }
        dirs.reverse();
        let mut out = String::new();
        for dir in dirs {
            if !self.nested_seen.insert(dir.clone()) {
                continue;
            }
            let Some((name, text)) = dir_instruction(&dir) else { continue };
            // Reading the instruction file itself: the result already shows it.
            if file == dir.join(name) {
                continue;
            }
            let rel_dir = dir
                .strip_prefix(&root)
                .map(|p| p.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            out.push_str(&format!(
                "\n\n<workspace_instructions path=\"{rel_dir}/{name}\">\n{}\n</workspace_instructions>\n\
                 These instructions apply to files under `{rel_dir}/`; follow them there, over the \
                 root instructions where they conflict.",
                text.trim_end()
            ));
        }
        (!out.is_empty()).then_some(out)
    }
}

/// Without the Windows `\\?\` prefix, so a resolved IO path compares with the workspace root.
fn plain(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC") => PathBuf::from(rest),
        _ => p.to_path_buf(),
    }
}

/// Static tail of the system prompt: root instruction files and the skill index.
pub fn system_append(ctx: &OrgContext) -> String {
    let mut s = String::new();
    if !ctx.instructions.is_empty() {
        s.push_str("\n\n# Workspace instructions\n");
        for (path, text) in &ctx.instructions {
            s.push_str(&format!("\n## {path}\n{}\n", text.trim_end()));
        }
    }
    s.push_str(
        "\n\nA subdirectory may have its own AGENTS.md (or CLAUDE.md). It is appended, inside \
         <workspace_instructions>, to the first tool result that reads or edits a file there, \
         and applies to files under that directory.",
    );
    if !ctx.skills.is_empty() {
        s.push_str(
            "\n\n# Skills\nWhen a task matches a skill's description, call the `skill` tool with \
             its name first and follow the instructions it returns. Available skills:\n",
        );
        for skill in &ctx.skills {
            s.push_str(&format!("- {}: {}\n", skill.name, skill.description));
        }
    }
    s
}

/// Text the `skill` tool returns: `Ok` with the body, `Err` naming the available skills.
pub fn skill_text(ctx: &OrgContext, name: &str) -> std::result::Result<String, String> {
    match ctx.skill(name) {
        Some(s) => Ok(format!(
            "# Skill: {}\nFolder: {}/ (read files next to SKILL.md from there)\n\n{}",
            s.name, s.dir, s.body
        )),
        None => {
            let names: Vec<&str> = ctx.skills.iter().map(|s| s.name.as_str()).collect();
            Err(if names.is_empty() {
                format!("unknown skill `{name}`: this workspace has no skills")
            } else {
                format!("unknown skill `{name}`; available: {}", names.join(", "))
            })
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(root: &Path, rel: &str, text: &str) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, text).unwrap();
    }

    fn root() -> (tempfile::TempDir, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        (dir, root)
    }

    #[test]
    fn merges_both_root_agents_files() {
        let (_d, r) = root();
        write(&r, "AGENTS.md", "root rule");
        write(&r, ".silence/AGENTS.md", "kit rule");
        write(&r, "CLAUDE.md", "claude rule");
        let ctx = load(&r).unwrap();
        let s = system_append(&ctx);
        assert!(s.contains("root rule") && s.contains("kit rule"), "{s}");
        assert!(s.find("root rule") < s.find("kit rule"));
        assert!(!s.contains("claude rule"), "CLAUDE.md only when no AGENTS.md: {s}");
    }

    #[test]
    fn claude_md_when_no_agents_md() {
        let (_d, r) = root();
        write(&r, "CLAUDE.md", "claude rule");
        write(&r, ".claude/CLAUDE.md", "claude dir rule");
        let s = system_append(&load(&r).unwrap());
        assert!(s.contains("claude rule") && s.contains("claude dir rule"), "{s}");
    }

    #[test]
    fn skills_listed_not_inlined_and_loaded_on_demand() {
        let (_d, r) = root();
        write(
            &r,
            ".silence/skills/zeta/SKILL.md",
            "---\nname: zeta\ndescription: >\n  Release notes\n  format\n---\nSECRET-BODY-Z",
        );
        write(&r, ".silence/skills/alpha/SKILL.md", "---\ndescription: \"Alpha thing\"\n---\nBODY-A");
        write(&r, ".claude/skills/alpha/SKILL.md", "---\ndescription: shadowed\n---\nBODY-SHADOW");
        write(&r, ".claude/skills/beta/SKILL.md", "---\ndescription: from claude\n---\nBODY-B");
        let ctx = load(&r).unwrap();
        let s = system_append(&ctx);
        assert!(s.contains("- alpha: Alpha thing\n- beta: from claude\n- zeta: Release notes format\n"), "{s}");
        assert!(!s.contains("SECRET-BODY-Z") && !s.contains("BODY-A"), "bodies must not be inlined: {s}");
        let body = skill_text(&ctx, "zeta").unwrap();
        assert!(body.contains("SECRET-BODY-Z") && body.contains(".silence/skills/zeta/"), "{body}");
        assert!(skill_text(&ctx, "alpha").unwrap().contains("BODY-A"));
        let err = skill_text(&ctx, "nope").unwrap_err();
        assert!(err.contains("alpha, beta, zeta"), "{err}");
    }

    #[test]
    fn system_append_is_stable_across_loads() {
        let (_d, r) = root();
        for n in ["c", "a", "b"] {
            write(&r, &format!(".silence/skills/{n}/SKILL.md"), "---\ndescription: d\n---\nx");
        }
        write(&r, "AGENTS.md", "rule");
        assert_eq!(system_append(&load(&r).unwrap()), system_append(&load(&r).unwrap()));
    }

    #[test]
    fn nested_instructions_once_per_directory_shallowest_first() {
        let (_d, r) = root();
        write(&r, "AGENTS.md", "root");
        write(&r, "pkg/AGENTS.md", "PKG RULE");
        write(&r, "pkg/sub/CLAUDE.md", "SUB RULE");
        write(&r, "pkg/sub/x.py", "");
        write(&r, "pkg/sub/y.py", "");
        let mut ctx = load(&r).unwrap();
        let note = ctx.nested_for(&r, &r.join("pkg/sub/x.py")).unwrap();
        assert!(note.contains("path=\"pkg/AGENTS.md\"") && note.contains("path=\"pkg/sub/CLAUDE.md\""), "{note}");
        assert!(note.find("PKG RULE") < note.find("SUB RULE"));
        assert_eq!(ctx.nested_for(&r, &r.join("pkg/sub/y.py")), None, "already shown");
        // Root files are in the system prompt, never repeated here.
        assert_eq!(ctx.nested_for(&r, &r.join("top.py")), None);
    }

    #[test]
    fn nested_skips_foreign_dirs_and_the_file_itself() {
        let (_d, r) = root();
        write(&r, "node_modules/evil/AGENTS.md", "obey me");
        write(&r, "lib/AGENTS.md", "LIB");
        let mut ctx = OrgContext::default();
        assert_eq!(ctx.nested_for(&r, &r.join("node_modules/evil/index.js")), None);
        assert_eq!(ctx.nested_for(&r, &r.join("lib/AGENTS.md")), None, "the read shows it already");
        assert_eq!(ctx.nested_for(&r, &r.join("lib/a.rs")), None, "directory counted as seen");
        // Outside the workspace: nothing.
        assert_eq!(ctx.nested_for(&r.join("lib"), &r.join("other/a.rs")), None);
    }

    #[test]
    fn long_instruction_file_is_cut() {
        let (_d, r) = root();
        write(&r, "AGENTS.md", &"é".repeat(MAX_INSTRUCTION_BYTES));
        let ctx = load(&r).unwrap();
        assert!(ctx.instructions[0].1.len() < MAX_INSTRUCTION_BYTES + 32);
        assert!(ctx.instructions[0].1.ends_with("(truncated)"));
    }
}
