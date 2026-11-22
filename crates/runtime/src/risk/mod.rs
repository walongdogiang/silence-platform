//! Risk Engine: classifies a tool call into a tier with reason codes.
//!
//! Spec: `docs/security/permissions.md`. Catalog of codes: `docs/security/risk-catalog.md`.
//! Machine policy: `default_policy.yaml` (embedded). Pure and synchronous; wiring into
//! `ask_perm` is Plan B3. Rules only ever raise a tier; anything unknown is at least `ask`.

pub mod command;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    /// 0 — read-only; runs without asking.
    Auto,
    /// 1 — reversible / contained; runs without asking in `balanced`, audited.
    Logged,
    /// 2 — risky; ask with an explanation.
    Ask,
    /// 3 — dangerous; refused.
    Block,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CodeInfo {
    pub tier: Tier,
    pub title: String,
    pub detail: String,
    pub hint: String,
}

#[derive(Debug, Clone, Deserialize)]
struct CommandRule {
    #[serde(rename = "match")]
    words: Vec<String>,
    code: String,
    #[serde(default)]
    flags_any: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct Policy {
    pub codes: BTreeMap<String, CodeInfo>,
    aliases: HashMap<String, String>,
    commands: Vec<CommandRule>,
    exec_sinks: Vec<String>,
    downloaders: Vec<String>,
    interpreters: Vec<String>,
    inline_flags: Vec<String>,
    encoded_flags: Vec<String>,
    upload_flags: Vec<String>,
    secret_patterns: Vec<String>,
    policy_files: Vec<String>,
    never_remember: Vec<String>,
    taint_codes: Vec<String>,
    subcommand_programs: Vec<String>,
    pub sandbox_covers: Vec<String>,
    always_ask: Vec<String>,
    never_escalate: Vec<String>,
}

impl Tier {
    pub fn as_str(self) -> &'static str {
        match self {
            Tier::Auto => "auto",
            Tier::Logged => "logged",
            Tier::Ask => "ask",
            Tier::Block => "block",
        }
    }
}

const POLICY_YAML: &str = include_str!("default_policy.yaml");

/// Built-in policy. Validated by tests (`policy_is_valid`), so a bad edit fails CI, not users.
pub fn policy() -> &'static Policy {
    static P: OnceLock<Policy> = OnceLock::new();
    P.get_or_init(|| serde_yaml::from_str(POLICY_YAML).expect("risk/default_policy.yaml is invalid"))
}

/// Facts about the session the classifier needs.
pub struct RiskCtx<'a> {
    pub workspace: &'a Path,
    /// This turn already ingested external content (MCP / network output).
    pub tainted: bool,
    /// For `mcp__*` calls: the server marked the tool `readOnlyHint`.
    pub mcp_read_only: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Verdict {
    pub tier: Tier,
    /// Reason codes, highest tier first. Never empty.
    pub codes: Vec<String>,
    /// Hosts named by URL in network commands (`curl https://x.io/a` → `x.io`), lowercase.
    pub net_hosts: Vec<String>,
    /// A network command whose target could not be read from its arguments (`ssh box`).
    pub net_unknown: bool,
}

/// What Autonomous mode does with a call while the sandbox is Ready.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SandboxPlan {
    /// Run inside the sandbox without asking.
    Cover,
    /// Ask the user first; if allowed it runs outside the sandbox, like in Balanced.
    Ask,
}

impl Verdict {
    fn new() -> Self {
        Self { tier: Tier::Auto, codes: Vec::new(), net_hosts: Vec::new(), net_unknown: false }
    }

    /// Hosts of this call that are not in `allow` (all of them when a target is unreadable).
    pub fn unlisted_hosts(&self, allow: &[String]) -> Vec<String> {
        self.net_hosts
            .iter()
            .filter(|h| !silence_sandbox::proxy::host_allowed(h, allow))
            .cloned()
            .collect()
    }

    /// Autonomous + sandbox Ready: may this call run in the sandbox without asking?
    /// `allow` = hosts the proxy lets through; `can_undo` = the turn has a git snapshot.
    pub fn sandbox_plan(&self, allow: &[String], can_undo: bool) -> SandboxPlan {
        let p = policy();
        if self.tier == Tier::Block || self.codes.iter().any(|c| p.always_ask.contains(c)) {
            return SandboxPlan::Ask;
        }
        for c in &self.codes {
            let tier = p.codes.get(c).map(|i| i.tier).unwrap_or(Tier::Ask);
            if tier < Tier::Ask {
                continue;
            }
            if !p.sandbox_covers.contains(c) {
                return SandboxPlan::Ask;
            }
            match c.as_str() {
                "NET_ACCESS" if self.net_unknown || !self.unlisted_hosts(allow).is_empty() => return SandboxPlan::Ask,
                "FS_DELETE" if !can_undo => return SandboxPlan::Ask,
                _ => {}
            }
        }
        SandboxPlan::Cover
    }

