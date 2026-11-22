// Risk Engine: classifies a tool call into a tier with reason codes.
// Port of crates/runtime/src/risk/mod.rs (spec docs/security/permissions.md, codes in
// docs/security/risk-catalog.md). Rules only ever raise a tier; anything unknown is at least `ask`.
// Pure apart from reading `.git` files to tell whether a push lands on the default branch.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse, programName } from "./command.js";
import { policy, TIER_ORDER, tierOf, type CommandRule, type Tier } from "./policy.js";

export interface RiskCtx {
  workspace: string;
  /** This turn already ingested external content (MCP / network output). */
  tainted: boolean;
  /** For `mcp__*` calls: the server marked the tool `readOnlyHint`. */
  mcpReadOnly: boolean;
}

const higher = (a: Tier, b: Tier) => TIER_ORDER[a] > TIER_ORDER[b];

export class Verdict {
  tier: Tier = "auto";
  /** Reason codes, highest tier first. Never empty after `finish`. */
  codes: string[] = [];
  /** Hosts named by URL in network commands, lowercase. */
  netHosts: string[] = [];
  /** A network command whose target could not be read from its arguments. */
  netUnknown = false;

  add(code: string): void {
    const t = tierOf(code);
    if (higher(t, this.tier)) this.tier = t;
    if (!this.codes.includes(code)) this.codes.push(code);
  }

  finish(): this {
    this.codes.sort((a, b) => TIER_ORDER[tierOf(b)] - TIER_ORDER[tierOf(a)] || (a < b ? -1 : a > b ? 1 : 0));
    if (this.codes.length === 0) this.add("UNKNOWN_TOOL");
    return this;
  }

  /** Code that decides the tier (first, highest). */
  primary(): string {
    return this.codes[0] ?? "UNKNOWN_TOOL";
  }

  /** A remembered allowlist entry may not cover this call (always re-ask). */
  neverRemember(): boolean {
    return this.tier === "block" || this.codes.some((c) => policy().never_remember.includes(c));
  }

  /** The call may never be run anyway, not even after an escalation card. */
  neverEscalate(): boolean {
    return this.codes.some((c) => policy().never_escalate.includes(c));
  }

  /** Running this feeds outside content to the model (MCP output, fetched URLs). */
  bringsExternalContent(): boolean {
    return this.codes.some((c) => policy().taint_codes.includes(c));
  }

  /** Codes at the decisive tier and above: what the user needs to read. */
  shownCodes(): string[] {
    const floor = higher(this.tier, "ask") ? this.tier : "ask";
    const top = this.codes.filter((c) => TIER_ORDER[tierOf(c)] >= TIER_ORDER[floor] && policy().codes[c]);
    return top.length ? top : this.codes.slice(0, 1);
  }

  /** Message the model sees when the call is blocked (English hint, fixed text). */
  blockMessage(): string {
    const code = this.primary();
    const hint = policy().codes[code]?.hint ?? "";
    return `blocked by policy (${code}): ${hint} Do not retry this command; tell the user what you wanted to do.`;
  }

  /** Short Vietnamese title of the decisive reason. */
  title(): string {
    return policy().codes[this.primary()]?.title ?? "";
  }

  /** Shape the permission card uses (`PermissionRisk` in the protocol). */
  toRisk(pattern?: string): { tier: Tier; reasons: Array<{ code: string; title: string; detail: string }>; pattern?: string } {
    return {
      tier: this.tier,
      reasons: this.shownCodes().map((c) => ({ code: c, title: policy().codes[c]?.title ?? "", detail: policy().codes[c]?.detail ?? "" })),
      ...(pattern ? { pattern } : {}),
    };
  }
}

