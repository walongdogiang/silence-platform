// Personal layer from `~/.silence` (private repo `silence-home`, ADR 0004 pillars 1 and 3): the profile,
// a per-project profile and the local plugin, read fresh for every backend session.
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** `SILENCE_HOME` or `~/.silence`. */
export function silenceHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.SILENCE_HOME || path.join(os.homedir(), ".silence");
}

/** Where the core keeps its own data (`events.jsonl`, `audit.jsonl`): `SILENCE_CORE_DATA` or `%LOCALAPPDATA%/silence/core`. */
export function coreDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SILENCE_CORE_DATA) return env.SILENCE_CORE_DATA;
  const base = env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share");
  return path.join(base, "silence", "core");
}

/** ADR 0004: the profile stays short. Longer still loads, with a warning. */
export const PROFILE_MAX_LINES = 60;
const MAX_PROFILE_BYTES = 64 * 1024;

/** Secrets never go into a system prompt. Stricter than log redaction: no false alarm on "bearer token". */
const SECRET_PATTERNS = [
  /(api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{16,}/i,
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\b(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text));
}

export interface ProfileFile {
  path: string;
  lines: number;
  /** Appended to the system prompt (false when missing, empty or refused). */
  loaded: boolean;
}

export interface PluginInfo {
  path: string;
  name?: string;
  skills: string[];
  loaded: boolean;
}

export interface Personal {
  home: string;
  /** Text appended to the backend's system prompt: profile, then the project profile. */
  systemAppend?: string;
  profile: ProfileFile | null;
  /** `~/.silence/projects/<repo>/profile.md` for the session's repo. */
  project: (ProfileFile & { name: string }) | null;
  plugin: PluginInfo | null;
  /** Local plugin directories passed to the backend. */
  plugins: string[];
  /** Vietnamese, for the user (UI / trace). */
  warnings: string[];
}

function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 10_000, windowsHide: true }, (err, out) => resolve(err ? null : out.trim()));
  });
}

/**
 * Name of the project under `~/.silence/projects/`: the main checkout's folder name, so every git
 * worktree of a repo shares one profile. Outside git, the workspace folder name.
 */
export async function projectName(workspace: string): Promise<string> {
  const common = await git(workspace, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common) {
    const dir = path.basename(common) === ".git" ? path.dirname(common) : common.replace(/\.git$/, "");
    const name = path.basename(dir);
    if (name) return name;
  }
  return path.basename(path.resolve(workspace));
}

async function readProfile(file: string, label: string, warnings: string[]): Promise<{ info: ProfileFile; text?: string } | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return null;
  }
  text = text.replace(/^﻿/, "");
  if (text.length > MAX_PROFILE_BYTES) {
    text = text.slice(0, MAX_PROFILE_BYTES);
    warnings.push(`${label} quá 64 KB, chỉ nạp phần đầu.`);
  }
  const body = text.trim();
  const lines = body ? body.split(/\r?\n/).length : 0;
  if (!body) return { info: { path: file, lines: 0, loaded: false } };
  if (looksLikeSecret(body)) {
    warnings.push(`${label} có thứ trông như secret (key/token/mật khẩu), nên không nạp. Xoá secret khỏi file rồi mở chat mới.`);
    return { info: { path: file, lines, loaded: false } };
  }
  if (lines > PROFILE_MAX_LINES) warnings.push(`${label} dài ${lines} dòng (nên dưới ${PROFILE_MAX_LINES}): hồ sơ dài tốn context mỗi lượt.`);
  return { info: { path: file, lines, loaded: true }, text: body };
}

async function readPlugin(dir: string, warnings: string[]): Promise<PluginInfo | null> {
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
  } catch {
    return null;
  }
  const info: PluginInfo = { path: dir, skills: [], loaded: false };
  try {
    const manifest = JSON.parse((await readFile(path.join(dir, ".claude-plugin", "plugin.json"), "utf8")).replace(/^﻿/, "")) as { name?: unknown };
    if (typeof manifest.name !== "string" || !manifest.name) throw new Error("no name");
    info.name = manifest.name;
  } catch {
    warnings.push(`Plugin ${dir} thiếu hoặc hỏng .claude-plugin/plugin.json (cần trường "name"), nên không nạp.`);
    return info;
  }
  try {
    for (const e of await readdir(path.join(dir, "skills"), { withFileTypes: true })) {
      if (e.isDirectory() && existsSync(path.join(dir, "skills", e.name, "SKILL.md"))) info.skills.push(e.name);
    }
  } catch {
    /* a plugin without skills (only agents/commands) is fine */
  }
  info.skills.sort();
  info.loaded = true;
  return info;
}

/** Read the personal layer for one session in `workspace`. Missing files are simply left out. */
export async function loadPersonal(home: string, workspace?: string): Promise<Personal> {
  const warnings: string[] = [];
  const out: Personal = { home, profile: null, project: null, plugin: null, plugins: [], warnings };
  const parts: string[] = [];

  const main = await readProfile(path.join(home, "profile.md"), "profile.md", warnings);
  if (main) {
    out.profile = main.info;
    if (main.text) parts.push(main.text);
  }
  if (workspace) {
    const name = await projectName(workspace);
    const proj = await readProfile(path.join(home, "projects", name, "profile.md"), `projects/${name}/profile.md`, warnings);
    if (proj) {
      out.project = { ...proj.info, name };
      if (proj.text) parts.push(`## Project: ${name}\n\n${proj.text}`);
    }
  }
  if (parts.length) out.systemAppend = parts.join("\n\n");

  const plugin = await readPlugin(path.join(home, "plugin"), warnings);
  if (plugin) {
    out.plugin = plugin;
    if (plugin.loaded) out.plugins.push(plugin.path);
  }
  return out;
}