    /// The escalation card may not offer to run this blocked call anyway.
    pub fn never_escalate(&self) -> bool {
        self.codes.iter().any(|c| policy().never_escalate.contains(c))
    }

    fn add(&mut self, code: &str) {
        let tier = policy().codes.get(code).map(|c| c.tier).unwrap_or(Tier::Ask);
        if tier > self.tier {
            self.tier = tier;
        }
        if !self.codes.iter().any(|c| c == code) {
            self.codes.push(code.to_string());
        }
    }

    fn finish(mut self) -> Self {
        let p = policy();
        let tier_of = |c: &str| p.codes.get(c).map(|i| i.tier).unwrap_or(Tier::Ask);
        self.codes.sort_by(|a, b| tier_of(b).cmp(&tier_of(a)).then(a.cmp(b)));
        if self.codes.is_empty() {
            self.add("UNKNOWN_TOOL");
        }
        self
    }

    /// Code that decides the tier (first, highest).
    pub fn primary(&self) -> &str {
        &self.codes[0]
    }

    /// A remembered allowlist entry may not cover this call (always re-ask).
    pub fn never_remember(&self) -> bool {
        self.tier == Tier::Block || self.codes.iter().any(|c| policy().never_remember.contains(c))
    }

    /// Running this feeds outside content to the model (MCP output, fetched URLs).
    pub fn brings_external_content(&self) -> bool {
        self.codes.iter().any(|c| policy().taint_codes.contains(c))
    }

    /// Codes at the decisive tier and above it are what the user needs to read.
    fn shown_codes(&self) -> Vec<&String> {
        let p = policy();
        let floor = self.tier.max(Tier::Ask);
        let top: Vec<&String> = self
            .codes
            .iter()
            .filter(|c| p.codes.get(*c).is_some_and(|i| i.tier >= floor))
            .collect();
        if top.is_empty() { self.codes.iter().take(1).collect() } else { top }
    }

    /// Message the model sees when the call is blocked (English hint, fixed text).
    pub fn block_message(&self) -> String {
        let p = policy();
        let code = self.primary();
        let hint = p.codes.get(code).map(|i| i.hint.as_str()).unwrap_or("");
        format!("blocked by policy ({code}): {hint} Do not retry this command; tell the user what you wanted to do.")
    }

    /// Short Vietnamese title of the decisive reason.
    pub fn title(&self) -> String {
        policy().codes.get(self.primary()).map(|i| i.title.clone()).unwrap_or_default()
    }

    pub fn to_protocol(&self, pattern: Option<String>) -> silence_protocol::PermissionRisk {
        let p = policy();
        silence_protocol::PermissionRisk {
            tier: self.tier.as_str().to_string(),
            reasons: self
                .shown_codes()
                .into_iter()
                .map(|c| {
                    let info = p.codes.get(c);
                    silence_protocol::RiskReason {
                        code: c.clone(),
                        title: info.map(|i| i.title.clone()).unwrap_or_default(),
                        detail: info.map(|i| i.detail.clone()).unwrap_or_default(),
                    }
                })
                .collect(),
            pattern,
            hosts: Vec::new(),
            escalation: None,
            ..Default::default()
        }
    }
}

/// Words of a single, plain shell command used for "remember": program plus its subcommand
/// for tools like git/npm/cargo. `None` for pipelines, chains, redirects or dynamic syntax:
/// those are never remembered, because a pattern could hide a second command.
fn shell_words(cmd: &str) -> Option<Vec<String>> {
    let parsed = command::parse(cmd);
    if parsed.dynamic || !parsed.redirects.is_empty() || parsed.segments.len() != 1 {
        return None;
    }
    let toks = &parsed.segments[0].tokens;
    let first = toks.first()?;
    if first.contains('=') {
        return None;
    }
    let prog = canonical(first);
    if matches!(prog.as_str(), "sudo" | "doas" | "nohup" | "time" | "nice") {
        return None;
    }
    let mut words = vec![prog.clone()];
    if policy().subcommand_programs.contains(&prog) {
        if let Some(sub) = toks.iter().skip(1).find(|t| !t.starts_with('-')) {
            words.push(sub.to_ascii_lowercase());
        }
    }
    Some(words)
}

