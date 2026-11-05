use anyhow::{anyhow, Context, Result};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;
use tokio::process::Command;

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
        let canon = dunce::canonicalize(&candidate).unwrap_or(candidate);
        if !canon.starts_with(&self.root) {
            return Err(anyhow!("path escapes workspace: {}", canon.display()));
        }
        Ok(canon)
    }

    pub fn rel(&self, path: &Path) -> String {
        path.strip_prefix(&self.root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| path.display().to_string())
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
        description: "Read a UTF-8 text file. Optional offset/limit in lines.".into(),
        parameters: obj(
            json!({
                "path": {"type": "string"},
                "offset": {"type": "integer"},
                "limit": {"type": "integer"}
            }),
            &["path"],
        ),
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
        description: "Regex search in workspace text files.".into(),
        parameters: obj(
            json!({
                "pattern": {"type": "string"},
                "glob": {"type": "string"},
                "head_limit": {"type": "integer"}
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
    match name {
        "read" => read(ws, args),
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
        .unwrap_or(lines.len());
    let slice = &lines[start..lines.len().min(start + limit)];
    let mut out = String::new();
    for (i, line) in slice.iter().enumerate() {
        out.push_str(&format!("{:>6}|{}\n", start + i + 1, line));
    }
    Ok(ToolOutput {
        ok: true,
        output: out,
        diff: None,
    })
}

fn write(ws: &Workspace, args: &Value) -> Result<ToolOutput> {
    let rel = args["path"].as_str().unwrap_or("");
    let path = if Path::new(rel).is_absolute() {
        ws.resolve(rel)?
    } else {
        let p = ws.root.join(rel);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent)?;
        }
        p
    };
    if !path.starts_with(&ws.root) {
        return Err(anyhow!("path escapes workspace"));
    }
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

/// Propose a write without committing to disk. Wave 0 stub still commits (Plan 01-02 greens staging).
pub fn stage_write(ws: &Workspace, args: &Value) -> Result<ToolOutput> {
    write(ws, args)
}

/// Propose an edit without committing to disk. Wave 0 stub still commits (Plan 01-02 greens staging).
pub fn stage_edit(ws: &Workspace, args: &Value) -> Result<ToolOutput> {
    edit(ws, args)
}

/// Discard a staged path; disk must stay at `before`. Wave 0 stub is a no-op.
pub fn reject_staged(_ws: &Workspace, _rel: &str) -> Result<()> {
    Ok(())
}

/// Commit a staged path to disk. Wave 0 stub — Plan 01-02 wires real pending→fs apply.
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

fn grep(ws: &Workspace, args: &Value) -> Result<ToolOutput> {
    let pattern = args["pattern"].as_str().unwrap_or("");
    let re = Regex::new(pattern).context("invalid regex")?;
    let glob_pat = args.get("glob").and_then(|v| v.as_str());
    let glob = glob_pat.map(glob_to_regex).transpose()?;
    let limit = args
        .get("head_limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(80) as usize;
    let mut hits = Vec::new();
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
        let Ok(text) = std::fs::read_to_string(entry.path()) else {
            continue;
        };
        if text.bytes().take(1024).any(|b| b == 0) {
            continue;
        }
        for (i, line) in text.lines().enumerate() {
            if re.is_match(line) {
                hits.push(format!("{}:{}:{}", rel, i + 1, line));
                if hits.len() >= limit {
                    break;
                }
            }
        }
        if hits.len() >= limit {
            break;
        }
    }
    Ok(ToolOutput {
        ok: true,
        output: hits.join("\n"),
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
        c.args(["-NoProfile", "-NonInteractive", "-Command", command]);
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
    if text.len() > 80_000 {
        text.truncate(80_000);
        text.push_str("\n...truncated...");
    }
    Ok(ToolOutput {
        ok: output.status.success(),
        output: text,
        diff: None,
    })
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
