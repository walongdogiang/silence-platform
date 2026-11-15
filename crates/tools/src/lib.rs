use anyhow::{anyhow, Context, Result};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

pub mod browser;
pub mod http;
pub mod image;
pub mod procs;
pub mod unicode;
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
            return Err(anyhow!(
                "path escapes workspace: {} (workspace root: {}). Use a path inside the workspace, \
                 relative to its root.",
                canon.display(),
                self.root.display()
            ));
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
        spec_http_check(),
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
        description: "Create a new file, or replace an existing file's entire contents. Missing parent \
            directories are created. To change part of an existing file use edit instead (smaller, \
            reviewable diff); if you do overwrite a file, read it first, because its old contents are \
            replaced completely. `path` is relative to the workspace root (an absolute path inside the \
            workspace also works; paths outside it are refused). `contents` is written exactly as given \
            (UTF-8): never include the `  12|` line-number prefixes that read shows."
            .into(),
        parameters: obj(
            json!({
                "path": {"type": "string", "description": "File path relative to the workspace root, e.g. src/util.py"},
                "contents": {"type": "string", "description": "The complete new file contents."}
            }),
            &["path", "contents"],
        ),
    }
}

fn spec_edit() -> ToolSpec {
    ToolSpec {
        name: "edit".into(),
        description: "Replace text in an existing file. Read the target lines first. `old_string` must \
            match the current file exactly (spaces, tabs, indentation, blank lines) without the `  12|` \
            line-number prefixes that read shows, and, unless replace_all is true, must occur exactly \
            once: include 2-3 neighbouring lines to make it unique. `new_string` replaces it verbatim; \
            an empty new_string deletes it. One call per separate change. To create a file, or rewrite \
            most of one, use write. Matching tolerates Unicode normalization (NFC/NFD) and CRLF vs LF \
            line endings; the file keeps its own form."
            .into(),
        parameters: obj(
            json!({
                "path": {"type": "string", "description": "File path relative to the workspace root."},
                "old_string": {"type": "string", "description": "Exact existing text to replace (non-empty)."},
                "new_string": {"type": "string", "description": "Replacement text (may be empty to delete)."},
                "replace_all": {"type": "boolean", "description": "Replace every occurrence instead of requiring exactly one (default false)."}
            }),
            &["path", "old_string", "new_string"],
        ),
    }
}