/// Pattern stored when the user remembers a shell approval: `npm install *`.
pub fn shell_pattern(cmd: &str) -> Option<String> {
    shell_words(cmd).map(|w| format!("{} *", w.join(" ")))
}

/// Does a remembered shell pattern (`npm install *`) cover this command?
pub fn shell_matches(pattern: &str, cmd: &str) -> bool {
    let want: Vec<&str> = pattern.trim_end_matches('*').split_whitespace().collect();
    match shell_words(cmd) {
        Some(words) => !want.is_empty() && words.iter().map(String::as_str).eq(want.iter().copied()),
        None => false,
    }
}

/// Classify one tool call. Pure: no I/O besides lexical path math.
pub fn classify(tool: &str, args: &Value, ctx: &RiskCtx) -> Verdict {
    let mut v = Verdict::new();
    match tool {
        // `proc_start` runs a shell command in the background: same rules as `shell`.
        "shell" | "proc_start" => {
            let cmd = args.get("command").and_then(Value::as_str).unwrap_or("");
            classify_command(cmd, ctx.workspace, &mut v);
            if ctx.tainted && v.tier < Tier::Ask {
                v.add("TAINTED_CONTEXT");
            }
        }
        "read" | "outline" | "glob" | "grep" | "view_image" | "git_status" | "git_diff"
        // `skill`: a workspace SKILL.md body already loaded by `org::load`.
        | "skill" => {
            v.add("READ_WS");
            for p in arg_paths(args) {
                check_path(&p, ctx.workspace, PathUse::Read, &mut v);
            }
        }
        "write" | "edit" => {
            v.add("WRITE_WS");
            for p in arg_paths(args) {
                check_path(&p, ctx.workspace, PathUse::Write, &mut v);
            }
        }
        "http_check" => {
            let url = args.get("url").and_then(Value::as_str).unwrap_or("");
            v.add(if silence_tools::http::local_url(url).is_ok() { "LOCAL_HTTP" } else { "HTTP_NOT_LOCAL" });
        }
        "browser_open" => {
            let url = args.get("url").and_then(Value::as_str).unwrap_or("");
            v.add(if silence_tools::http::local_url(url).is_ok() { "LOCAL_BROWSER" } else { "BROWSER_NOT_LOCAL" });
        }
        // Clicks and typing on the page already open (opened on this machine).
        "browser_act" => v.add("LOCAL_BROWSER"),
        "browser_snapshot" | "browser_console" | "browser_network" | "browser_close" | "browser_screenshot"
        | "browser_export_test" => v.add("INTERNAL"),
        "submit_plan" | "suggest_mode" | "task" | "update_todos" => v.add("INTERNAL"),
        // Read or stop processes this session started.
        "proc_logs" | "proc_list" | "proc_stop" => v.add("INTERNAL"),
        t if t.starts_with("mcp__") => v.add(if ctx.mcp_read_only { "MCP_READ" } else { "MCP_CALL" }),
        _ => v.add("UNKNOWN_TOOL"),
    }
    v.finish()
}

fn arg_paths(args: &Value) -> Vec<String> {
    ["path", "file", "target"]
        .iter()
        .filter_map(|k| args.get(*k).and_then(Value::as_str))
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .collect()
}

#[derive(Clone, Copy, PartialEq)]
enum PathUse {
    Read,
    Write,
    Delete { recursive: bool },
}

fn check_path(raw: &str, ws: &Path, how: PathUse, v: &mut Verdict) {
    let p = policy();
    let path = raw.trim_matches(['"', '\'']).trim_start_matches('@');
    let norm = path.replace('\\', "/").to_ascii_lowercase();
    if p.policy_files.iter().any(|f| norm.ends_with(f.as_str())) && how != PathUse::Read {
        v.add("POLICY_TAMPER");
        return;
    }
    if is_secret(path) {
        v.add("SECRET_READ");
    }
    match resolve(path, ws) {
        Some(abs) if abs.starts_with(&normalize(ws)) => {
            if let PathUse::Delete { recursive: true } = how {
                if abs == normalize(ws) {
                    // Wiping the whole workspace is still recoverable only from git: ask, loudly.
                    v.add("FS_DELETE");
                }
            }
        }
        _ => match how {
            PathUse::Delete { recursive: true } => v.add("FS_DELETE_SYSTEM"),
            _ => v.add("FS_OUTSIDE_WS"),
        },
    }
}

