use anyhow::{anyhow, Context, Result};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

pub mod image;
pub use image::{read_image, ImageFile};

/// Hard cap on any tool output handed back to the model (bytes). Longer output is cut with a note.
pub const MAX_OUTPUT_BYTES: usize = 30_000;
/// `read` without `limit` returns at most this many lines.
pub const READ_DEFAULT_LINES: usize = 400;
const READ_MAX_LINE_CHARS: usize = 500;
const GREP_MAX_LINE_CHARS: usize = 300;
const GREP_MAX_FILE_BYTES: u64 = 1_000_000;
const GREP_MAX_CONTEXT: usize = 5;
const OUTLINE_MAX_ENTRIES: usize = 300;

/// Clip one line to `max` chars (char-boundary safe), noting how much was dropped.
fn clip_line(line: &str, max: usize) -> String {
    match line.char_indices().nth(max) {
        None => line.to_string(),
        Some((cut, _)) => {
            let rest = line[cut..].chars().count();
            format!("{}…[+{rest} chars]", &line[..cut])
        }
    }
}

/// Cap total output at `MAX_OUTPUT_BYTES` (char-boundary safe) with a visible note.
pub fn cap_output(mut text: String) -> String {
    if text.len() <= MAX_OUTPUT_BYTES {
        return text;
    }
    let total = text.len();
    let mut cut = MAX_OUTPUT_BYTES;
    while !text.is_char_boundary(cut) {
        cut -= 1;
    }
    text.truncate(cut);
    text.push_str(&format!(
        "\n…[output truncated: {cut} of {total} bytes shown; narrow the request]"
    ));
    text
}

#[derive(Debug, Clone)]
pub struct Workspace {
    pub root: PathBuf,
}

impl Workspace {
    pub fn new(root: impl AsRef<Path>) -> Result<Self> {
        let root = dunce::canonicalize(root).context("canonicalize workspace")?;
        Ok(Self { root })
    }

    pub fn resolve(&self, rel: &str) -> Result<PathBuf> {
        let candidate = if Path::new(rel).is_absolute() {
            PathBuf::from(rel)
        } else {
            self.root.join(rel)
        };
        // Fold `.`/`..` first: for a path that does not exist yet (a new file) canonicalize
        // fails, and `root/../x` would otherwise still "start with" root.
        let candidate = normalize_lexical(&strip_extended(&candidate));
        let canon = canonicalize_existing_prefix(&candidate);
        // dunce keeps `\\?\` on paths too long to simplify; compare the plain form with the root.
        let canon = strip_extended(&canon);
        if !canon.starts_with(&self.root) {
            return Err(anyhow!("path escapes workspace: {}", canon.display()));
        }
        // The jail check above uses the plain path; only the returned IO path is extended.
        Ok(extended_path(canon))
    }

    pub fn rel(&self, path: &Path) -> String {
        let plain = strip_extended(path);
        plain
            .strip_prefix(&self.root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| path.display().to_string())
    }
}

/// Paths at or beyond this length (chars) get the `\\?\` prefix on Windows; classic `MAX_PATH`
/// is 260 and directory creation fails earlier (248), so leave headroom.
#[cfg(windows)]
const LONG_PATH_THRESHOLD: usize = 240;

/// Windows extended-length form (`\\?\C:\...`) for long absolute paths so file tools do not hit
/// `MAX_PATH`. Normalises `/` to `\` because the prefix disables Win32 path normalisation.
/// No-op elsewhere, for short paths, and for UNC / already-extended paths.
pub fn extended_path(p: PathBuf) -> PathBuf {
    #[cfg(windows)]
    {
        let s = p.to_string_lossy();
        if p.is_absolute() && s.len() >= LONG_PATH_THRESHOLD && !s.starts_with(r"\\") {
            return PathBuf::from(format!(r"\\?\{}", s.replace('/', "\\")));
        }
    }
    p
}