fn spec_glob() -> ToolSpec {
    ToolSpec {
        name: "glob".into(),
        description: "Find files by path pattern; returns workspace-relative paths, one per line \
            (respects .gitignore; case-insensitive). `*` matches inside one path segment, `**` across \
            any number of directories, `?` one character. A pattern matches either the whole path from \
            the workspace root (`src/**/*.ts`) or just the file name (`*.rs` and `Cargo.toml` find files \
            at any depth). No `{a,b}` alternation or `!` negation: call once per pattern. Use it to \
            locate files before read; to search file contents use grep."
            .into(),
        parameters: obj(
            json!({
                "pattern": {"type": "string", "description": "e.g. **/*.rs, src/**/test_*.py, package.json"},
                "head_limit": {"type": "integer", "description": "Max paths returned (default 200)."}
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
            Use `context` for surrounding lines instead of re-reading the file. Rust regex syntax: \
            escape literal `( ) [ ] { } . * + ? | ^ $ \\` with a backslash; no lookaround or \
            backreferences. `glob` works like the glob tool (`*.rs` = any depth)."
            .into(),
        parameters: obj(
            json!({
                "pattern": {"type": "string"},
                "glob": {"type": "string", "description": "Filter files, e.g. *.rs or src/**/*.ts"},
                "output_mode": {"type": "string", "enum": ["content", "files", "count"]},
                "context": {"type": "integer", "description": "Lines of context around each match (0-5, content mode)."},
                "case_insensitive": {"type": "boolean"},
                "head_limit": {"type": "integer", "description": "Max matches (content) or entries (files/count). Default 80."}
            }),
            &["pattern"],
        ),
    }
}

/// `shell` on Windows: exactly what `shell_command` runs (Windows PowerShell 5.1, not pwsh 7).
const SHELL_DESC_WINDOWS: &str = "Run one command in Windows PowerShell 5.1 \
(`powershell -NoProfile -NonInteractive -Command`): PowerShell syntax, not bash and not cmd. \
cwd is the workspace root; output is UTF-8 (stdout, then stderr after `STDERR:`); stdin is closed, so \
anything that prompts fails; default timeout 120000 ms. Use it for builds, tests, git and package \
managers. Do not use it to read, search or edit files (use read, grep, glob, edit, write) or for \
servers/watchers that keep running (use proc_start). PowerShell 5.1 traps:\n\
- `&&` and `||` do not exist (parse error). Run B only if A succeeded: `A; if ($?) { B }`. Always run both: `A; B`.\n\
- Env vars: `$env:NAME = 'value'; cmd`, not `export NAME=value` or `NAME=value cmd`.\n\
- No head, tail, grep, wc, touch, which, `rm -rf`, `mkdir -p`: use `Select-Object -First N` / `-Last N`, \
`Select-String`, `Measure-Object -Line`, `New-Item -ItemType File`, `Get-Command`, \
`Remove-Item -Recurse -Force`, `New-Item -ItemType Directory -Force`.\n\
- Quote paths containing spaces; to run an exe from a quoted path use the call operator: \
`& \"C:\\Program Files\\Tool\\tool.exe\" arg`.\n\
- Do not append `2>&1` to native programs (git, cargo, npm, python): 5.1 turns each stderr line into an \
error record and the command looks failed. stderr is already captured.\n\
- `/dev/null` is `$null`; a native program's exit code is `$LASTEXITCODE`; no `<<EOF` heredocs: use a \
here-string `@'...'@` whose closing `'@` starts its own line.";

/// `shell` elsewhere: `bash -lc`.
const SHELL_DESC_UNIX: &str = "Run one command with `bash -lc`. cwd is the workspace root; stdout, \
then stderr after `STDERR:`; stdin is closed, so anything that prompts fails; default timeout 120000 ms. \
Use it for builds, tests, git and package managers. Do not use it to read, search or edit files (use \
read, grep, glob, edit, write) or for servers/watchers that keep running (use proc_start). Quote paths \
that contain spaces.";

fn spec_shell() -> ToolSpec {
    let command_desc = if cfg!(windows) {
        "PowerShell 5.1 command line. Chain with `;` or `A; if ($?) { B }`, never `&&`."
    } else {
        "bash command line."
    };
    ToolSpec {
        name: "shell".into(),
        description: if cfg!(windows) { SHELL_DESC_WINDOWS } else { SHELL_DESC_UNIX }.into(),
        parameters: obj(
            json!({
                "command": {"type": "string", "description": command_desc},
                "timeout_ms": {"type": "integer", "description": "Kill the command after this many ms (default 120000)."}
            }),
            &["command"],
        ),
    }
}

fn spec_http_check() -> ToolSpec {
    ToolSpec {
        name: "http_check".into(),
        description: "Send one HTTP request to an app running on this machine (localhost, 127.0.0.1, ::1 only) and get status, key headers and the body (HTML as page text, JSON pretty). Use it to check a route after a change or that a dev server answers. Not for the internet. In Ask/Review only GET/HEAD/OPTIONS."
            .into(),
        parameters: obj(
            json!({
                "url": {"type": "string", "description": "e.g. http://localhost:5173/api/items"},
                "method": {"type": "string", "description": "GET (default), POST, PUT, PATCH, DELETE, HEAD, OPTIONS"},
                "headers": {"type": "object", "additionalProperties": {"type": "string"}},
                "body": {"description": "String, or a JSON value (sent as application/json)."},
                "raw": {"type": "boolean", "description": "Return the body as is (HTML source) instead of page text."},
                "timeout_ms": {"type": "integer"}
            }),
            &["url"],
        ),
    }
}

fn spec_git_status() -> ToolSpec {
    ToolSpec {
        name: "git_status".into(),
        description: "Show changed and untracked files in the workspace repo (`git status --porcelain=v1`: \
            two status letters, then the path). Read-only; use it instead of running git status in shell."
            .into(),
        parameters: obj(json!({}), &[]),
    }
}

fn spec_git_diff() -> ToolSpec {
    ToolSpec {
        name: "git_diff".into(),
        description: "Show unstaged changes in the workspace repo (`git diff`), for the whole repo or one \
            path. Read-only; use it to review your edits before answering. New untracked files are not \
            included (see git_status)."
            .into(),
        parameters: obj(
            json!({ "path": {"type": "string", "description": "Limit the diff to this file or directory."} }),
            &[],
        ),
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
        "http_check" => http::http_check(args).await,
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
    matches!(name, "write" | "edit" | "shell" | "proc_start" | "proc_stop" | "browser_act")
}

fn read(ws: &Workspace, args: &Value) -> Result<ToolOutput> {
    let path = ws.resolve(args["path"].as_str().unwrap_or(""))?;
    let text = read_text(ws, &path)?;
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
    if rel.trim().is_empty() {
        return Err(anyhow!("path is empty: give the file path relative to the workspace root, e.g. src/util.py"));
    }
    let path = resolve_write_target(ws, rel)?;
    if path.is_dir() {
        return Err(anyhow!(
            "{} is a directory; write needs a file path inside it, e.g. {}/new_file.txt",
            ws.rel(&path),
            ws.rel(&path)
        ));
    }
    if let Some(parent) = path.parent() {
        // The runtime shows the model `err.to_string()`, so the cause goes in the message itself.
        std::fs::create_dir_all(parent)
            .map_err(|e| anyhow!("cannot create directory {}: {e}", ws.rel(parent)))?;
    }
    let before = std::fs::read_to_string(&path).unwrap_or_default();
    let after = args["contents"].as_str().unwrap_or("").to_string();
    std::fs::write(&path, &after).map_err(|e| {
        anyhow!(
            "cannot write {}: {e}. The file may be read-only or locked by another program (stop it \
             first, e.g. with proc_stop).",
            ws.rel(&path)
        )
    })?;
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

/// `before` with `old_string` replaced by `new_string` (`edit` and `stage_edit`). Exact match
/// first. When that finds nothing, match again ignoring Unicode normalization (Vietnamese typed
/// NFC by the model vs. stored NFD in the file, or the reverse) and write `new_string` in the
/// form the file uses at that spot.
fn apply_edit(before: &str, args: &Value) -> Result<String> {
    let old = args["old_string"].as_str().unwrap_or("");
    let new = args["new_string"].as_str().unwrap_or("");
    let replace_all = args
        .get("replace_all")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if old.is_empty() {
        return Err(anyhow!(
            "old_string is empty. To create a file use write. To insert text, set old_string to an \
             existing line next to the insertion point and repeat that line in new_string."
        ));
    }
    // `read` strips `\r`, so a multi-line old_string typed from it has LF endings. In a CRLF file
    // match (and write) the CRLF form instead.
    let crlf = before.contains("\r\n") && old.contains('\n') && !old.contains("\r\n");
    let (old, new) = if crlf && !before.contains(old) {
        (
            std::borrow::Cow::Owned(old.replace('\n', "\r\n")),
            std::borrow::Cow::Owned(new.replace("\r\n", "\n").replace('\n', "\r\n")),
        )
    } else {
        (std::borrow::Cow::Borrowed(old), std::borrow::Cow::Borrowed(new))
    };
    let (old, new) = (old.as_ref(), new.as_ref());
    let starts: Vec<usize> = before.match_indices(old).map(|(i, _)| i).collect();
    if !starts.is_empty() {
        if starts.len() > 1 && !replace_all {
            return Err(too_many_matches(before, &starts, ""));
        }
        return Ok(if replace_all {
            before.replace(old, new)
        } else {
            before.replacen(old, new, 1)
        });
    }
    let ranges = unicode::find_nfc(before, old);
    if ranges.is_empty() {
        return Err(not_found(before, old));
    }
    if ranges.len() > 1 && !replace_all {
        let starts: Vec<usize> = ranges.iter().map(|r| r.start).collect();
        return Err(too_many_matches(before, &starts, " (ignoring Unicode normalization)"));
    }
    let mut after = String::with_capacity(before.len() + new.len());
    let mut last = 0;
    for r in ranges {
        after.push_str(&before[last..r.start]);
        after.push_str(&unicode::like(&before[r.clone()], new));
        last = r.end;
    }
    after.push_str(&before[last..]);
    Ok(after)
}

/// 1-based line number of byte offset `at` in `text`.
fn line_of(text: &str, at: usize) -> usize {
    text[..at].matches('\n').count() + 1
}

fn too_many_matches(before: &str, starts: &[usize], how: &str) -> anyhow::Error {
    const SHOW: usize = 10;
    let mut lines: Vec<String> = starts.iter().take(SHOW).map(|&s| line_of(before, s).to_string()).collect();
    if starts.len() > SHOW {
        lines.push("…".into());
    }
    anyhow!(
        "old_string found {} times{how} (lines {}). Add surrounding lines to old_string so it matches \
         only the place you mean, or set replace_all=true to change every occurrence.",
        starts.len(),
        lines.join(", ")
    )
}

/// `old_string not found`, plus the most likely reason when one can be told from the text.
fn not_found(before: &str, old: &str) -> anyhow::Error {
    let mut msg = String::from("old_string not found in the file.");
    let prefix = Regex::new(r"(?m)^\s*\d+\|").expect("static regex");
    let squash = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
    let first = old.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    if prefix.is_match(old) {
        msg.push_str(
            " It contains read's line-number prefixes (`  12|`): remove them and keep only the text after `|`.",
        );
    } else if squash(&unicode::nfc(before)).contains(&squash(&unicode::nfc(old))) {
        msg.push_str(
            " The same text exists with different whitespace (indentation, tabs vs spaces, or line breaks): \
             copy it exactly from a fresh read.",
        );
    } else if !first.is_empty() && first.len() < old.trim().len() {
        if let Some(at) = before.find(first) {
            msg.push_str(&format!(
                " Its first line occurs at line {}, but the following lines differ: the file may have \
                 changed; re-read from there.",
                line_of(before, at)
            ));
        }
    }
    msg.push_str(
        " old_string must match the current contents exactly. Re-read the lines (read with offset/limit, \
         or grep for a distinctive part), then copy the text as it is now.",
    );
    anyhow!(msg)
}

fn edit(ws: &Workspace, args: &Value) -> Result<ToolOutput> {
    let path = ws.resolve(args["path"].as_str().unwrap_or(""))?;
    let before = read_for_edit(ws, &path)?;
    let after = apply_edit(&before, args)?;
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

/// The file `edit` changes, with an error that says what to do instead.
fn read_for_edit(ws: &Workspace, path: &Path) -> Result<String> {
    let rel = ws.rel(path);
    if !path.exists() {
        return Err(anyhow!(
            "{rel} does not exist. edit only changes existing files: create it with write, or find \
             the right path with glob."
        ));
    }
    if path.is_dir() {
        return Err(anyhow!("{rel} is a directory; edit needs a file path (use glob to list files)."));
    }
    read_text(ws, path)
}

/// A UTF-8 text file for read/outline/edit. The runtime shows the model `err.to_string()` only,
/// so the cause and the next step go in the message itself (no `.context`).
fn read_text(ws: &Workspace, path: &Path) -> Result<String> {
    let rel = ws.rel(path);
    std::fs::read_to_string(path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => {
            anyhow!("{rel} not found. Check the path with glob (e.g. pattern `{}`).", file_name_glob(path))
        }
        std::io::ErrorKind::InvalidData => {
            anyhow!("{rel} is not UTF-8 text (binary, image, or another encoding).")
        }
        _ if path.is_dir() => anyhow!("{rel} is a directory; give a file path (glob `{rel}/*` lists it)."),
        _ => anyhow!("cannot read {rel}: {e}"),
    })
}

fn file_name_glob(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "**/*".into())
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
    let before = read_for_edit(ws, &path)?;
    let after = apply_edit(&before, args)?;
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
        if glob_matches(&glob, &rel) {
            matches.push(rel);
            if matches.len() >= limit {
                break;
            }
        }
    }
    let mut output = matches.join("\n");
    if matches.is_empty() {
        output = format!("No files match `{pattern}`.");
        if pattern.contains('{') {
            output.push_str(" `{a,b}` alternation is not supported: call glob once per pattern.");
        } else if pattern.contains('/') && !pattern.starts_with("**") {
            output.push_str(&format!(
                " A pattern with `/` is matched from the workspace root; try `**/{pattern}` or just the file name."
            ));
        } else {
            output.push_str(" Files ignored by .gitignore are not listed. Try a broader pattern, e.g. `**/*name*`.");
        }
    } else if matches.len() >= limit {
        output.push_str(&format!(
            "\n…[head_limit {limit} reached; narrow the pattern or raise head_limit]"
        ));
    }
    Ok(ToolOutput {
        ok: true,
        output,
        diff: None,
    })
}

/// A glob pattern matches the workspace-relative path or the bare file name (`*.rs` = any depth).
fn glob_matches(glob: &Regex, rel: &str) -> bool {
    glob.is_match(rel) || rel.rsplit('/').next().is_some_and(|name| glob.is_match(name))
}

#[derive(Clone, Copy, PartialEq)]
enum GrepMode {
    Content,
    Files,
    Count,
}

fn grep(ws: &Workspace, args: &Value) -> Result<ToolOutput> {
    // NFC pattern, and lines not in NFC are also tried in NFC: Vietnamese stored decomposed
    // (NFD) is found by the same text the model types (see `unicode`). Output keeps the line.
    let pattern = unicode::nfc(args["pattern"].as_str().unwrap_or(""));
    let case_insensitive = args
        .get("case_insensitive")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let re = regex::RegexBuilder::new(&pattern)
        .case_insensitive(case_insensitive)
        .build()
        .map_err(|e| {
            anyhow!(
                "invalid regex `{pattern}`: {e}\nRust regex syntax: escape literal `( ) [ ] {{ }} . * + ? | ^ $ \\` \
                 with a backslash (e.g. `foo\\(` to find `foo(`); lookaround and backreferences are not supported."
            )
        })?;
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
    let mut searched = 0usize;
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
            if !glob_matches(g, &rel) {
                continue;
            }
        }
        searched += 1;
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
            .filter(|(_, l)| re.is_match(l) || (!unicode::is_nfc(l) && re.is_match(&unicode::nfc(l))))
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
        out.push(match glob_pat {
            Some(g) if searched == 0 => format!(
                "No files match glob `{g}`, so nothing was searched. Check it with the glob tool, or drop `glob`."
            ),
            _ if case_insensitive => "No matches.".into(),
            _ => "No matches. (Case-sensitive: set case_insensitive=true, or shorten/loosen the pattern.)".into(),
        });
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
    let text = read_text(ws, &path)?;
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
    let pattern = pattern.replace('\\', "/");
    let chars: Vec<char> = pattern.trim_start_matches("./").chars().collect();
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

/// PowerShell (Windows, UTF-8) or `bash -lc`, cwd = workspace root, stdout/stderr piped,
/// killed on drop. Shared by `shell` and background processes (`procs`).
pub fn shell_command(ws: &Workspace, command: &str) -> Command {
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
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    cmd
}

async fn shell(ws: &Workspace, args: &Value) -> Result<ToolOutput> {
    let command = args["command"].as_str().unwrap_or("");
    if command.trim().is_empty() {
        return Err(anyhow!("command is empty: pass the command line to run in `command`."));
    }
    let timeout_ms = args
        .get("timeout_ms")
        .and_then(|v| v.as_u64())
        .unwrap_or(120_000);
    let mut cmd = shell_command(ws, command);
    let child = cmd
        .spawn()
        .map_err(|e| anyhow!("cannot start {}: {e}", if cfg!(windows) { "powershell" } else { "bash" }))?;
    let pid = child.id().unwrap_or(0);
    let _guard = silence_sandbox::wrap_pid(pid).ok();
    let result = tokio::time::timeout(Duration::from_millis(timeout_ms), child.wait_with_output()).await;
    let output = match result {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(anyhow!("shell failed while waiting for the command: {e}")),
        Err(_) => {
            return Err(anyhow!(
                "shell timed out after {timeout_ms} ms and the command was killed. If it waits for \
                 input, make it non-interactive (stdin is closed; pass flags such as -y/--yes). A server \
                 or watcher that keeps running belongs in proc_start. For a slow build or test, raise \
                 timeout_ms."
            ))
        }
    };
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut text = String::new();
    // Hint first: `execute` caps output from the end, and the hint matters more than the tail.
    if !output.status.success() {
        if let Some(hint) = shell_hint(command, &stderr, cfg!(windows)) {
            text.push_str(&format!("[hint] {hint}\n"));
        }
    }
    text.push_str(&String::from_utf8_lossy(&output.stdout));
    if !stderr.is_empty() {
        text.push_str("\nSTDERR:\n");
        text.push_str(&stderr);
    }
    if let (false, Some(code)) = (output.status.success(), output.status.code()) {
        text.push_str(&format!("\n[exit code {code}]"));
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

/// Bash/Unix habits that fail in Windows PowerShell 5.1, with their PowerShell form.
const PS_MISSING_COMMANDS: &[(&str, &str)] = &[
    ("head", "`Select-Object -First N` (or `Get-Content file -TotalCount N`)"),
    ("tail", "`Select-Object -Last N` (or `Get-Content file -Tail N`)"),
    ("grep", "`Select-String -Pattern 'x'` (or the grep tool for files)"),
    ("export", "`$env:NAME = 'value'`"),
    ("touch", "`New-Item -ItemType File path`"),
    ("which", "`(Get-Command name).Source`"),
    ("wc", "`Measure-Object -Line`"),
    ("sed", "`(Get-Content f) -replace 'a','b' | Set-Content f` (or the edit tool)"),
    ("awk", "`ForEach-Object { $_.Split()[0] }`"),
    ("xargs", "`ForEach-Object { … }`"),
    ("source", "`. .\\script.ps1`"),
];

/// A one-line fix for a failed `shell` call, judged from the command and its stderr. Only
/// PowerShell 5.1 traps for now (`windows`); bash errors are already clear to models.
fn shell_hint(command: &str, stderr: &str, windows: bool) -> Option<String> {
    if !windows {
        return None;
    }
    // PowerShell wraps error text at the console width; match on one line.
    let flat = stderr.split_whitespace().collect::<Vec<_>>().join(" ");
    let stderr = flat.as_str();
    if stderr.contains("is not a valid statement separator")
        || (stderr.contains("ParserError") && (command.contains("&&") || command.contains("||")))
    {
        return Some(
            "Windows PowerShell 5.1 has no `&&`/`||`. Use `A; if ($?) { B }` to run B only when A \
             succeeded, or `A; B` to run both."
                .into(),
        );
    }
    if stderr.contains("is not recognized as the name of a cmdlet") {
        // PowerShell quotes the missing name: "The term 'head' is not recognized …".
        let name = stderr
            .split("The term '")
            .nth(1)
            .and_then(|s| s.split('\'').next())
            .unwrap_or("");
        if let Some((_, fix)) = PS_MISSING_COMMANDS.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)) {
            return Some(format!("`{name}` does not exist in PowerShell; use {fix}."));
        }
        if name.contains('=') {
            return Some("`NAME=value cmd` is bash syntax; in PowerShell use `$env:NAME = 'value'; cmd`.".into());
        }
        if name.contains(' ') || name.contains('\\') || name.contains('/') {
            return Some(format!(
                "To run a program whose path is quoted or has spaces, use the call operator: `& \"{name}\" args`."
            ));
        }
        return Some(format!(
            "`{name}` is not a PowerShell command or a program on PATH. Check the name, or find it with \
             `Get-Command {name}*`."
        ));
    }
    if stderr.contains("NativeCommandError") && command.contains("2>&1") {
        return Some(
            "In Windows PowerShell 5.1 `2>&1` on a native program turns its stderr into errors. Drop \
             `2>&1`: stderr is already captured, and check `$LASTEXITCODE` for the real result."
                .into(),
        );
    }
    if stderr.contains("Missing file specification after redirection operator") && command.contains("<<") {
        return Some("PowerShell has no `<<EOF` heredoc: use a here-string `@'…'@` with `'@` at the start of its own line.".into());
    }
    None
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

    /// A file whose Vietnamese is stored decomposed (NFD), as macOS and some IMEs write it.
    fn nfd_ws() -> (tempfile::TempDir, Workspace, String) {
        use unicode_normalization::UnicodeNormalization;
        let dir = tempfile::tempdir().unwrap();
        let text: String = "// Tiêu đề trang\nconst title = \"Xin chào\";\n// tiêu đề phụ\n".nfd().collect();
        std::fs::write(dir.path().join("v.ts"), &text).unwrap();
        let ws = Workspace::new(dir.path()).unwrap();
        (dir, ws, text)
    }

    #[test]
    fn edit_matches_nfc_text_in_an_nfd_file_and_keeps_its_form() {
        use unicode_normalization::UnicodeNormalization;
        let (_d, ws, before) = nfd_ws();
        // The model writes NFC.
        edit(&ws, &json!({"path":"v.ts","old_string":"\"Xin chào\"","new_string":"\"Chào bạn\""})).unwrap();
        let after = std::fs::read_to_string(ws.root.join("v.ts")).unwrap();
        let expected = before.replace(&"\"Xin chào\"".nfd().collect::<String>(), &"\"Chào bạn\"".nfd().collect::<String>());
        assert_eq!(after, expected, "only the edited span changes, in the file's own (NFD) form");
        assert!(!unicode::is_nfc(&after));
    }

    #[test]
    fn nfc_fallback_still_requires_a_unique_match() {
        let (_d, ws, before) = nfd_ws();
        let err = edit(&ws, &json!({"path":"v.ts","old_string":"đề","new_string":"x"})).unwrap_err();
        assert!(err.to_string().contains("found 2 times (ignoring Unicode normalization)"), "{err}");
        assert_eq!(std::fs::read_to_string(ws.root.join("v.ts")).unwrap(), before);
        edit(&ws, &json!({"path":"v.ts","old_string":"đề","new_string":"đề mục","replace_all":true})).unwrap();
        let after = std::fs::read_to_string(ws.root.join("v.ts")).unwrap();
        assert_eq!(unicode::nfc(&after).matches("đề mục").count(), 2);
        assert_ne!(after, before);
    }

    #[test]
    fn grep_finds_nfc_pattern_in_nfd_file() {
        let (_d, ws, _) = nfd_ws();
        let out = grep(&ws, &json!({"pattern":"Xin chào"})).unwrap();
        assert!(out.output.contains("v.ts:2:"), "{}", out.output);
        let out = grep(&ws, &json!({"pattern":"tiêu đề", "case_insensitive": true, "output_mode":"count"})).unwrap();
        assert_eq!(out.output.trim(), "v.ts:2");
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
        assert!(none.starts_with("No matches."), "{none}");
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

    // --- Tool descriptions and actionable errors -------------------------------------------

    fn spec(name: &str) -> ToolSpec {
        specs(false).into_iter().find(|s| s.name == name).unwrap()
    }

    #[test]
    fn specs_say_when_to_use_each_tool() {
        let write = spec("write").description;
        assert!(write.contains("use edit instead"), "{write}");
        let edit = spec("edit").description;
        assert!(edit.contains("replace_all") && edit.contains("neighbouring lines"), "{edit}");
        assert!(edit.contains("line-number prefixes"), "{edit}");
        let glob = spec("glob").description;
        assert!(glob.contains("`**`") && glob.contains("grep"), "{glob}");
        for s in specs(false) {
            assert!(s.description.len() >= 40, "{} description too terse: {}", s.name, s.description);
        }
    }

    #[test]
    fn shell_spec_names_the_shell_it_really_runs() {
        let shell = spec("shell");
        if cfg!(windows) {
            // `shell_command` runs `powershell` (Windows PowerShell 5.1), not pwsh 7.
            assert!(shell.description.contains("Windows PowerShell 5.1"));
            for trap in ["`&&`", "$env:NAME", "Select-Object -First", "`2>&1`", "& \"C:\\Program Files"] {
                assert!(shell.description.contains(trap), "missing {trap}: {}", shell.description);
            }
            let cmd = shell.parameters["properties"]["command"]["description"].as_str().unwrap();
            assert!(cmd.contains("never `&&`"), "{cmd}");
        } else {
            assert!(shell.description.contains("bash -lc"));
            assert!(!shell.description.contains("PowerShell"));
        }
        assert!(shell.description.contains("proc_start"));
    }

    #[test]
    fn edit_ambiguous_match_lists_lines_and_both_fixes() {
        let (_d, ws) = tmp_ws();
        let err = edit(&ws, &json!({"path":"a.txt","old_string":"hello","new_string":"bye"}))
            .unwrap_err()
            .to_string();
        assert!(err.contains("found 2 times (lines 1, 2)"), "{err}");
        assert!(err.contains("surrounding lines") && err.contains("replace_all=true"), "{err}");
    }

    #[test]
    fn edit_not_found_explains_the_likely_cause() {
        let (_d, ws) = tmp_ws();
        std::fs::write(ws.root.join("f.py"), "def f():\n    return 1\n").unwrap();
        let err = |old: &str| {
            edit(&ws, &json!({"path":"f.py","old_string":old,"new_string":"x"})).unwrap_err().to_string()
        };
        let prefixed = err("     1|def f():");
        assert!(prefixed.contains("line-number prefixes"), "{prefixed}");
        let spaces = err("def f():\n  return 1");
        assert!(spaces.contains("different whitespace"), "{spaces}");
        let stale = err("def f():\n    return 2");
        assert!(stale.contains("first line occurs at line 1"), "{stale}");
        let other = err("nothing like this");
        assert!(other.starts_with("old_string not found") && other.contains("Re-read"), "{other}");
        let empty = err("");
        assert!(empty.contains("use write"), "{empty}");
    }

    #[test]
    fn edit_multiline_lf_old_string_matches_crlf_file() {
        let (_d, ws) = tmp_ws();
        std::fs::write(ws.root.join("w.txt"), "one\r\ntwo\r\nthree\r\n").unwrap();
        // What a model copies from `read` (which drops `\r`).
        edit(&ws, &json!({"path":"w.txt","old_string":"one\ntwo","new_string":"uno\ndos"})).unwrap();
        let after = std::fs::read_to_string(ws.root.join("w.txt")).unwrap();
        assert_eq!(after, "uno\r\ndos\r\nthree\r\n", "file keeps CRLF");
    }

    #[test]
    fn edit_and_write_path_errors_say_what_to_do() {
        let (_d, ws) = tmp_ws();
        let missing = edit(&ws, &json!({"path":"nope.txt","old_string":"a","new_string":"b"}))
            .unwrap_err()
            .to_string();
        assert!(missing.contains("does not exist") && missing.contains("write"), "{missing}");
        std::fs::create_dir(ws.root.join("dir")).unwrap();
        let dir = write(&ws, &json!({"path":"dir","contents":"x"})).unwrap_err().to_string();
        assert!(dir.contains("is a directory") && dir.contains("dir/new_file.txt"), "{dir}");
        let read_missing = read(&ws, &json!({"path":"src/nope.rs"})).unwrap_err().to_string();
        assert!(read_missing.contains("not found") && read_missing.contains("nope.rs"), "{read_missing}");
        let outside = write(&ws, &json!({"path":"../escape.txt","contents":"x"})).unwrap_err().to_string();
        assert!(outside.contains("escapes workspace") && outside.contains("inside the workspace"), "{outside}");
    }

    #[test]
    fn glob_matches_file_names_at_any_depth_and_explains_no_match() {
        let (_d, ws) = tmp_ws();
        std::fs::create_dir_all(ws.root.join("src/deep")).unwrap();
        std::fs::write(ws.root.join("src/deep/m.rs"), "fn main() {}\n").unwrap();
        let out = glob_files(&ws, &json!({"pattern":"*.rs"})).unwrap().output;
        assert_eq!(out, "src/deep/m.rs");
        let out = glob_files(&ws, &json!({"pattern":"./src/**/*.rs"})).unwrap().output;
        assert_eq!(out, "src/deep/m.rs");
        let none = glob_files(&ws, &json!({"pattern":"deep/*.rs"})).unwrap().output;
        assert!(none.starts_with("No files match") && none.contains("**/deep/*.rs"), "{none}");
        let braces = glob_files(&ws, &json!({"pattern":"*.{rs,ts}"})).unwrap().output;
        assert!(braces.contains("alternation is not supported"), "{braces}");
    }

    #[test]
    fn grep_glob_by_name_and_actionable_errors() {
        let (_d, ws) = tmp_ws();
        std::fs::create_dir_all(ws.root.join("src")).unwrap();
        std::fs::write(ws.root.join("src/m.rs"), "fn call(x) {}\n").unwrap();
        let out = grep(&ws, &json!({"pattern":"call","glob":"*.rs"})).unwrap().output;
        assert_eq!(out, "src/m.rs:1:fn call(x) {}");
        let bad = grep(&ws, &json!({"pattern":"call("})).unwrap_err().to_string();
        assert!(bad.contains("invalid regex `call(`") && bad.contains("escape literal"), "{bad}");
        let no_files = grep(&ws, &json!({"pattern":"x","glob":"*.zig"})).unwrap().output;
        assert!(no_files.contains("No files match glob `*.zig`"), "{no_files}");
        let case = grep(&ws, &json!({"pattern":"CALL"})).unwrap().output;
        assert!(case.contains("case_insensitive=true"), "{case}");
    }

    #[test]
    fn shell_hint_covers_powershell_traps() {
        let amp = "At line:1 char:8\n+ echo a && echo b\nThe token '&&' is not a valid statement\nseparator in this version.";
        assert!(shell_hint("echo a && echo b", amp, true).unwrap().contains("if ($?)"));
        let head = "head : The term 'head' is not recognized as the name of a cmdlet, function, script file, or operable program.";
        assert!(shell_hint("head -n 3 x", head, true).unwrap().contains("Select-Object -First"));
        let env = "FOO=1 : The term 'FOO=1' is not recognized as the name of a cmdlet, function, script file, or\noperable program.";
        assert!(shell_hint("FOO=1 node -v", env, true).unwrap().contains("$env:NAME"));
        let unknown = "The term 'frobnicate' is not recognized as the name of a cmdlet";
        assert!(shell_hint("frobnicate", unknown, true).unwrap().contains("Get-Command frobnicate*"));
        let native = "git : fatal: bad\n+ CategoryInfo : NotSpecified\n+ FullyQualifiedErrorId : NativeCommandError";
        assert!(shell_hint("git x 2>&1", native, true).unwrap().contains("$LASTEXITCODE"));
        let heredoc = "Missing file specification after redirection operator.";
        assert!(shell_hint("cat <<EOF", heredoc, true).unwrap().contains("here-string"));
        assert!(shell_hint("echo a && echo b", amp, false).is_none(), "bash errors need no hint");
        assert!(shell_hint("python t.py", "Traceback: boom", true).is_none());
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn shell_failure_carries_hint_and_exit_code() {
        let (_d, ws) = tmp_ws();
        let out = shell(&ws, &json!({"command":"echo a && echo b"})).await.unwrap();
        assert!(!out.ok);
        assert!(out.output.starts_with("[hint] Windows PowerShell 5.1 has no `&&`"), "{}", out.output);
        assert!(out.output.trim_end().ends_with("[exit code 1]"), "{}", out.output);
        let ok = shell(&ws, &json!({"command":"echo a; if ($?) { echo b }"})).await.unwrap();
        assert!(ok.ok && !ok.output.contains("[hint]"), "{}", ok.output);
        let slow = shell(&ws, &json!({"command":"Start-Sleep -Seconds 5","timeout_ms":300})).await.unwrap_err();
        assert!(slow.to_string().contains("timed out after 300 ms") && slow.to_string().contains("proc_start"));
    }
}