/// Lexically resolve a command-line path against the workspace. `None` = unknowable
/// (home, environment variables) and is treated as outside.
fn resolve(path: &str, ws: &Path) -> Option<PathBuf> {
    let lower = path.to_ascii_lowercase();
    if path.starts_with('~')
        || lower.starts_with("$home")
        || lower.starts_with("$env:")
        || lower.starts_with("${env:")
        || lower.starts_with('%')
        || lower.starts_with("\\\\")
    {
        return None;
    }
    let mut s = path.replace('\\', "/");
    // MSYS style `/d/vuhieu` → `d:/vuhieu`.
    let b = s.as_bytes();
    if b.len() >= 2 && b[0] == b'/' && b[1].is_ascii_alphabetic() && (b.len() == 2 || b[2] == b'/') {
        s = format!("{}:{}", b[1] as char, &s[2..]);
    }
    let pb = PathBuf::from(&s);
    let joined = if pb.is_absolute() || s.starts_with('/') || (s.len() >= 2 && s.as_bytes()[1] == b':') {
        pb
    } else {
        ws.join(pb)
    };
    Some(normalize(&joined))
}

/// Lowercased, forward-slash, `.`/`..` folded. Case-insensitive like Windows paths.
fn normalize(p: &Path) -> PathBuf {
    let mut out: Vec<String> = Vec::new();
    let mut prefix = String::new();
    for c in p.components() {
        match c {
            Component::Prefix(x) => prefix = x.as_os_str().to_string_lossy().to_ascii_lowercase(),
            Component::RootDir => prefix.push('/'),
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::Normal(s) => out.push(s.to_string_lossy().to_ascii_lowercase()),
        }
    }
    let s = format!("{}{}", prefix.replace('\\', "/"), out.join("/"));
    PathBuf::from(s.replace("//", "/"))
}

fn is_secret(path: &str) -> bool {
    let norm = path.replace('\\', "/").to_ascii_lowercase();
    norm.split('/').filter(|s| !s.is_empty()).any(|seg| {
        policy().secret_patterns.iter().any(|pat| wild(pat, seg))
    })
}

/// `*` wildcard on one path segment.
fn wild(pat: &str, s: &str) -> bool {
    match pat.split_once('*') {
        None => pat == s,
        Some((pre, post)) => s.len() >= pre.len() + post.len() && s.starts_with(pre) && s.ends_with(post),
    }
}

/// cmd.exe-style switch: `/s`, `/q`, `/F`, `/IM`, `/w:C`.
fn is_cmd_switch(t: &str) -> bool {
    let Some(rest) = t.strip_prefix('/') else { return false };
    let name = rest.split(':').next().unwrap_or("");
    (1..=3).contains(&name.len()) && name.chars().all(|c| c.is_ascii_alphabetic() || c == '?') && !rest.contains('/')
}

fn looks_like_path(t: &str) -> bool {
    if t.contains("://") || t.is_empty() || is_cmd_switch(t) {
        return false;
    }
    let t = t.trim_start_matches('@');
    t.contains('/')
        || t.contains('\\')
        || t.starts_with('~')
        || t.starts_with('.')
        || t.to_ascii_lowercase().starts_with("$home")
        || t.to_ascii_lowercase().starts_with("$env:")
        || t.starts_with('%')
        || (t.len() >= 2 && t.as_bytes()[1] == b':' && t.as_bytes()[0].is_ascii_alphabetic())
        || is_secret(t)
}

fn has_flag(tokens: &[String], flags: &[String]) -> bool {
    tokens.iter().skip(1).any(|t| {
        let t = t.to_ascii_lowercase();
        flags.iter().any(|f| {
            t == *f || ((f.ends_with(':') || f.starts_with('/')) && t.starts_with(f.as_str()))
        })
    })
}

fn canonical(tok: &str) -> String {
    let name = command::program_name(tok);
    policy().aliases.get(&name).cloned().unwrap_or(name)
}

/// Rule words after the program match the segment, skipping option tokens unless the
/// rule word itself is an option (`python -m pytest`).
fn rule_matches(rule: &CommandRule, prog: &str, tokens: &[String]) -> bool {
    if rule.words.first().map(String::as_str) != Some(prog) {
        return false;
    }
    let mut it = tokens.iter().skip(1).map(|t| t.to_ascii_lowercase());
    for w in &rule.words[1..] {
        loop {
            match it.next() {
                None => return false,
                Some(t) if t == *w => break,
                Some(t) if t.starts_with('-') && !w.starts_with('-') => continue,
                Some(_) => return false,
            }
        }
    }
    rule.flags_any.is_empty() || has_flag(tokens, &rule.flags_any)
}

