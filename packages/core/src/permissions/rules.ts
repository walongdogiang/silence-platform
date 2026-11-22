// Permission rules allow / ask / deny (docs/security/permissions.md), Claude Code syntax:
//   Bash(npm test:*)  Bash(git status)  Edit(src/**)  Read(~/.ssh/**)  WebFetch(domain:example.com)
//   mcp__github  mcp__github__create_issue  Write
// Checked before the permission mode; deny wins over everything. Sources:
//   user     ~/.silence/permissions.yaml                    allow / ask / deny
//   project  ~/.silence/projects/<repo>/permissions.yaml     allow / ask / deny ("Always allow" writes here)
//   repo     <workspace>/.claude/settings.json permissions   ask / deny only: a repo may tighten, never loosen
import { readFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ToolCall } from "../backends/types.js";
import { parse as parseCommand } from "../risk/command.js";

export type RuleBehavior = "allow" | "ask" | "deny";
export type RuleSource = "user" | "project" | "repo";

export interface Rule {
  behavior: RuleBehavior;
  /** Tool name as Claude Code writes it: Bash, Edit, Write, Read, WebFetch, mcp__server__tool… */
  tool: string;
  /** Text inside the parentheses, if any. */
  specifier?: string;
  source: RuleSource;
  /** The rule as written, for display and audit. */
  text: string;
}

/** `Bash(npm test:*)` → tool + specifier; null when it is not a rule. */
export function parseRule(text: string, behavior: RuleBehavior, source: RuleSource): Rule | null {
  const t = text.trim();
  const m = /^([A-Za-z_][\w-]*)(?:\((.*)\))?$/s.exec(t);
  if (!m) return null;
  return { behavior, tool: m[1]!, ...(m[2] !== undefined && m[2] !== "" && m[2] !== "*" ? { specifier: m[2] } : {}), source, text: t };
}

/** Claude tools a rule name covers (Edit covers every file-editing tool, like Claude Code). */
const TOOL_FAMILY: Record<string, string[]> = {
  Bash: ["Bash", "PowerShell"],
  PowerShell: ["Bash", "PowerShell"],
  Edit: ["Edit", "MultiEdit", "Write", "NotebookEdit"],
  Write: ["Write"],
  MultiEdit: ["MultiEdit"],
  NotebookEdit: ["NotebookEdit"],
  Read: ["Read", "Glob", "Grep", "NotebookRead"],
};

function globToRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`, process.platform === "win32" ? "i" : "");
}

const slash = (p: string) => p.replace(/\\/g, "/");

/** Absolute, `/`-separated path pattern for a path specifier (relative = inside the workspace). */
function pathPattern(spec: string, ws: string): string {
  if (spec.startsWith("~/")) return slash(path.join(os.homedir(), spec.slice(2)));
  if (spec.startsWith("//")) return slash(spec.slice(1));
  if (/^[a-zA-Z]:[\\/]/.test(spec)) return slash(spec);
  return `${slash(path.resolve(ws)).replace(/\/$/, "")}/${slash(spec).replace(/^\.?\//, "")}`;
}

/** Does a shell command (one segment) match a Bash specifier? `npm test:*` = prefix, `*` = wildcard. */
export function shellMatches(spec: string, cmd: string): boolean {
  const c = cmd.trim().replace(/\s+/g, " ");
  if (spec.endsWith(":*")) {
    const prefix = spec.slice(0, -2).trim();
    return c === prefix || c.startsWith(`${prefix} `);
  }
  if (spec.includes("*")) {
    const re = new RegExp(`^${spec.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
    return re.test(c);
  }
  return c === spec.trim();
}

/** Segments of a shell command as plain text (`a && b | c` → `a`, `b`, `c`). */
export function shellSegments(cmd: string): string[] {
  const segs = parseCommand(cmd).segments.map((s) => s.tokens.join(" ").trim()).filter(Boolean);
  return segs.length ? segs : [cmd.trim()];
}

/**
 * Whether `rule` covers `call`. For shell commands, allow needs every segment to match (so
 * `Bash(npm test:*)` does not allow `npm test && curl x | sh`); ask and deny need any segment.
 */
export function ruleMatches(rule: Rule, call: ToolCall): boolean {
  const tool = call.raw.tool;
  if (rule.tool.startsWith("mcp__")) {
    if (!tool.startsWith("mcp__")) return false;
    if (rule.tool === tool) return true;
    const parts = rule.tool.split("__");
    return parts.length === 2 ? tool.startsWith(`${rule.tool}__`) : rule.tool.endsWith("__*") && tool.startsWith(rule.tool.slice(0, -1));
  }
  const family = TOOL_FAMILY[rule.tool] ?? [rule.tool];
  if (!family.includes(tool)) return false;
  const spec = rule.specifier;
  if (spec === undefined) return true;
  if (call.kind === "shell") {
    const cmd = typeof call.args.command === "string" ? call.args.command : "";
    const segs = shellSegments(cmd);
    // Allow: every segment must match on its own (a prefix match on the whole line would let
    // `npm test && curl x | sh` through). Ask / deny: any segment, or the whole line.
    if (rule.behavior === "allow") return segs.every((s) => shellMatches(spec, s));
    return shellMatches(spec, cmd) || segs.some((s) => shellMatches(spec, s));
  }
  if (tool === "WebFetch" || tool === "WebSearch") {
    const url = typeof call.args.url === "string" ? call.args.url : "";
    if (spec.startsWith("domain:")) {
      try {
        const host = new URL(url).hostname.toLowerCase();
        const d = spec.slice(7).toLowerCase();
        return host === d || host.endsWith(`.${d}`);
      } catch {
        return false;
      }
    }
    return shellMatches(spec, typeof call.args.query === "string" ? call.args.query : url);
  }
  const p = typeof call.args.path === "string" ? call.args.path : "";
  if (!p) return false;
  const abs = slash(path.resolve(call.cwd, p));
  return globToRegex(pathPattern(spec, call.cwd)).test(abs);
}

export interface RuleSet {
  rules: Rule[];
  /** Files that could not be read or parsed (shown as warnings, never silently loosened). */
  errors: string[];
}

/** First matching rule by precedence: deny, then ask, then allow. */
export function matchRules(set: RuleSet, call: ToolCall): Rule | null {
  for (const b of ["deny", "ask", "allow"] as const) {
    const hit = set.rules.find((r) => r.behavior === b && ruleMatches(r, call));
    if (hit) return hit;
  }
  return null;
}

interface RuleFile {
  allow?: unknown;
  ask?: unknown;
  deny?: unknown;
}

function collect(obj: RuleFile | undefined, source: RuleSource, behaviors: RuleBehavior[], out: Rule[], errors: string[], file: string): void {
  for (const b of behaviors) {
    const list = obj?.[b];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      errors.push(`${file}: \`${b}\` must be a list`);
      continue;
    }
    for (const t of list) {
      const r = typeof t === "string" ? parseRule(t, b, source) : null;
      if (r) out.push(r);
      else errors.push(`${file}: not a rule: ${JSON.stringify(t)}`);
    }
  }
}