/** Classify one tool call (neutral tool names, see docs/adapters/claude-sdk.md). */
export function classify(tool: string, args: Record<string, unknown>, ctx: RiskCtx): Verdict {
  const v = new Verdict();
  const str = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  switch (tool) {
    case "shell":
    case "proc_start":
      classifyCommand(str("command"), ctx.workspace, v);
      if (ctx.tainted && TIER_ORDER[v.tier] < TIER_ORDER.ask) v.add("TAINTED_CONTEXT");
      break;
    case "read":
    case "outline":
    case "glob":
    case "grep":
    case "view_image":
    case "git_status":
    case "git_diff":
    case "skill":
      v.add("READ_WS");
      for (const p of argPaths(args)) checkPath(p, ctx.workspace, "read", v);
      break;
    case "write":
    case "edit":
      v.add("WRITE_WS");
      for (const p of argPaths(args)) checkPath(p, ctx.workspace, "write", v);
      break;
    case "http_check":
      v.add(isLocalUrl(str("url")) ? "LOCAL_HTTP" : "HTTP_NOT_LOCAL");
      break;
    case "browser_open":
      v.add(isLocalUrl(str("url")) ? "LOCAL_BROWSER" : "BROWSER_NOT_LOCAL");
      break;
    case "browser_act":
      v.add("LOCAL_BROWSER");
      break;
    case "browser_snapshot":
    case "browser_console":
    case "browser_network":
    case "browser_close":
    case "browser_screenshot":
    case "browser_export_test":
    case "submit_plan":
    case "suggest_mode":
    case "task":
    case "update_todos":
    case "proc_logs":
    case "proc_list":
    case "proc_stop":
      v.add("INTERNAL");
      break;
    default:
      if (tool.startsWith("mcp__")) v.add(ctx.mcpReadOnly ? "MCP_READ" : "MCP_CALL");
      else v.add("UNKNOWN_TOOL");
  }
  return v.finish();
}

/** `http(s)://localhost|127.0.0.1|[::1][:port]/…` only (same rule as the Engine's `local_url`). */
export function isLocalUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  return ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname.toLowerCase());
}

function argPaths(args: Record<string, unknown>): string[] {
  return ["path", "file", "target"]
    .map((k) => args[k])
    .filter((s): s is string => typeof s === "string" && s.trim() !== "");
}

type PathUse = "read" | "write" | { delete: { recursive: boolean } };