fn is_delete(prog: &str) -> bool {
    prog == "remove-item" || prog == "clear-content"
}

fn is_recursive(tokens: &[String]) -> bool {
    tokens.iter().skip(1).any(|t| {
        let l = t.to_ascii_lowercase();
        l == "/s"
            || l.starts_with("-r")
            || (l.starts_with('-') && !l.starts_with("--") && l.contains('r') && l.len() <= 4)
            || l == "--recursive"
    })
}

/// Hosts of the `scheme://host[:port]/…` tokens of a command (lowercase, userinfo stripped).
fn url_hosts(tokens: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for t in tokens.iter().skip(1) {
        let t = t.trim_matches(['"', '\'', '(', ')', ',', ';']);
        let t = t.split_once('=').filter(|(k, _)| !k.contains("://")).map_or(t, |(_, v)| v);
        let Some((_, rest)) = t.split_once("://") else { continue };
        let auth = rest.split(['/', '?', '#']).next().unwrap_or("");
        let auth = auth.rsplit_once('@').map_or(auth, |(_, h)| h);
        let host = if let Some(v6) = auth.strip_prefix('[') {
            v6.split(']').next().unwrap_or("")
        } else {
            auth.split(':').next().unwrap_or("")
        };
        let host = host.trim_end_matches('.').to_ascii_lowercase();
        if !host.is_empty() && !host.contains(['$', '%', '`', '{']) && !out.contains(&host) {
            out.push(host);
        }
    }
    out
}

/// `git` global options before the subcommand: returns `[git, sub, args…]` and the directory
/// the command runs in (`-C dir`, relative to the previous one). `-c core.hooksPath=…` and
/// `--config-env=core.hooksPath=…` disable the repo's hooks → `GIT_NO_VERIFY`.
fn git_globals(toks: &[String], ws: &Path, v: &mut Verdict) -> (Vec<String>, PathBuf) {
    let mut dir = ws.to_path_buf();
    let mut i = 1;
    while let Some(t) = toks.get(i) {
        if !t.starts_with('-') {
            break;
        }
        let l = t.to_ascii_lowercase();
        match t.as_str() {
            "-C" => {
                if let Some(d) = toks.get(i + 1) {
                    let p = Path::new(d.as_str());
                    dir = if p.is_absolute() { p.to_path_buf() } else { dir.join(p) };
                }
                i += 2;
            }
            "-c" | "--config-env" => {
                if toks.get(i + 1).is_some_and(|kv| is_hooks_key(kv)) {
                    v.add("GIT_NO_VERIFY");
                }
                i += 2;
            }
            "--git-dir" | "--work-tree" | "--namespace" | "--super-prefix" => i += 2,
            _ => {
                if l.starts_with("--config-env=") && is_hooks_key(&l) {
                    v.add("GIT_NO_VERIFY");
                }
                i += 1;
            }
        }
    }
    let mut out = vec![toks[0].clone()];
    out.extend(toks.iter().skip(i).cloned());
    (out, dir)
}

fn is_hooks_key(s: &str) -> bool {
    s.to_ascii_lowercase().contains("core.hookspath")
}

/// Git rules that need more than word matching: pushes that land on the default branch
/// (`GIT_PUSH_DEFAULT`, including a bare `git push` while on it) and hook bypass
/// (`GIT_NO_VERIFY`). `g` is `[git, sub, args…]` from `git_globals`.
fn git_guard(g: &[String], dir: &Path, v: &mut Verdict) {
    let Some(sub) = g.get(1).map(|s| s.to_ascii_lowercase()) else { return };
    let args = &g[2..];
    if args.iter().any(|a| a.eq_ignore_ascii_case("--no-verify")) {
        v.add("GIT_NO_VERIFY");
    }
    match sub.as_str() {
        // `commit -n` = `--no-verify`, also inside short clusters (`-nm "msg"`).
        "commit" => {
            let takes_value = ["-m", "-F", "-C", "-c", "-t"];
            let short_n = args.iter().enumerate().any(|(i, a)| {
                let prev_is_flag_value = i > 0 && takes_value.contains(&args[i - 1].as_str());
                !prev_is_flag_value
                    && a.len() >= 2
                    && a.starts_with('-')
                    && !a.starts_with("--")
                    && a[1..].chars().all(|c| c.is_ascii_alphabetic())
                    && a[1..].contains('n')
            });
            if short_n {
                v.add("GIT_NO_VERIFY");
            }
        }
        "config" => {
            let reads = args.iter().any(|a| {
                matches!(a.to_ascii_lowercase().as_str(), "--get" | "--get-all" | "--get-regexp" | "--list" | "-l")
            });
            if !reads && args.iter().any(|a| is_hooks_key(a)) {
                v.add("GIT_NO_VERIFY");
            }
        }
        "push" => {
            if pushes_default_branch(args, dir) {
                v.add("GIT_PUSH_DEFAULT");
            }
        }
        _ => {}
    }
}

