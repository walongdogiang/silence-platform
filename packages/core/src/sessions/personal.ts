// Personal profile and plugin from `~/.silence` (repo `silence-home`), passed to every backend session.
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
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

export interface Personal {
  /** Content of `profile.md`, appended to the backend's system prompt. */
  profile?: string;
  /** Local plugin directories (`<home>/plugin` when present). */
  plugins: string[];
}

const MAX_PROFILE_BYTES = 64 * 1024;

/** Read the profile and plugin; anything missing is simply left out. */
export async function loadPersonal(home: string): Promise<Personal> {
  const out: Personal = { plugins: [] };
  try {
    const text = (await readFile(path.join(home, "profile.md"), "utf8")).slice(0, MAX_PROFILE_BYTES).trim();
    if (text) out.profile = text;
  } catch {
    /* no profile */
  }
  const plugin = path.join(home, "plugin");
  try {
    if (existsSync(plugin) && statSync(plugin).isDirectory()) out.plugins.push(plugin);
  } catch {
    /* unreadable plugin dir */
  }
  return out;
}