/// Remove `.` and fold `..` without touching the filesystem. A `..` at the root is dropped.
fn normalize_lexical(p: &Path) -> PathBuf {
    use std::path::Component;
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                if !matches!(out.components().next_back(), Some(Component::RootDir | Component::Prefix(_)) | None) {
                    out.pop();
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Canonicalize `p` (resolving symlinks). If it does not exist yet, canonicalize its nearest
/// existing ancestor and re-append the missing tail, so a new file under a symlinked directory
/// is judged by where it really lands.
fn canonicalize_existing_prefix(p: &Path) -> PathBuf {
    if let Ok(c) = dunce::canonicalize(p) {
        return c;
    }
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    let mut cur = p.to_path_buf();
    while let Some(name) = cur.file_name().map(|n| n.to_os_string()) {
        tail.push(name);
        if !cur.pop() {
            break;
        }
        if let Ok(mut base) = dunce::canonicalize(&cur) {
            for seg in tail.iter().rev() {
                base.push(seg);
            }
            return base;
        }
    }
    p.to_path_buf()
}

/// Inverse of [`extended_path`] for display / relative-path computation.
fn strip_extended(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => p.to_path_buf(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

pub fn specs(read_only: bool) -> Vec<ToolSpec> {
    let mut tools = vec![
        spec_read(),
        spec_outline(),
        spec_glob(),
        spec_grep(),
        spec_git_status(),
        spec_git_diff(),
    ];
    if !read_only {
        tools.extend([spec_write(), spec_edit(), spec_shell()]);
    }
    tools
}

pub fn openai_tools(read_only: bool) -> Value {
    let tools: Vec<Value> = specs(read_only)
        .into_iter()
        .map(|t| {
            json!({
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                }
            })
        })
        .collect();
    Value::Array(tools)
}

fn obj(props: Value, required: &[&str]) -> Value {
    json!({
        "type": "object",
        "properties": props,
        "required": required,
        "additionalProperties": false
    })
}

fn spec_read() -> ToolSpec {
    ToolSpec {
        name: "read".into(),
        description: "Read a UTF-8 text file with line numbers. Without `limit` returns at most 400 lines; \
            for large files use grep or outline first, then read only the line range you need."
            .into(),
        parameters: obj(
            json!({
                "path": {"type": "string"},
                "offset": {"type": "integer", "description": "1-based first line (default 1)."},
                "limit": {"type": "integer", "description": "Number of lines (default 400)."}
            }),
            &["path"],
        ),
    }
}

fn spec_outline() -> ToolSpec {
    ToolSpec {
        name: "outline".into(),
        description: "List a file's structure with line numbers (Markdown headings; declarations in \
            Rust, TS/JS, Python, Go) without reading the body. Use it to pick a line range for read."
            .into(),
        parameters: obj(json!({ "path": {"type": "string"} }), &["path"]),
    }
}

fn spec_write() -> ToolSpec {
    ToolSpec {
        name: "write".into(),
        description: "Write entire file contents (create or overwrite).".into(),
        parameters: obj(
            json!({
                "path": {"type": "string"},
                "contents": {"type": "string"}
            }),
            &["path", "contents"],
        ),
    }
}

fn spec_edit() -> ToolSpec {
    ToolSpec {
        name: "edit".into(),
        description: "Replace exact old_string with new_string. Fails if not unique unless replace_all.".into(),
        parameters: obj(
            json!({
                "path": {"type": "string"},
                "old_string": {"type": "string"},
                "new_string": {"type": "string"},
                "replace_all": {"type": "boolean"}
            }),
            &["path", "old_string", "new_string"],
        ),
    }
}

fn spec_glob() -> ToolSpec {
    ToolSpec {
        name: "glob".into(),
        description: "Find files by glob relative to workspace.".into(),
        parameters: obj(
            json!({
                "pattern": {"type": "string"},
                "head_limit": {"type": "integer"}
            }),
            &["pattern"],
        ),
    }
}

fn spec_grep() -> ToolSpec {
    ToolSpec {
        name: "grep".into(),
        description: "Regex search in workspace text files (respects .gitignore). Output modes: \
            `content` (path:line:text, default), `files` (matching paths only), `count` (path:matches). \
            Use `context` for surrounding lines instead of re-reading the file."
            .into(),
        parameters: obj(
            json!({
                "pattern": {"type": "string"},
                "glob": {"type": "string", "description": "Filter files, e.g. **/*.rs"},
                "output_mode": {"type": "string", "enum": ["content", "files", "count"]},
                "context": {"type": "integer", "description": "Lines of context around each match (0-5, content mode)."},
                "case_insensitive": {"type": "boolean"},
                "head_limit": {"type": "integer", "description": "Max matches (content) or entries (files/count). Default 80."}
            }),
            &["pattern"],
        ),
    }
}

fn spec_shell() -> ToolSpec {
    ToolSpec {
        name: "shell".into(),
        description: "Run a command in PowerShell (Windows) or bash. cwd must stay in workspace.".into(),
        parameters: obj(
            json!({
                "command": {"type": "string"},
                "timeout_ms": {"type": "integer"}
            }),
            &["command"],
        ),
    }
}

fn spec_git_status() -> ToolSpec {
    ToolSpec {
        name: "git_status".into(),
        description: "git status --porcelain=v1.".into(),
        parameters: obj(json!({}), &[]),
    }
}

fn spec_git_diff() -> ToolSpec {
    ToolSpec {
        name: "git_diff".into(),
        description: "git diff (optionally a path).".into(),
        parameters: obj(json!({ "path": {"type": "string"} }), &[]),
    }
}

#[derive(Debug, Clone)]
pub struct ToolOutput {
    pub ok: bool,
    pub output: String,
    pub diff: Option<FileDiff>,
}

#[derive(Debug, Clone)]
pub struct FileDiff {
    pub path: String,
    pub before: String,
    pub after: String,
}

pub async fn execute(ws: &Workspace, name: &str, args: &Value) -> Result<ToolOutput> {
    let mut out = execute_uncapped(ws, name, args).await?;
    out.output = cap_output(out.output);
    Ok(out)
}

async fn execute_uncapped(ws: &Workspace, name: &str, args: &Value) -> Result<ToolOutput> {
    match name {
        "read" => read(ws, args),
        "outline" => outline(ws, args),
        "write" => write(ws, args),
        "edit" => edit(ws, args),
        "glob" => glob_files(ws, args),
        "grep" => grep(ws, args),
        "shell" => shell(ws, args).await,
        "git_status" => git(ws, &["status", "--porcelain=v1"]).await,
        "git_diff" => {
            let mut cmd = vec!["diff"];
            let path = args.get("path").and_then(|v| v.as_str());
            if let Some(p) = path {
                cmd.push(p);
            }
            git(ws, &cmd).await
        }
        _ => Err(anyhow!("unknown tool {name}")),
    }
}

pub fn mutates(name: &str) -> bool {
    matches!(name, "write" | "edit" | "shell")
}

fn read(ws: &Workspace, args: &Value) -> Result<ToolOutput> {
    let path = ws.resolve(args["path"].as_str().unwrap_or(""))?;
    let text = std::fs::read_to_string(&path).with_context(|| path.display().to_string())?;
    let lines: Vec<&str> = text.lines().collect();
    let offset = args.get("offset").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
    let start = offset.saturating_sub(1).min(lines.len());
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .map(|n| n as usize)
        .unwrap_or(READ_DEFAULT_LINES);
    let end = lines.len().min(start.saturating_add(limit));
    let mut out = String::new();
    for (i, line) in lines[start..end].iter().enumerate() {
        out.push_str(&format!("{:>6}|{}\n", start + i + 1, clip_line(line, READ_MAX_LINE_CHARS)));
    }
    if end < lines.len() {
        out.push_str(&format!(
            "…[{} more lines, {} total; call read with offset={} to continue, or grep/outline to find the part you need]\n",
            lines.len() - end,
            lines.len(),
            end + 1
        ));
    }
    Ok(ToolOutput {
        ok: true,
        output: out,
        diff: None,
    })
}

fn write(ws: &Workspace, args: &Value) -> Result<ToolOutput> {
    let rel = args["path"].as_str().unwrap_or("");
    // Jail check first (folds `..`, follows symlinks); only then create directories.
    let path = resolve_write_target(ws, rel)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let before = std::fs::read_to_string(&path).unwrap_or_default();
    let after = args["contents"].as_str().unwrap_or("").to_string();
    std::fs::write(&path, &after)?;
    Ok(ToolOutput {
        ok: true,
        output: format!("wrote {}", ws.rel(&path)),
        diff: Some(FileDiff {
            path: ws.rel(&path),
            before,
            after,
        }),
    })
}

fn edit(ws: &Workspace, args: &Value) -> Result<ToolOutput> {
    let path = ws.resolve(args["path"].as_str().unwrap_or(""))?;
    let before = std::fs::read_to_string(&path)?;
    let old = args["old_string"].as_str().unwrap_or("");
    let new = args["new_string"].as_str().unwrap_or("");
    let replace_all = args
        .get("replace_all")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let count = before.matches(old).count();
    if old.is_empty() {
        return Err(anyhow!("old_string empty"));
    }
    if count == 0 {
        return Err(anyhow!("old_string not found"));
    }
    if count > 1 && !replace_all {
        return Err(anyhow!("old_string found {count} times; set replace_all"));
    }
    let after = if replace_all {
        before.replace(old, new)
    } else {
        before.replacen(old, new, 1)
    };
    std::fs::write(&path, &after)?;
    Ok(ToolOutput {
        ok: true,
        output: format!("edited {}", ws.rel(&path)),
        diff: Some(FileDiff {
            path: ws.rel(&path),
            before,
            after,
        }),
    })
}

/// Resolve a write path under the workspace without creating parents (stage-safe).
fn resolve_write_target(ws: &Workspace, rel: &str) -> Result<PathBuf> {
    // `resolve` handles both relative and absolute input and enforces the workspace jail.
    ws.resolve(rel)
}

/// Propose a write without committing bytes to disk.
pub fn stage_write(ws: &Workspace, args: &Value) -> Result<ToolOutput> {
    let rel = args["path"].as_str().unwrap_or("");
    let path = resolve_write_target(ws, rel)?;
    let before = std::fs::read_to_string(&path).unwrap_or_default();
    let after = args["contents"].as_str().unwrap_or("").to_string();
    Ok(ToolOutput {
        ok: true,
        output: format!("proposed write {}", ws.rel(&path)),
        diff: Some(FileDiff {
            path: ws.rel(&path),
            before,
            after,
        }),
    })
}

/// Propose an edit without committing bytes to disk.
pub fn stage_edit(ws: &Workspace, args: &Value) -> Result<ToolOutput> {
    let path = ws.resolve(args["path"].as_str().unwrap_or(""))?;
    let before = std::fs::read_to_string(&path)?;
    let old = args["old_string"].as_str().unwrap_or("");
    let new = args["new_string"].as_str().unwrap_or("");
    let replace_all = args
        .get("replace_all")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let count = before.matches(old).count();
    if old.is_empty() {
        return Err(anyhow!("old_string empty"));
    }
    if count == 0 {
        return Err(anyhow!("old_string not found"));
    }
    if count > 1 && !replace_all {
        return Err(anyhow!("old_string found {count} times; set replace_all"));
    }
    let after = if replace_all {
        before.replace(old, new)
    } else {
        before.replacen(old, new, 1)
    };
    Ok(ToolOutput {
        ok: true,
        output: format!("proposed edit {}", ws.rel(&path)),
        diff: Some(FileDiff {
            path: ws.rel(&path),
            before,
            after,
        }),
    })
}

/// Discard a staged path at the tools layer. Staging never wrote disk, so this is a no-op
/// that still validates the relative path stays inside the workspace jail.
pub fn reject_staged(ws: &Workspace, rel: &str) -> Result<()> {
    let _ = resolve_write_target(ws, rel)?;
    Ok(())
}

/// Commit staged contents to disk (used by `diff.apply`).
pub fn commit_staged(ws: &Workspace, args: &Value) -> Result<ToolOutput> {
    write(ws, args)
}

fn glob_files(ws: &Workspace, args: &Value) -> Result<ToolOutput> {
    let pattern = args["pattern"].as_str().unwrap_or("**/*");
    let limit = args
        .get("head_limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(200) as usize;
    let mut matches = Vec::new();
    let walker = ignore::WalkBuilder::new(&ws.root)
        .hidden(false)
        .git_ignore(true)
        .build();
    let glob = glob_to_regex(pattern)?;
    for entry in walker.flatten() {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let rel = ws.rel(entry.path());
        if glob.is_match(&rel) || glob.is_match(entry.path().file_name().unwrap().to_string_lossy().as_ref()) {
            matches.push(rel);
            if matches.len() >= limit {
                break;
            }
        }
    }
    Ok(ToolOutput {
        ok: true,
        output: matches.join("\n"),
        diff: None,
    })
}

#[derive(Clone, Copy, PartialEq)]
enum GrepMode {
    Content,
    Files,
    Count,
}

fn grep(ws: &Workspace, args: &Value) -> Result<ToolOutput> {
    let pattern = args["pattern"].as_str().unwrap_or("");
    let case_insensitive = args
        .get("case_insensitive")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let re = regex::RegexBuilder::new(pattern)
        .case_insensitive(case_insensitive)
        .build()
        .context("invalid regex")?;
    let glob_pat = args.get("glob").and_then(|v| v.as_str());
    let glob = glob_pat.map(glob_to_regex).transpose()?;
    let limit = args
        .get("head_limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(80)
        .max(1) as usize;
    let mode = match args.get("output_mode").and_then(|v| v.as_str()) {
        Some("files") => GrepMode::Files,
        Some("count") => GrepMode::Count,
        _ => GrepMode::Content,
    };
    let context = args
        .get("context")
        .and_then(|v| v.as_u64())
        .unwrap_or(0)
        .min(GREP_MAX_CONTEXT as u64) as usize;

    let mut out: Vec<String> = Vec::new();
    // Matches (content) or entries (files/count) emitted so far.
    let mut emitted = 0usize;
    let mut skipped_large = 0usize;
    let mut hit_limit = false;
    let walker = ignore::WalkBuilder::new(&ws.root)
        .hidden(false)
        .git_ignore(true)
        .build();
    for entry in walker.flatten() {
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let rel = ws.rel(entry.path());
        if let Some(g) = &glob {
            if !g.is_match(&rel) {
                continue;
            }
        }
        if entry.metadata().map(|m| m.len()).unwrap_or(0) > GREP_MAX_FILE_BYTES {
            skipped_large += 1;
            continue;
        }
        let Ok(text) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        if text.bytes().take(1024).any(|b| b == 0) {
            continue;
        }
        let lines: Vec<&str> = text.lines().collect();
        let matches: Vec<usize> = lines
            .iter()
            .enumerate()
            .filter(|(_, l)| re.is_match(l))
            .map(|(i, _)| i)
            .collect();
        if matches.is_empty() {
            continue;
        }
        match mode {
            GrepMode::Files => {
                out.push(rel);
                emitted += 1;
            }
            GrepMode::Count => {
                out.push(format!("{rel}:{}", matches.len()));
                emitted += 1;
            }
            GrepMode::Content => {
                let take = matches.len().min(limit - emitted);
                if context > 0 && !out.is_empty() {
                    out.push("--".into());
                }
                let mut last_printed: Option<usize> = None;
                for &m in &matches[..take] {
                    let from = m.saturating_sub(context);
                    let to = (m + context).min(lines.len() - 1);
                    let from = match last_printed {
                        Some(lp) if from <= lp + 1 => lp + 1,
                        Some(_) => {
                            out.push("--".into());
                            from
                        }
                        None => from,
                    };
                    for i in from..=to {
                        let sep = if i == m || matches.binary_search(&i).is_ok() { ':' } else { '-' };
                        out.push(format!(
                            "{rel}{sep}{}{sep}{}",
                            i + 1,
                            clip_line(lines[i], GREP_MAX_LINE_CHARS)
                        ));
                    }
                    last_printed = Some(to.max(last_printed.unwrap_or(0)));
                }
                emitted += take;
            }
        }
        if emitted >= limit {
            hit_limit = true;
            break;
        }
    }
    if out.is_empty() {
        out.push("No matches.".into());
    }
    if hit_limit {
        out.push(format!(
            "…[head_limit {limit} reached; narrow pattern/glob, use output_mode=files|count, or raise head_limit]"
        ));
    }
    if skipped_large > 0 {
        out.push(format!(
            "…[skipped {skipped_large} file(s) over {} bytes]",
            GREP_MAX_FILE_BYTES
        ));
    }
    Ok(ToolOutput {
        ok: true,
        output: out.join("\n"),
        diff: None,
    })
}

/// File structure with line numbers: Markdown headings or top-level declarations.
fn outline(ws: &Workspace, args: &Value) -> Result<ToolOutput> {
    let rel = args["path"].as_str().unwrap_or("");
    let path = ws.resolve(rel)?;
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let re = match ext.as_str() {
        "md" | "markdown" | "mdx" => Regex::new(r"^#{1,6}\s+\S"),
        "rs" => Regex::new(
            r"^\s{0,4}(pub(\([^)]*\))?\s+)?(async\s+)?(unsafe\s+)?(const\s+)?(fn|struct|enum|trait|impl|mod|type|static|macro_rules!)[\s<!]",
        ),
        "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs" | "mts" | "cts" => Regex::new(
            r"^(export\s+)?(default\s+)?(declare\s+)?(async\s+)?(abstract\s+)?(function\*?|class|interface|type|enum|const|let|var)\s",
        ),
        "py" => Regex::new(r"^\s*(async\s+)?(def|class)\s"),
        "go" => Regex::new(r"^(func|type|var|const)\s"),
        _ => {
            return Ok(ToolOutput {
                ok: false,
                output: format!(
                    "outline supports .md .rs .ts/.tsx/.js/.jsx .py .go; got `{rel}`. Use grep to locate code in this file."
                ),
                diff: None,
            })
        }
    }?;
    let markdown = matches!(ext.as_str(), "md" | "markdown" | "mdx");
    let text = std::fs::read_to_string(&path).with_context(|| path.display().to_string())?;
    let total = text.lines().count();
    let mut out = vec![format!("{} ({total} lines)", ws.rel(&path))];
    let mut in_fence = false;
    let mut entries = 0usize;
    for (i, line) in text.lines().enumerate() {
        if markdown && line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence || !re.is_match(line) {
            continue;
        }
        if entries == OUTLINE_MAX_ENTRIES {
            out.push(format!("…[more than {OUTLINE_MAX_ENTRIES} entries; use grep]"));
            break;
        }
        let shown = line.trim_end().trim_end_matches('{').trim_end();
        out.push(format!("{:>6}|{}", i + 1, clip_line(shown, 160)));
        entries += 1;
    }
    if entries == 0 {
        out.push("(no headings or declarations found; use grep or read)".into());
    }
    Ok(ToolOutput {
        ok: true,
        output: out.join("\n"),
        diff: None,
    })
}

fn glob_to_regex(pattern: &str) -> Result<Regex> {
    let mut out = String::from("(?i)^");
    let chars: Vec<char> = pattern.replace('\\', "/").chars().collect();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '*' if i + 1 < chars.len() && chars[i + 1] == '*' => {
                out.push_str(".*");
                i += 2;
                if i < chars.len() && chars[i] == '/' {
                    i += 1;
                }
            }
            '*' => {
                out.push_str("[^/]*");
                i += 1;
            }
            '?' => {
                out.push_str("[^/]");
                i += 1;
            }
            '.' | '+' | '(' | ')' | '|' | '[' | ']' | '{' | '}' | '^' | '$' => {
                out.push('\\');
                out.push(chars[i]);
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    out.push('$');
    Ok(Regex::new(&out)?)
}

/// Windows PowerShell 5.1 defaults to the OEM/ANSI code page, which garbles Vietnamese. Force
/// UTF-8 for the pipe to this process and for the text cmdlets' default encoding. (`utf8` writes a
/// BOM on 5.1 — still correct, unlike ANSI; PowerShell 7 writes none.)
#[cfg(windows)]
const POWERSHELL_UTF8_PREAMBLE: &str = "try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}; \
$OutputEncoding = [System.Text.UTF8Encoding]::new($false); \
foreach ($c in 'Set-Content','Add-Content','Out-File','Get-Content') { $PSDefaultParameterValues[\"${c}:Encoding\"] = 'utf8' };";
#[cfg(not(windows))]
const POWERSHELL_UTF8_PREAMBLE: &str = "";

async fn shell(ws: &Workspace, args: &Value) -> Result<ToolOutput> {
    let command = args["command"].as_str().unwrap_or("");
    if command.is_empty() {
        return Err(anyhow!("empty command"));
    }
    let timeout = Duration::from_millis(
        args.get("timeout_ms")
            .and_then(|v| v.as_u64())
            .unwrap_or(120_000),
    );
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("powershell");
        let script = format!("{POWERSHELL_UTF8_PREAMBLE}\n{command}");
        c.args(["-NoProfile", "-NonInteractive", "-Command", &script]);
        c
    } else {
        let mut c = Command::new("bash");
        c.args(["-lc", command]);
        c
    };
    cmd.current_dir(&ws.root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let child = cmd.spawn().context("spawn shell")?;
    let pid = child.id().unwrap_or(0);
    let _guard = silence_sandbox::wrap_pid(pid).ok();
    let result = tokio::time::timeout(timeout, child.wait_with_output()).await;
    let output = match result {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(e.into()),
        Err(_) => return Err(anyhow!("shell timed out")),
    };
    let mut text = String::new();
    text.push_str(&String::from_utf8_lossy(&output.stdout));
    if !output.stderr.is_empty() {
        text.push_str("\nSTDERR:\n");
        text.push_str(&String::from_utf8_lossy(&output.stderr));
    }
    // Total size is capped in `execute` (MAX_OUTPUT_BYTES).
    Ok(ToolOutput {
        ok: output.status.success(),
        output: text,
        diff: None,
    })
}

/// What `shell_sandboxed` needs from the Engine.
pub struct SandboxRun {
    /// The `silence-engine` binary (it doubles as the runner).
    pub engine_exe: PathBuf,
    /// The child's whole environment: `silence_sandbox::default_env` plus the proxy credential.
    pub env: Vec<(String, String)>,
}

/// Result of a command that really ran inside the sandbox.
pub struct SandboxShell {
    pub out: ToolOutput,
    pub exit_code: i32,
}

/// Quote one argument the way `CommandLineToArgvW` reads it back.
fn quote_arg(a: &str) -> String {
    const BS: char = '\u{5c}';
    let mut out = String::from("\"");
    let mut slashes = 0usize;
    for c in a.chars() {
        match c {
            BS => slashes += 1,
            '"' => {
                out.extend(std::iter::repeat(BS).take(slashes * 2 + 1));
                out.push('"');
                slashes = 0;
            }
            _ => {
                out.extend(std::iter::repeat(BS).take(slashes));
                out.push(c);
                slashes = 0;
            }
        }
    }
    out.extend(std::iter::repeat(BS).take(slashes * 2));
    out.push('"');
    out
}

/// Run a shell command as the sandbox user (see `silence_sandbox`). Same output shape as
/// `shell`. An error means the command did NOT run (timeout aside): sandbox missing, broken or
/// the runner failed; the caller must not fall back to an unsandboxed run on its own.
pub async fn shell_sandboxed(ws: &Workspace, args: &Value, sb: SandboxRun) -> Result<SandboxShell> {
    let command = args["command"].as_str().unwrap_or("");
    if command.is_empty() {
        return Err(anyhow!("empty command"));
    }
    let timeout = Duration::from_millis(args.get("timeout_ms").and_then(|v| v.as_u64()).unwrap_or(120_000));
    let script = format!("{POWERSHELL_UTF8_PREAMBLE}
{command}");
    let spec = silence_sandbox::RunSpec {
        command_line: format!("powershell.exe -NoProfile -NonInteractive -Command {}", quote_arg(&script)),
        cwd: ws.root.clone(),
        env: sb.env,
        limits: silence_sandbox::Limits::standard(),
    };
    let exe = sb.engine_exe;
    let out = tokio::task::spawn_blocking(move || silence_sandbox::run(&spec, &exe, Some(timeout))).await??;
    if out.timed_out {
        return Err(anyhow!("shell timed out"));
    }
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    if out.code == silence_sandbox::RUNNER_FAILED && stderr.starts_with(silence_sandbox::RUNNER_PREFIX) {
        return Err(anyhow!("sandbox could not run the command: {}", stderr.trim()));
    }
    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    if !stderr.is_empty() {
        text.push_str("
STDERR:
");
        text.push_str(&stderr);
    }
    Ok(SandboxShell {
        out: ToolOutput { ok: out.code == 0, output: cap_output(text), diff: None },
        exit_code: out.code,
    })
}

#[cfg(test)]
mod sandbox_quote_tests {
    use super::quote_arg;

    #[test]
    fn quoting_round_trips_through_argv_rules() {
        assert_eq!(quote_arg("a b"), "\"a b\"");
        assert_eq!(quote_arg("say \"hi\""), "\"say \\\"hi\\\"\"");
        assert_eq!(quote_arg("C:\\dir\\"), "\"C:\\dir\\\\\"");
        assert_eq!(quote_arg("x\\\"y"), "\"x\\\\\\\"y\"");
    }
}

async fn git(ws: &Workspace, args: &[&str]) -> Result<ToolOutput> {
    let mut cmd = Command::new("git");
    cmd.args(args)
        .current_dir(&ws.root)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let out = cmd.output().await?;
    let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
    if !out.stderr.is_empty() {
        text.push_str(&String::from_utf8_lossy(&out.stderr));
    }
    Ok(ToolOutput {
        ok: out.status.success(),
        output: text,
        diff: None,
    })
}

pub async fn tree(ws: &Workspace, max_entries: usize) -> Result<String> {
    let mut lines = Vec::new();
    let walker = ignore::WalkBuilder::new(&ws.root)
        .hidden(false)
        .git_ignore(true)
        .build();
    for entry in walker.flatten() {
        if entry.depth() == 0 {
            continue;
        }
        lines.push(ws.rel(entry.path()));
        if lines.len() >= max_entries {
            lines.push("...truncated...".into());
            break;
        }
    }
    Ok(lines.join("\n"))
}

pub async fn read_raw(ws: &Workspace, rel: &str) -> Result<String> {
    let path = ws.resolve(rel)?;
    Ok(std::fs::read_to_string(path)?)
}

pub fn read_limited(path: &Path, max_bytes: usize) -> Result<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path)?;
    let mut buf = vec![0u8; max_bytes];
    let n = f.read(&mut buf)?;
    Ok(String::from_utf8_lossy(&buf[..n]).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp_ws() -> (tempfile::TempDir, Workspace) {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "hello world\nhello rust\n").unwrap();
        let ws = Workspace::new(dir.path()).unwrap();
        (dir, ws)
    }

    #[test]
    fn edit_unique() {
        let (_d, ws) = tmp_ws();
        let out = edit(
            &ws,
            &json!({"path":"a.txt","old_string":"hello rust","new_string":"hello 5ilence"}),
        )
        .unwrap();
        assert!(out.ok);
        let text = std::fs::read_to_string(ws.root.join("a.txt")).unwrap();
        assert!(text.contains("5ilence"));
    }

    #[test]
    fn jail_blocks_escape() {
        let (_d, ws) = tmp_ws();
        let outside = std::env::temp_dir().join("silence-jail-outside.txt");
        std::fs::write(&outside, "nope").unwrap();
        let err = ws.resolve(outside.to_str().unwrap()).unwrap_err();
        assert!(err.to_string().contains("escapes"));
    }

    #[test]
    fn grep_hits() {
        let (_d, ws) = tmp_ws();
        let out = grep(&ws, &json!({"pattern":"hello"})).unwrap();
        assert!(out.output.contains("a.txt"));
    }

    fn numbered(n: usize) -> String {
        (1..=n).map(|i| format!("line {i}\n")).collect()
    }

    #[test]
    fn read_defaults_to_400_lines_with_continue_hint() {
        let (_d, ws) = tmp_ws();
        std::fs::write(ws.root.join("big.txt"), numbered(1000)).unwrap();
        let out = read(&ws, &json!({"path":"big.txt"})).unwrap().output;
        assert!(out.contains("   400|line 400"));
        assert!(!out.contains("line 401\n"));
        assert!(out.contains("600 more lines, 1000 total"), "{out}");
        assert!(out.contains("offset=401"));
        let tail = read(&ws, &json!({"path":"big.txt","offset":990})).unwrap().output;
        assert!(tail.contains("  1000|line 1000"));
        assert!(!tail.contains("more lines"));
    }

    #[test]
    fn read_and_grep_clip_long_lines() {
        let (_d, ws) = tmp_ws();
        let long = format!("needle {}\n", "é".repeat(5000));
        std::fs::write(ws.root.join("min.js"), &long).unwrap();
        let r = read(&ws, &json!({"path":"min.js"})).unwrap().output;
        assert!(r.len() < 2000 && r.contains("chars]"), "{r}");
        let g = grep(&ws, &json!({"pattern":"needle"})).unwrap().output;
        assert!(g.len() < 1200 && g.contains("chars]"), "{g}");
    }

    #[test]
    fn grep_modes_context_and_case() {
        let (_d, ws) = tmp_ws();
        std::fs::write(ws.root.join("b.txt"), "x\nHello there\ny\nz\nw\nhello again\n").unwrap();
        let files = grep(&ws, &json!({"pattern":"hello","output_mode":"files"})).unwrap().output;
        assert!(files.lines().any(|l| l == "a.txt") && files.lines().any(|l| l == "b.txt"));
        let count = grep(&ws, &json!({"pattern":"hello","output_mode":"count","glob":"b.txt"}))
            .unwrap()
            .output;
        assert_eq!(count, "b.txt:1");
        let ci = grep(
            &ws,
            &json!({"pattern":"hello","output_mode":"count","glob":"b.txt","case_insensitive":true}),
        )
        .unwrap()
        .output;
        assert_eq!(ci, "b.txt:2");
        let ctx = grep(&ws, &json!({"pattern":"there","glob":"b.txt","context":1})).unwrap().output;
        assert_eq!(ctx, "b.txt-1-x\nb.txt:2:Hello there\nb.txt-3-y");
        let none = grep(&ws, &json!({"pattern":"zzz-not-here"})).unwrap().output;
        assert_eq!(none, "No matches.");
    }

    #[test]
    fn grep_reports_head_limit() {
        let (_d, ws) = tmp_ws();
        std::fs::write(ws.root.join("big.txt"), numbered(50)).unwrap();
        let out = grep(&ws, &json!({"pattern":"line","glob":"big.txt","head_limit":5})).unwrap().output;
        assert_eq!(out.lines().filter(|l| l.starts_with("big.txt:")).count(), 5);
        assert!(out.contains("head_limit 5 reached"));
    }

    #[test]
    fn outline_markdown_skips_fences() {
        let (_d, ws) = tmp_ws();
        std::fs::write(ws.root.join("d.md"), "# Title\ntext\n```sh\n# not a heading\n```\n## Part\n").unwrap();
        let out = outline(&ws, &json!({"path":"d.md"})).unwrap().output;
        assert!(out.contains("     1|# Title") && out.contains("     6|## Part"), "{out}");
        assert!(!out.contains("not a heading"));
    }

    #[test]
    fn outline_code_declarations() {
        let (_d, ws) = tmp_ws();
        std::fs::write(
            ws.root.join("m.rs"),
            "use x;\npub struct S {\n    a: u8,\n}\nimpl S {\n    pub async fn go(&self) {\n        let y = 1;\n    }\n}\n",
        )
        .unwrap();
        let rs = outline(&ws, &json!({"path":"m.rs"})).unwrap().output;
        assert!(rs.contains("     2|pub struct S"), "{rs}");
        assert!(rs.contains("     5|impl S"));
        assert!(rs.contains("     6|    pub async fn go(&self)"));
        assert!(!rs.contains("let y"));
        std::fs::write(ws.root.join("p.py"), "import os\nclass A:\n    def f(self):\n        pass\n").unwrap();
        let py = outline(&ws, &json!({"path":"p.py"})).unwrap().output;
        assert!(py.contains("     2|class A:") && py.contains("     3|    def f(self):"), "{py}");
        let other = outline(&ws, &json!({"path":"a.txt"})).unwrap();
        assert!(!other.ok && other.output.contains("Use grep"));
    }

    #[test]
    fn cap_output_respects_char_boundary() {
        let s = "é".repeat(MAX_OUTPUT_BYTES);
        let capped = cap_output(s);
        assert!(capped.contains("output truncated"));
        assert!(capped.len() < MAX_OUTPUT_BYTES + 200);
        assert_eq!(cap_output("short".into()), "short");
    }

    #[test]
    fn stage_write_leaves_disk_unchanged() {
        let (_d, ws) = tmp_ws();
        let path = "staged.txt";
        let before = "before-bytes\n";
        std::fs::write(ws.root.join(path), before).unwrap();
        let staged = stage_write(
            &ws,
            &json!({"path": path, "contents": "after-should-not-hit-disk-yet\n"}),
        )
        .unwrap();
        assert!(staged.ok);
        assert!(staged.diff.is_some());
        let on_disk = std::fs::read_to_string(ws.root.join(path)).unwrap();
        assert_eq!(
            on_disk, before,
            "stage_write must leave disk at before until commit/apply"
        );
    }

    #[test]
    fn staged_edit_reject_keeps_before() {
        let (_d, ws) = tmp_ws();
        let path = "a.txt";
        let before = std::fs::read_to_string(ws.root.join(path)).unwrap();
        let staged = stage_edit(
            &ws,
            &json!({
                "path": path,
                "old_string": "hello rust",
                "new_string": "hello staged"
            }),
        )
        .unwrap();
        assert!(staged.ok);
        reject_staged(&ws, path).unwrap();
        let on_disk = std::fs::read_to_string(ws.root.join(path)).unwrap();
        assert_eq!(
            on_disk, before,
            "reject after staged edit must keep disk at before"
        );
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn vietnamese_utf8_round_trip() {
        let (_d, ws) = tmp_ws();
        let phrase = "Xin chào thế giới";
        // Default Set-Content encoding is not UTF-8 on Windows PowerShell 5.x; Plan 01-04
        // hardens shell to write/read UTF-8 (e.g. -Encoding utf8 / chcp 65001).
        let out = shell(
            &ws,
            &json!({
                "command": format!(
                    "Set-Content -Path vi.txt -Value '{phrase}'; Get-Content -Raw -Path vi.txt"
                ),
                "timeout_ms": 30_000u64
            }),
        )
        .await
        .unwrap();
        let disk = std::fs::read(ws.root.join("vi.txt")).unwrap();
        let disk_text = String::from_utf8_lossy(&disk);
        assert!(
            disk_text.contains(phrase),
            "shell file fixture must store Vietnamese as UTF-8 without mojibake; disk={disk_text:?} stdout={:?}",
            out.output
        );
        assert!(
            out.output.contains(phrase),
            "shell UTF-8 capture must preserve Vietnamese; got {:?}",
            out.output
        );
    }

    #[test]
    fn dotdot_cannot_escape_workspace() {
        let (_d, ws) = tmp_ws();
        let outside = ws.root.parent().unwrap().join("escaped-by-dotdot.txt");
        let _ = std::fs::remove_file(&outside);
        for rel in [
            "../escaped-by-dotdot.txt",
            "sub/../../escaped-by-dotdot.txt",
            "./../escaped-by-dotdot.txt",
        ] {
            assert!(
                write(&ws, &json!({"path": rel, "contents": "x"})).is_err(),
                "write must refuse {rel}"
            );
            assert!(
                stage_write(&ws, &json!({"path": rel, "contents": "x"})).is_err(),
                "stage_write must refuse {rel}"
            );
            assert!(ws.resolve(rel).is_err(), "resolve must refuse {rel}");
        }
        assert!(!outside.exists(), "nothing may be written outside the workspace");
    }

    #[test]
    fn dotdot_inside_workspace_is_allowed() {
        let (_d, ws) = tmp_ws();
        let out = write(&ws, &json!({"path": "a/../b.txt", "contents": "ok"})).unwrap();
        assert!(out.ok);
        assert_eq!(std::fs::read_to_string(ws.root.join("b.txt")).unwrap(), "ok");
    }

    #[test]
    fn long_nested_path_tool_io() {
        let (_d, ws) = tmp_ws();
        // Nested relative path whose absolute form exceeds classic MAX_PATH (260).
        let mut rel = String::new();
        for i in 0..40 {
            rel.push_str(&format!("nested-segment-{i:03}/"));
        }
        rel.push_str("leaf.txt");
        let absolute = ws.root.join(&rel);
        let abs_len = absolute.to_string_lossy().len();
        assert!(
            abs_len > 260,
            "fixture absolute path must exceed MAX_PATH, got {abs_len}"
        );
        let contents = "long-path-ok";
        let written = write(&ws, &json!({"path": rel, "contents": contents}));
        assert!(
            written.is_ok(),
            "write under long nested path must succeed (Plan 01-04 extended-path): {:?}",
            written.err()
        );
        let path = match ws.resolve(&rel) {
            Ok(p) => p,
            Err(err) => panic!("resolve long nested path: {err}"),
        };
        let text = std::fs::read_to_string(&path).expect("read back long nested file");
        assert_eq!(text, contents);
    }
}