/// Does `git push <args>` (run in `dir`) update the default branch? A refspec's destination
/// (`src:dst`, or `src` alone) is compared with main/master and `origin/HEAD`; with no refspec
/// the current branch is pushed. Unknown repo or detached HEAD: only explicit refspecs count.
fn pushes_default_branch(args: &[String], dir: &Path) -> bool {
    let mut positional: Vec<&str> = Vec::new();
    let (mut all, mut tags_only, mut has_repo) = (false, false, false);
    let mut i = 0;
    while let Some(a) = args.get(i) {
        let l = a.to_ascii_lowercase();
        match l.as_str() {
            "--all" | "--branches" | "--mirror" => all = true,
            "--tags" => tags_only = true,
            "--repo" => {
                has_repo = true;
                i += 1;
            }
            "-o" | "--push-option" | "--receive-pack" | "--exec" => i += 1,
            _ if l.starts_with("--repo=") => has_repo = true,
            _ if a.starts_with('-') => {}
            _ => positional.push(a.as_str()),
        }
        i += 1;
    }
    if all {
        return true;
    }
    let gitdir = git_dir_of(dir);
    let current = gitdir.as_deref().and_then(head_branch);
    let refspecs: &[&str] = if has_repo { &positional } else { positional.get(1..).unwrap_or(&[]) };
    let mut targets: Vec<String> = Vec::new();
    if refspecs.is_empty() {
        if !tags_only {
            targets.extend(current.clone());
        }
    }
    for spec in refspecs {
        let spec = spec.trim_start_matches('+');
        let dst = spec.split_once(':').map_or(spec, |(_, d)| d);
        let dst = dst.strip_prefix("refs/heads/").unwrap_or(dst);
        if dst == "HEAD" || dst == "@" {
            targets.extend(current.clone());
        } else if !dst.is_empty() {
            targets.push(dst.to_string());
        }
    }
    let protected = default_branches(gitdir.as_deref());
    targets.iter().any(|t| protected.iter().any(|p| p.eq_ignore_ascii_case(t)))
}

/// `.git` directory for `start` or its nearest ancestor (follows the `gitdir:` file of a worktree).
fn git_dir_of(start: &Path) -> Option<PathBuf> {
    let mut cur = Some(start);
    while let Some(d) = cur {
        let g = d.join(".git");
        if g.is_dir() {
            return Some(g);
        }
        if g.is_file() {
            let text = std::fs::read_to_string(&g).ok()?;
            let p = PathBuf::from(text.trim().strip_prefix("gitdir:")?.trim());
            return Some(if p.is_absolute() { p } else { d.join(p) });
        }
        cur = d.parent();
    }
    None
}

fn head_branch(gitdir: &Path) -> Option<String> {
    let head = std::fs::read_to_string(gitdir.join("HEAD")).ok()?;
    head.trim().strip_prefix("ref: refs/heads/").map(str::to_string)
}

/// main, master and whatever `origin/HEAD` points to (read from the common dir of a worktree).
fn default_branches(gitdir: Option<&Path>) -> Vec<String> {
    let mut out = vec!["main".to_string(), "master".to_string()];
    let Some(gitdir) = gitdir else { return out };
    let common = std::fs::read_to_string(gitdir.join("commondir"))
        .map(|c| gitdir.join(c.trim()))
        .unwrap_or_else(|_| gitdir.to_path_buf());
    if let Ok(text) = std::fs::read_to_string(common.join("refs/remotes/origin/HEAD")) {
        if let Some(b) = text.trim().strip_prefix("ref: refs/remotes/origin/") {
            out.push(b.to_string());
        }
    }
    out
}