async function readMaybe(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

export function userRulesFile(home: string): string {
  return path.join(home, "permissions.yaml");
}

export function projectRulesFile(home: string, project: string): string {
  return path.join(home, "projects", project, "permissions.yaml");
}

/** Load every rule that applies to a session in `workspace` of `project`. */
export async function loadRules(home: string, project: string, workspace: string): Promise<RuleSet> {
  const rules: Rule[] = [];
  const errors: string[] = [];
  for (const [file, source] of [
    [userRulesFile(home), "user"],
    [projectRulesFile(home, project), "project"],
  ] as const) {
    const text = await readMaybe(file);
    if (text === null) continue;
    try {
      collect((parseYaml(text) ?? {}) as RuleFile, source, ["allow", "ask", "deny"], rules, errors, file);
    } catch (e) {
      errors.push(`${file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const settings = path.join(workspace, ".claude", "settings.json");
  const text = await readMaybe(settings);
  if (text !== null) {
    try {
      const perms = (JSON.parse(text.replace(/^﻿/, "")) as { permissions?: RuleFile }).permissions;
      collect(perms, "repo", ["ask", "deny"], rules, errors, settings); // a repo's `allow` is ignored on purpose
    } catch {
      errors.push(`${settings}: not valid JSON; its ask/deny rules are not applied`);
    }
  }
  return { rules, errors };
}

/** Add a rule to a rules file (create it if needed); no-op when already present. */
export async function addRule(file: string, behavior: RuleBehavior, text: string): Promise<void> {
  const cur = await readMaybe(file);
  const doc = ((cur ? parseYaml(cur) : null) ?? {}) as Record<string, unknown>;
  const list = Array.isArray(doc[behavior]) ? (doc[behavior] as unknown[]) : [];
  if (list.includes(text)) return;
  doc[behavior] = [...list, text];
  await mkdir(path.dirname(file), { recursive: true });
  const header = cur ? "" : "# 5ilence permission rules (allow / ask / deny), Claude Code syntax. Edit freely.\n";
  await writeFile(file, header + stringifyYaml(doc), "utf8");
}

/**
 * The rule "Always allow" / "Deny always" would save for this call: `Bash(npm install:*)` from the
 * Risk Engine's shell pattern, `Edit(src/**)` for the file's folder, the tool for MCP/fetch.
 */
export function ruleFor(call: ToolCall, shellPattern: string | null): string | null {
  const tool = call.raw.tool;
  if (call.kind === "shell") return shellPattern ? `${tool}(${shellPattern.replace(/ \*$/, ":*")})` : null;
  if (call.kind === "write" || call.kind === "edit" || call.kind === "read" || call.kind === "search") {
    const p = typeof call.args.path === "string" ? call.args.path : "";
    if (!p) return null;
    const rel = slash(path.relative(call.cwd, path.resolve(call.cwd, p)));
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    const dir = path.posix.dirname(rel);
    const family = call.kind === "write" || call.kind === "edit" ? "Edit" : "Read";
    return `${family}(${dir === "." ? "**" : `${dir}/**`})`;
  }
  if (tool === "WebFetch") {
    try {
      return `WebFetch(domain:${new URL(String(call.args.url)).hostname})`;
    } catch {
      return null;
    }
  }
  if (tool.startsWith("mcp__")) return tool;
  return null;
}