function checkPath(raw: string, ws: string, how: PathUse, v: Verdict): void {
  const p = policy();
  const p0 = raw.replace(/^["']+|["']+$/g, "").replace(/^@+/, "");
  const norm = p0.replace(/\\/g, "/").toLowerCase();
  // Per-project permission rules live in ~/.silence/projects/<repo>/permissions.yaml (TS core).
  const projectRules = norm.includes(".silence/projects/") && norm.endsWith("/permissions.yaml");
  if (how !== "read" && (projectRules || p.policy_files.some((f) => norm.endsWith(f)))) {
    v.add("POLICY_TAMPER");
    return;
  }
  if (isSecret(p0)) v.add("SECRET_READ");
  const abs = resolvePath(p0, ws);
  const root = normalize(ws);
  if (abs !== null && withinDir(abs, root)) {
    if (typeof how === "object" && how.delete.recursive && abs === root) v.add("FS_DELETE");
  } else if (typeof how === "object" && how.delete.recursive) v.add("FS_DELETE_SYSTEM");
  else v.add("FS_OUTSIDE_WS");
}

/** Lexically resolve a command-line path against the workspace. `null` = unknowable (home, env vars). */
export function resolvePath(p: string, ws: string): string | null {
  const lower = p.toLowerCase();
  if (p.startsWith("~") || lower.startsWith("$home") || lower.startsWith("$env:") || lower.startsWith("${env:") || lower.startsWith("%") || lower.startsWith("\\\\")) {
    return null;
  }
  let s = p.replace(/\\/g, "/");
  // MSYS style `/d/vuhieu` → `d:/vuhieu`.
  const m = /^\/([a-zA-Z])(\/|$)/.exec(s);
  if (m) s = `${m[1]}:${s.slice(2)}`;
  const absolute = s.startsWith("/") || /^[a-zA-Z]:/.test(s);
  return normalize(absolute ? s : `${ws.replace(/\\/g, "/")}/${s}`);
}

/** Lowercased, forward-slash, `.`/`..` folded. Case-insensitive like Windows paths. */
export function normalize(p: string): string {
  let s = p.replace(/\\/g, "/").toLowerCase();
  let prefix = "";
  const drive = /^[a-z]:/.exec(s);
  if (drive) {
    prefix = drive[0];
    s = s.slice(2);
  }
  if (s.startsWith("/")) prefix += "/";
  const out: string[] = [];
  for (const seg of s.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return `${prefix}${out.join("/")}`.replace(/\/\//g, "/");
}

/** Component-wise prefix test (`c:/ws2` is not inside `c:/ws`). */
function withinDir(abs: string, root: string): boolean {
  if (abs === root) return true;
  return abs.startsWith(root.endsWith("/") ? root : `${root}/`);
}

function isSecret(p: string): boolean {
  const norm = p.replace(/\\/g, "/").toLowerCase();
  return norm
    .split("/")
    .filter((s) => s !== "")
    .some((seg) => policy().secret_patterns.some((pat) => wild(pat, seg)));
}

/** `*` wildcard on one path segment. */
function wild(pat: string, s: string): boolean {
  const i = pat.indexOf("*");
  if (i === -1) return pat === s;
  const pre = pat.slice(0, i);
  const post = pat.slice(i + 1);
  return s.length >= pre.length + post.length && s.startsWith(pre) && s.endsWith(post);
}

/** cmd.exe-style switch: `/s`, `/q`, `/F`, `/IM`, `/w:C`. */
function isCmdSwitch(t: string): boolean {
  if (!t.startsWith("/")) return false;
  const rest = t.slice(1);
  const name = rest.split(":")[0] ?? "";
  return name.length >= 1 && name.length <= 3 && /^[A-Za-z?]+$/.test(name) && !rest.includes("/");
}

function looksLikePath(t0: string): boolean {
  if (t0.includes("://") || t0 === "" || isCmdSwitch(t0)) return false;
  const t = t0.replace(/^@+/, "");
  const l = t.toLowerCase();
  return (
    t.includes("/") ||
    t.includes("\\") ||
    t.startsWith("~") ||
    t.startsWith(".") ||
    l.startsWith("$home") ||
    l.startsWith("$env:") ||
    t.startsWith("%") ||
    /^[A-Za-z]:/.test(t) ||
    isSecret(t)
  );
}

function hasFlag(tokens: string[], flags: string[]): boolean {
  return tokens.slice(1).some((t0) => {
    const t = t0.toLowerCase();
    return flags.some((f) => t === f || ((f.endsWith(":") || f.startsWith("/")) && t.startsWith(f)));
  });
}

function canonical(tok: string): string {
  const name = programName(tok);
  return policy().aliases[name] ?? name;
}

/** Rule words after the program match the segment, skipping options unless the rule word is one. */
function ruleMatches(rule: CommandRule, prog: string, tokens: string[]): boolean {
  if (rule.match[0] !== prog) return false;
  const it = tokens.slice(1).map((t) => t.toLowerCase());
  let k = 0;
  for (const w of rule.match.slice(1)) {
    for (;;) {
      const t = it[k++];
      if (t === undefined) return false;
      if (t === w) break;
      if (t.startsWith("-") && !w.startsWith("-")) continue;
      return false;
    }
  }
  return !rule.flags_any?.length || hasFlag(tokens, rule.flags_any);
}

const isDelete = (prog: string) => prog === "remove-item" || prog === "clear-content";

function isRecursive(tokens: string[]): boolean {
  return tokens.slice(1).some((t) => {
    const l = t.toLowerCase();
    return l === "/s" || l.startsWith("-r") || (l.startsWith("-") && !l.startsWith("--") && l.includes("r") && l.length <= 4) || l === "--recursive";
  });
}

/** Hosts of the `scheme://host[:port]/…` tokens of a command (lowercase, userinfo stripped). */
export function urlHosts(tokens: string[]): string[] {
  const out: string[] = [];
  for (const raw of tokens.slice(1)) {
    let t = raw.replace(/^["'(),;]+|["'(),;]+$/g, "");
    const eq = t.indexOf("=");
    if (eq !== -1 && !t.slice(0, eq).includes("://")) t = t.slice(eq + 1);
    const sep = t.indexOf("://");
    if (sep === -1) continue;
    const rest = t.slice(sep + 3);
    let auth = rest.split(/[/?#]/)[0] ?? "";
    const at = auth.lastIndexOf("@");
    if (at !== -1) auth = auth.slice(at + 1);
    let host = auth.startsWith("[") ? (auth.slice(1).split("]")[0] ?? "") : (auth.split(":")[0] ?? "");
    host = host.replace(/\.+$/, "").toLowerCase();
    if (host && !/[$%`{]/.test(host) && !out.includes(host)) out.push(host);
  }
  return out;
}

const isHooksKey = (s: string) => s.toLowerCase().includes("core.hookspath");

/** `git` global options before the subcommand: returns `[git, sub, args…]` and the directory it runs in. */
function gitGlobals(toks: string[], ws: string, v: Verdict): [string[], string] {
  let dir = ws;
  let i = 1;
  while (i < toks.length) {
    const t = toks[i]!;
    if (!t.startsWith("-")) break;
    const l = t.toLowerCase();
    if (t === "-C") {
      const d = toks[i + 1];
      if (d !== undefined) dir = path.isAbsolute(d) ? d : path.join(dir, d);
      i += 2;
    } else if (t === "-c" || t === "--config-env") {
      const kv = toks[i + 1];
      if (kv !== undefined && isHooksKey(kv)) v.add("GIT_NO_VERIFY");
      i += 2;
    } else if (["--git-dir", "--work-tree", "--namespace", "--super-prefix"].includes(t)) i += 2;
    else {
      if (l.startsWith("--config-env=") && isHooksKey(l)) v.add("GIT_NO_VERIFY");
      i += 1;
    }
  }
  return [[toks[0]!, ...toks.slice(i)], dir];
}

/** Pushes that land on the default branch (GIT_PUSH_DEFAULT) and hook bypass (GIT_NO_VERIFY). */
function gitGuard(g: string[], dir: string, v: Verdict): void {
  const sub = g[1]?.toLowerCase();
  if (sub === undefined) return;
  const args = g.slice(2);
  if (args.some((a) => a.toLowerCase() === "--no-verify")) v.add("GIT_NO_VERIFY");
  if (sub === "commit") {
    const takesValue = ["-m", "-F", "-C", "-c", "-t"];
    const shortN = args.some((a, i) => {
      const prevIsFlagValue = i > 0 && takesValue.includes(args[i - 1]!);
      return !prevIsFlagValue && a.length >= 2 && a.startsWith("-") && !a.startsWith("--") && /^[A-Za-z]+$/.test(a.slice(1)) && a.slice(1).includes("n");
    });
    if (shortN) v.add("GIT_NO_VERIFY");
  } else if (sub === "config") {
    const reads = args.some((a) => ["--get", "--get-all", "--get-regexp", "--list", "-l"].includes(a.toLowerCase()));
    if (!reads && args.some(isHooksKey)) v.add("GIT_NO_VERIFY");
  } else if (sub === "push") {
    if (pushesDefaultBranch(args, dir)) v.add("GIT_PUSH_DEFAULT");
  }
}

function pushesDefaultBranch(args: string[], dir: string): boolean {
  const positional: string[] = [];
  let all = false;
  let tagsOnly = false;
  let hasRepo = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    const l = a.toLowerCase();
    if (l === "--all" || l === "--branches" || l === "--mirror") all = true;
    else if (l === "--tags") tagsOnly = true;
    else if (l === "--repo") {
      hasRepo = true;
      i++;
    } else if (["-o", "--push-option", "--receive-pack", "--exec"].includes(l)) i++;
    else if (l.startsWith("--repo=")) hasRepo = true;
    else if (a.startsWith("-")) {
      /* other flag */
    } else positional.push(a);
  }
  if (all) return true;
  const gitdir = gitDirOf(dir);
  const current = gitdir ? headBranch(gitdir) : null;
  const refspecs = hasRepo ? positional : positional.slice(1);
  const targets: string[] = [];
  if (refspecs.length === 0 && !tagsOnly && current) targets.push(current);
  for (const s0 of refspecs) {
    const spec = s0.replace(/^\++/, "");
    const c = spec.indexOf(":");
    let dst = c === -1 ? spec : spec.slice(c + 1);
    if (dst.startsWith("refs/heads/")) dst = dst.slice("refs/heads/".length);
    if (dst === "HEAD" || dst === "@") {
      if (current) targets.push(current);
    } else if (dst) targets.push(dst);
  }
  const prot = defaultBranches(gitdir);
  return targets.some((t) => prot.some((p) => p.toLowerCase() === t.toLowerCase()));
}

const isDir = (p: string) => existsSync(p) && statSync(p).isDirectory();
const isFile = (p: string) => existsSync(p) && statSync(p).isFile();

/** `.git` directory for `start` or its nearest ancestor (follows the `gitdir:` file of a worktree). */
function gitDirOf(start: string): string | null {
  let d: string | null = start;
  while (d) {
    const g = path.join(d, ".git");
    if (isDir(g)) return g;
    if (isFile(g)) {
      const text = readFileSync(g, "utf8").trim();
      if (!text.startsWith("gitdir:")) return null;
      const p = text.slice("gitdir:".length).trim();
      return path.isAbsolute(p) ? p : path.join(d, p);
    }
    const parent = path.dirname(d);
    d = parent === d ? null : parent;
  }
  return null;
}

function headBranch(gitdir: string): string | null {
  try {
    const head = readFileSync(path.join(gitdir, "HEAD"), "utf8").trim();
    return head.startsWith("ref: refs/heads/") ? head.slice("ref: refs/heads/".length) : null;
  } catch {
    return null;
  }
}

function defaultBranches(gitdir: string | null): string[] {
  const out = ["main", "master"];
  if (!gitdir) return out;
  let common = gitdir;
  try {
    common = path.join(gitdir, readFileSync(path.join(gitdir, "commondir"), "utf8").trim());
  } catch {
    /* not a worktree */
  }
  try {
    const text = readFileSync(path.join(common, "refs/remotes/origin/HEAD"), "utf8").trim();
    if (text.startsWith("ref: refs/remotes/origin/")) out.push(text.slice("ref: refs/remotes/origin/".length));
  } catch {
    /* no origin/HEAD */
  }
  return out;
}

/** `gh api`: GET without fields reads; a method or fields write; `…/merge` or `mergePullRequest` merges. */
function ghApiCode(t: string[]): string {
  let method: string | null = null;
  const fields: string[] = [];
  let apiPath: string | null = null;
  for (let i = 2; i < t.length; i++) {
    const a = t[i]!;
    const l = a.toLowerCase();
    const next = t[i + 1];
    if (l === "-x" || l === "--method") {
      method = next?.toUpperCase() ?? null;
      i++;
    } else if (["-f", "--field", "--raw-field", "--input"].includes(l)) {
      fields.push(next ?? "");
      i++;
    } else if (["-h", "--header", "-q", "--jq", "-t", "--template", "--hostname", "--cache", "-p", "--preview"].includes(l)) i++;
    else if (l.startsWith("--method=")) method = l.slice("--method=".length).toUpperCase();
    else if (l.startsWith("-x") && l.length > 2 && !l.startsWith("--")) method = l.slice(2).toUpperCase();
    else if (l.startsWith("--field=") || l.startsWith("--raw-field=") || l.startsWith("--input=")) fields.push(a.slice(a.indexOf("=") + 1));
    else if (a.startsWith("-")) {
      /* other flag */
    } else if (apiPath === null) apiPath = a;
  }
  const p = (apiPath ?? "").toLowerCase();
  const body = fields.join(" ").toLowerCase();
  if (p === "graphql") {
    if (body.includes("mergepullrequest")) return "GH_MERGE";
    if (body.includes("mutation") || body.includes("query=@")) return "GH_WRITE";
    return "GH_READ";
  }
  const writes = method !== null ? method !== "GET" && method !== "HEAD" : fields.length > 0;
  if (!writes) return "GH_READ";
  return p.replace(/\/+$/, "").endsWith("/merge") ? "GH_MERGE" : "GH_WRITE";
}

const NETWORK_CODES = ["NET_ACCESS", "GIT_NETWORK", "PKG_INSTALL", "PKG_EXEC", "PKG_PUBLISH"];
const NAV = ["cd", "set-location", "sl", "pushd", "popd", "push-location", "pop-location"];

/** Classify a shell command line into `v`. */
export function classifyCommand(cmd: string, ws: string, v: Verdict): void {
  const p = policy();
  const parsed = parse(cmd);
  if (parsed.segments.length === 0) {
    v.add("UNPARSED");
    return;
  }
  if (parsed.dynamic) v.add("UNPARSED");
  const lower = cmd.toLowerCase();
  let downloaded = false;
  const anyDownloader =
    parsed.segments.some((s) => s.tokens[0] !== undefined && p.downloaders.includes(canonical(s.tokens[0]))) ||
    lower.includes("downloadstring") ||
    lower.includes("downloadfile") ||
    lower.includes("net.webclient");
  const decodes = lower.includes("frombase64string") || lower.includes("base64 -d") || lower.includes("base64 --decode") || lower.includes("certutil -decode");
  let hasNetwork = false;
  const root = normalize(ws);

  for (const seg of parsed.segments) {
    // Skip POSIX `VAR=value cmd` assignments.
    let k = 0;
    while (k < seg.tokens.length && seg.tokens[k]!.includes("=") && !seg.tokens[k]!.startsWith("-") && !seg.tokens[k]!.includes("/")) k++;
    let toks = seg.tokens.slice(k);
    // Look through wrappers: `sudo`/`doas` elevate (block) and still run the inner command.
    for (;;) {
      const w = toks[0] !== undefined ? canonical(toks[0]) : undefined;
      if (w === "sudo" || w === "doas") v.add("SYSTEM_CHANGE");
      else if (w !== "nohup" && w !== "time" && w !== "nice") break;
      toks = toks.slice(1);
      while (toks[0]?.startsWith("-")) toks = toks.slice(1);
    }
    const first = toks[0];
    if (first === undefined) continue;
    const prog = canonical(first);
    if (!seg.piped) downloaded = false;

    // Program given as a path: a script/binary inside the workspace or outside it.
    if (first.includes("/") || first.includes("\\")) {
      const abs = resolvePath(first, ws);
      if (!(abs !== null && withinDir(abs, root))) v.add("FS_OUTSIDE_WS");
    }

    // Exec sinks fed from a pipe.
    if (p.exec_sinks.includes(prog)) {
      const readsStdin = prog === "invoke-expression" || toks.length === 1 || toks.slice(1).some((t) => ["-", "-s", "-Command", "-command"].includes(t));
      if (seg.piped && readsStdin) v.add(downloaded ? "NET_DOWNLOAD_EXEC" : decodes ? "ENCODED_COMMAND" : "DYNAMIC_EXEC");
    }
    if (prog === "invoke-expression" && anyDownloader) v.add("NET_DOWNLOAD_EXEC");
    if ((prog === "powershell" || prog === "pwsh") && hasFlag(toks, p.encoded_flags)) v.add("ENCODED_COMMAND");

    // Version queries are always harmless.
    if (toks.length === 2 && (["--version", "-v", "-version", "version"].includes(toks[1]!.toLowerCase()) || toks[1] === "-V")) {
      v.add("VERSION");
      continue;
    }

    let ruleToks = toks;
    let gitCwd: string | null = null;
    if (prog === "git") [ruleToks, gitCwd] = gitGlobals(toks, ws, v);
    const rule = p.commands.find((r) => ruleMatches(r, prog, ruleToks));
    let code: string;
    if (prog === "gh" && ruleToks[1]?.toLowerCase() === "api") code = ghApiCode(ruleToks);
    else if (rule) code = rule.code;
    else if (p.interpreters.includes(prog)) code = hasFlag(toks, p.inline_flags) || toks.length === 1 ? "INLINE_CODE" : "RUN_SCRIPT";
    else if (NAV.includes(prog)) code = "READ_CMD";
    else if (first.includes("/") || first.includes("\\")) code = "RUN_SCRIPT";
    else code = "UNKNOWN_COMMAND";

    if (NETWORK_CODES.includes(code)) hasNetwork = true;
    if (p.downloaders.includes(prog)) downloaded = true;
    v.add(code);
    if (gitCwd !== null) gitGuard(ruleToks, gitCwd, v);
    if (code === "NET_ACCESS") {
      const hosts = urlHosts(toks);
      if (hosts.length === 0) v.netUnknown = true;
      for (const h of hosts) if (!v.netHosts.includes(h)) v.netHosts.push(h);
    }

    // Paths named in the arguments.
    const how: PathUse = isDelete(prog) || code === "FS_DELETE" ? { delete: { recursive: isRecursive(toks) } } : code === "WRITE_WS" ? "write" : "read";
    let deleteTargets = 0;
    for (const t of toks.slice(1)) {
      const eq = t.indexOf("=");
      const val = eq === -1 ? t : t.slice(eq + 1);
      if ((val.startsWith("-") && !val.includes("/") && !val.includes("\\")) || isCmdSwitch(val)) continue;
      if (looksLikePath(val)) {
        deleteTargets++;
        checkPath(val, ws, how, v);
      } else if (typeof how === "object" && !val.startsWith("-")) {
        deleteTargets++;
        if (val.startsWith("$")) v.add("UNPARSED");
      }
    }
    if (typeof how === "object" && deleteTargets === 0 && prog !== "git") v.add("UNPARSED");
  }

  for (const target of parsed.redirects) {
    checkPath(target, ws, "write", v);
    v.add("WRITE_WS");
  }

  // Secrets sent over the network.
  if (hasNetwork && v.codes.includes("SECRET_READ")) {
    const uploads = parsed.segments.some((s) => hasFlag(s.tokens, p.upload_flags)) || parsed.segments.some((s) => s.tokens.some((t) => t.startsWith("@")));
    if (uploads || parsed.segments.some((s) => s.piped)) v.add("SECRET_EXFIL");
  }
}

/** Words of a single plain shell command used for "remember"; null for pipelines, chains, redirects, dynamic syntax. */
function shellWords(cmd: string): string[] | null {
  const parsed = parse(cmd);
  if (parsed.dynamic || parsed.redirects.length || parsed.segments.length !== 1) return null;
  const toks = parsed.segments[0]!.tokens;
  const first = toks[0];
  if (first === undefined || first.includes("=")) return null;
  const prog = canonical(first);
  if (["sudo", "doas", "nohup", "time", "nice"].includes(prog)) return null;
  const words = [prog];
  if (policy().subcommand_programs.includes(prog)) {
    const sub = toks.slice(1).find((t) => !t.startsWith("-"));
    if (sub !== undefined) words.push(sub.toLowerCase());
  }
  return words;
}

/** Pattern stored when the user remembers a shell approval: `npm install *`. */
export function shellPattern(cmd: string): string | null {
  const w = shellWords(cmd);
  return w ? `${w.join(" ")} *` : null;
}

/** Does a remembered shell pattern (`npm install *`) cover this command? */
export function shellMatches(pattern: string, cmd: string): boolean {
  const want = pattern.replace(/\*+$/, "").trim().split(/\s+/).filter(Boolean);
  const words = shellWords(cmd);
  return !!words && want.length > 0 && words.length === want.length && words.every((w, i) => w === want[i]);
}