/// `gh api`: GET without fields reads; a method, `-f/-F/--field/--raw-field/--input` (gh then
/// POSTs) or a GraphQL mutation writes; writing to a `…/merge` endpoint or `mergePullRequest`
/// merges.
fn gh_api_code(t: &[String]) -> &'static str {
    let mut method: Option<String> = None;
    let mut fields: Vec<&str> = Vec::new();
    let mut path: Option<&str> = None;
    let mut i = 2;
    while let Some(a) = t.get(i) {
        let l = a.to_ascii_lowercase();
        let next = t.get(i + 1).map(String::as_str);
        match l.as_str() {
            "-x" | "--method" => {
                method = next.map(str::to_ascii_uppercase);
                i += 1;
            }
            "-f" | "--field" | "--raw-field" | "--input" => {
                fields.push(next.unwrap_or(""));
                i += 1;
            }
            "-h" | "--header" | "-q" | "--jq" | "-t" | "--template" | "--hostname" | "--cache" | "-p" | "--preview" => i += 1,
            _ if l.starts_with("--method=") => method = Some(l["--method=".len()..].to_ascii_uppercase()),
            _ if l.starts_with("-x") && l.len() > 2 && !l.starts_with("--") => method = Some(l[2..].to_ascii_uppercase()),
            _ if l.starts_with("--field=") || l.starts_with("--raw-field=") || l.starts_with("--input=") => {
                fields.push(a.split_once('=').map_or("", |(_, v)| v));
            }
            _ if a.starts_with('-') => {}
            _ => {
                if path.is_none() {
                    path = Some(a.as_str());
                }
            }
        }
        i += 1;
    }
    let path = path.unwrap_or("").to_ascii_lowercase();
    let body = fields.join(" ").to_ascii_lowercase();
    if path == "graphql" {
        return if body.contains("mergepullrequest") {
            "GH_MERGE"
        } else if body.contains("mutation") || body.contains("query=@") {
            "GH_WRITE"
        } else {
            "GH_READ"
        };
    }
    let writes = match &method {
        Some(m) => m != "GET" && m != "HEAD",
        None => !fields.is_empty(),
    };
    if !writes {
        "GH_READ"
    } else if path.trim_end_matches('/').ends_with("/merge") {
        "GH_MERGE"
    } else {
        "GH_WRITE"
    }
}

