// Repo config review (roadmap 1.6, docs/adapters/claude-sdk.md "Duyệt cấu hình repo").
// A repo's `.claude/settings.json` hooks, `.mcp.json` servers, auth helpers and shell-running slash
// commands start processes OUTSIDE tool calls, so the PreToolUse gate never sees them, and headless
// Claude Code trusts the folder without asking. Before a session loads project settings, the core
// lists those items and asks the user once per content hash.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { appendJsonl, readJsonl } from "../store/jsonl.js";

export type RepoItemKind = "hook" | "mcp" | "env" | "helper" | "plugin" | "command" | "invalid";

export interface RepoItem {
  kind: RepoItemKind;
  /** File relative to the workspace, `/` separators. */
  file: string;
  /** Short label: hook event, server name, setting key, command name. */
  name: string;
  /** What would run (command line, URL, value), cut to a readable length. */
  detail: string;
}

export interface RepoReview {
  workspace: string;
  /** sha256 of the items; empty string when there is nothing to review. */
  hash: string;
  items: RepoItem[];
}

/** Settings keys that run a program, change credentials/env, or pull in code (plugins, MCP). */
const RISKY_SETTINGS: Record<string, RepoItemKind> = {
  env: "env",
  apiKeyHelper: "helper",
  awsAuthRefresh: "helper",
  awsCredentialExport: "helper",
  otelHeadersHelper: "helper",
  statusLine: "helper",
  fileSuggestion: "helper",
  enabledPlugins: "plugin",
  extraKnownMarketplaces: "plugin",
  enableAllProjectMcpServers: "mcp",
  enabledMcpjsonServers: "mcp",
  mcpServers: "mcp",
};