/// Classify a shell command line into `v`.
pub fn classify_command(cmd: &str, ws: &Path, v: &mut Verdict) {
    let p = policy();
    let parsed = command::parse(cmd);
    if parsed.segments.is_empty() {
        v.add("UNPARSED");
        return;
    }
    if parsed.dynamic {
        v.add("UNPARSED");
    }
    let lower = cmd.to_ascii_lowercase();
    let mut downloaded = false; // a downloader appeared earlier in the current pipeline
    let any_downloader = parsed.segments.iter().any(|s| {
        s.tokens.first().is_some_and(|t| p.downloaders.contains(&canonical(t)))
    }) || lower.contains("downloadstring")
        || lower.contains("downloadfile")
        || lower.contains("net.webclient");
    let decodes = lower.contains("frombase64string")
        || lower.contains("base64 -d")
        || lower.contains("base64 --decode")
        || lower.contains("certutil -decode");
    let mut has_network = false;

    for seg in &parsed.segments {
        // Skip POSIX `VAR=value cmd` assignments.
        let mut toks: Vec<String> = seg
            .tokens
            .iter()
            .skip_while(|t| t.contains('=') && !t.starts_with('-') && !t.contains('/'))
            .cloned()
            .collect();
        // Look through wrappers: `sudo`/`doas` elevate (block) and still run the inner command.
        while let Some(w) = toks.first().map(|t| canonical(t)) {
            match w.as_str() {
                "sudo" | "doas" => v.add("SYSTEM_CHANGE"),
                "nohup" | "time" | "nice" => {}
                _ => break,
            }
            toks.remove(0);
            while toks.first().is_some_and(|t| t.starts_with('-')) {
                toks.remove(0);
            }
        }
        let Some(first) = toks.first() else { continue };
        let prog = canonical(first);
        if !seg.piped {
            downloaded = false;
        }

        // Program given as a path: a script/binary inside the workspace or outside it.
        if first.contains('/') || first.contains('\\') {
            match resolve(first, ws) {
                Some(abs) if abs.starts_with(&normalize(ws)) => {}
                _ => v.add("FS_OUTSIDE_WS"),
            }
        }

        // Exec sinks fed from a pipe.
        if p.exec_sinks.contains(&prog) {
            let reads_stdin = prog == "invoke-expression"
                || toks.len() == 1
                || toks.iter().skip(1).any(|t| matches!(t.as_str(), "-" | "-s" | "-Command" | "-command"));
            if seg.piped && reads_stdin {
                if downloaded {
                    v.add("NET_DOWNLOAD_EXEC");
                } else if decodes {
                    v.add("ENCODED_COMMAND");
                } else {
                    v.add("DYNAMIC_EXEC");
                }
            }
        }
        if prog == "invoke-expression" && any_downloader {
            v.add("NET_DOWNLOAD_EXEC");
        }
        if (prog == "powershell" || prog == "pwsh") && has_flag(&toks, &p.encoded_flags) {
            v.add("ENCODED_COMMAND");
        }

        // Version queries are always harmless.
        if toks.len() == 2
            && matches!(toks[1].to_ascii_lowercase().as_str(), "--version" | "-v" | "-version" | "version" | "-V")
        {
            v.add("VERSION");
            continue;
        }

        // git: look through global options so `git -C dir push` is matched like `git push`.
        let (rule_toks, git_cwd) = if prog == "git" {
            let (g, d) = git_globals(&toks, ws, v);
            (g, Some(d))
        } else {
            (toks.clone(), None)
        };
        let rule = p.commands.iter().find(|r| rule_matches(r, &prog, &rule_toks));
        let code = match rule {
            _ if prog == "gh" && rule_toks.get(1).is_some_and(|t| t.eq_ignore_ascii_case("api")) => {
                gh_api_code(&rule_toks).to_string()
            }
            Some(r) => r.code.clone(),
            None if p.interpreters.contains(&prog) => {
                if has_flag(&toks, &p.inline_flags) || toks.len() == 1 {
                    "INLINE_CODE".to_string()
                } else {
                    "RUN_SCRIPT".to_string()
                }
            }
            None if matches!(prog.as_str(), "cd" | "set-location" | "sl" | "pushd" | "popd" | "push-location" | "pop-location") => {
                "READ_CMD".to_string()
            }
            None if first.contains('/') || first.contains('\\') => "RUN_SCRIPT".to_string(),
            None => "UNKNOWN_COMMAND".to_string(),
        };
        if matches!(code.as_str(), "NET_ACCESS" | "GIT_NETWORK" | "PKG_INSTALL" | "PKG_EXEC" | "PKG_PUBLISH") {
            has_network = true;
        }
        if p.downloaders.contains(&prog) {
            downloaded = true;
        }
        v.add(&code);
        if let Some(dir) = &git_cwd {
            git_guard(&rule_toks, dir, v);
        }
        if code == "NET_ACCESS" {
            let hosts = url_hosts(&toks);
            if hosts.is_empty() {
                v.net_unknown = true;
            }
            for h in hosts {
                if !v.net_hosts.contains(&h) {
                    v.net_hosts.push(h);
                }
            }
        }

        // Paths named in the arguments.
        let how = if is_delete(&prog) || code == "FS_DELETE" {
            PathUse::Delete { recursive: is_recursive(&toks) }
        } else if code == "WRITE_WS" {
            PathUse::Write
        } else {
            PathUse::Read
        };
        let mut delete_targets = 0;
        for t in toks.iter().skip(1) {
            let val = t.split_once('=').map(|(_, r)| r).unwrap_or(t);
            if (val.starts_with('-') && !val.contains('/') && !val.contains('\\')) || is_cmd_switch(val) {
                continue;
            }
            if looks_like_path(val) {
                delete_targets += 1;
                check_path(val, ws, how, v);
            } else if matches!(how, PathUse::Delete { .. }) && !val.starts_with('-') {
                delete_targets += 1;
                if val.starts_with('$') {
                    v.add("UNPARSED");
                }
            }
        }
        if matches!(how, PathUse::Delete { .. }) && delete_targets == 0 && prog != "git" {
            v.add("UNPARSED");
        }
    }

    for target in &parsed.redirects {
        check_path(target, ws, PathUse::Write, v);
        v.add("WRITE_WS");
    }

    // Secrets sent over the network.
    if has_network && v.codes.iter().any(|c| c == "SECRET_READ") {
        let uploads = parsed.segments.iter().any(|s| has_flag(&s.tokens, &p.upload_flags))
            || parsed.segments.iter().any(|s| s.tokens.iter().any(|t| t.starts_with('@')));
        if uploads || parsed.segments.iter().any(|s| s.piped) {
            v.add("SECRET_EXFIL");
        }
    }
}

#[cfg(test)]
mod tests;