const MAX_DETAIL = 300;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_MD_FILES = 500;
/** `!`cmd`` in a slash command or skill runs a shell command when it is expanded. */
const BANG_SHELL = /!`([^`\n]+)`/g;

const cut = (s: string) => (s.length > MAX_DETAIL ? `${s.slice(0, MAX_DETAIL)}…` : s);
const show = (v: unknown) => cut(typeof v === "string" ? v : JSON.stringify(v));

async function readText(file: string): Promise<string | null> {
  try {
    const t = await readFile(file, "utf8");
    return t.length > MAX_FILE_BYTES ? t.slice(0, MAX_FILE_BYTES) : t;
  } catch {
    return null;
  }
}

function parse(text: string): { ok: true; value: Record<string, unknown> } | { ok: false } {
  try {
    const v = JSON.parse(text.replace(/^﻿/, ""));
    return typeof v === "object" && v !== null && !Array.isArray(v) ? { ok: true, value: v as Record<string, unknown> } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function hookItems(file: string, hooks: unknown): RepoItem[] {
  const out: RepoItem[] = [];
  if (typeof hooks !== "object" || hooks === null) return [{ kind: "hook", file, name: "hooks", detail: show(hooks) }];
  for (const [event, matchers] of Object.entries(hooks as Record<string, unknown>)) {
    const list = Array.isArray(matchers) ? matchers : [matchers];
    for (const m of list as Array<Record<string, unknown>>) {
      const inner = Array.isArray(m?.hooks) ? (m.hooks as Array<Record<string, unknown>>) : [m];
      for (const h of inner) {
        const what = typeof h?.command === "string" ? h.command : typeof h?.url === "string" ? h.url : typeof h?.prompt === "string" ? `prompt: ${h.prompt}` : h;
        const matcher = typeof m?.matcher === "string" && m.matcher ? ` (${m.matcher})` : "";
        out.push({ kind: "hook", file, name: `${event}${matcher}`, detail: show(what) });
      }
    }
  }
  return out;
}

function settingsItems(file: string, text: string): RepoItem[] {
  const p = parse(text);
  if (!p.ok) return [{ kind: "invalid", file, name: "JSON", detail: "file is not valid JSON; Claude Code may still read parts of it" }];
  const out: RepoItem[] = [];
  for (const [key, value] of Object.entries(p.value)) {
    if (key === "hooks") out.push(...hookItems(file, value));
    else if (key in RISKY_SETTINGS) {
      if (key === "env" && typeof value === "object" && value !== null) {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) out.push({ kind: "env", file, name: k, detail: show(v) });
      } else out.push({ kind: RISKY_SETTINGS[key]!, file, name: key, detail: show(value) });
    }
  }
  return out;
}

function mcpItems(file: string, text: string): RepoItem[] {
  const p = parse(text);
  if (!p.ok) return [{ kind: "invalid", file, name: "JSON", detail: "file is not valid JSON" }];
  const servers = p.value.mcpServers;
  if (typeof servers !== "object" || servers === null) return [];
  return Object.entries(servers as Record<string, Record<string, unknown>>).map(([name, s]) => {
    const cmd = typeof s?.command === "string" ? [s.command, ...(Array.isArray(s.args) ? s.args.map(String) : [])].join(" ") : typeof s?.url === "string" ? s.url : JSON.stringify(s);
    const env = s && typeof s.env === "object" && s.env ? ` env: ${Object.keys(s.env as object).join(", ")}` : "";
    return { kind: "mcp" as const, file, name, detail: cut(cmd + env) };
  });
}

async function markdownFiles(dir: string, out: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (out.length >= MAX_MD_FILES) break;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await markdownFiles(p, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(p);
  }
  return out;
}

async function shellCommandItems(ws: string, sub: string): Promise<RepoItem[]> {
  const out: RepoItem[] = [];
  for (const f of await markdownFiles(path.join(ws, ".claude", sub))) {
    const text = await readText(f);
    if (!text) continue;
    const rel = path.relative(ws, f).split(path.sep).join("/");
    for (const m of text.matchAll(BANG_SHELL)) out.push({ kind: "command", file: rel, name: path.basename(f, ".md"), detail: cut(m[1]!) });
  }
  return out;
}

/** Hash of the items: changes whenever anything that could run changes, not on harmless edits. */
export function hashItems(items: RepoItem[]): string {
  if (!items.length) return "";
  const canon = items.map((i) => [i.kind, i.file, i.name, i.detail]);
  return createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}

/** List what the project config would run. Read-only; never executes anything. */
export async function scanRepoConfig(workspace: string): Promise<RepoReview> {
  const ws = path.resolve(workspace);
  const items: RepoItem[] = [];
  const settings = await readText(path.join(ws, ".claude", "settings.json"));
  if (settings !== null) items.push(...settingsItems(".claude/settings.json", settings));
  const mcp = await readText(path.join(ws, ".mcp.json"));
  if (mcp !== null) items.push(...mcpItems(".mcp.json", mcp));
  items.push(...(await shellCommandItems(ws, "commands")), ...(await shellCommandItems(ws, "skills")));
  return { workspace: ws, hash: hashItems(items), items };
}

interface ApprovalRecord {
  ts: string;
  workspace: string;
  hash: string;
}

/** Approved hashes per workspace (`<dataDir>/repo-config-approvals.jsonl`, append-only). */
export class RepoApprovals {
  readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "repo-config-approvals.jsonl");
  }

  private static key(ws: string): string {
    const p = path.resolve(ws);
    return process.platform === "win32" ? p.toLowerCase() : p;
  }

  async isApproved(workspace: string, hash: string): Promise<boolean> {
    if (!hash) return true;
    const k = RepoApprovals.key(workspace);
    const all = await readJsonl<ApprovalRecord>(this.file);
    return all.some((r) => r.hash === hash && RepoApprovals.key(r.workspace) === k);
  }

  approve(workspace: string, hash: string): Promise<void> {
    return appendJsonl(this.file, { ts: new Date().toISOString(), workspace: path.resolve(workspace), hash });
  }
}
