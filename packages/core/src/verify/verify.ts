// Verification after a turn (roadmap 1.8, docs/adapters/protocol.md "Sau mỗi lượt: kiểm chứng").
// `verify.yaml` maps changed paths to checks:
//   rules: [{ when: ["apps/studio/**"], run: "npx tsc --noEmit -p apps/studio", timeout_s?: 600 }]
//   pairs: [["crates/protocol/src/lib.rs", "packages/protocol/src/index.ts"]]  # must change together
// The user's ~/.silence/projects/<repo>/verify.yaml is trusted; the repo's .silence/verify.yaml is
// not (its commands need approval, see SessionManager).
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { appendJsonl, readJsonl } from "../store/jsonl.js";
import { redact } from "../store/redact.js";

export const MAX_FIX_ROUNDS = 2;
export const DEFAULT_TIMEOUT_SEC = 600;
const OUTPUT_TAIL = 6000;

export interface VerifyRule {
  when: string[];
  run: string;
  timeoutSec: number;
}

export interface VerifyConfig {
  /** `user` = ~/.silence (trusted); `repo` = .silence/verify.yaml in the workspace (needs approval). */
  source: "user" | "repo";
  file: string;
  rules: VerifyRule[];
  pairs: string[][];
}

export interface CheckResult {
  command: string;
  ok: boolean;
  /** Not run: refused by the permission flow, or a pair check (no command). */
  skipped?: string;
  exit_code?: number | null;
  ms: number;
  /** Tail of stdout + stderr, secrets redacted. */
  output: string;
}

async function readMaybe(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

function parseConfig(text: string, source: VerifyConfig["source"], file: string): VerifyConfig {
  const doc = (parseYaml(text) ?? {}) as { rules?: unknown; pairs?: unknown };
  const rules: VerifyRule[] = [];
  for (const r of Array.isArray(doc.rules) ? (doc.rules as Array<Record<string, unknown>>) : []) {
    const when = Array.isArray(r?.when) ? r.when.filter((w): w is string => typeof w === "string" && w.length > 0) : [];
    if (typeof r?.run !== "string" || !r.run.trim() || !when.length) continue;
    const t = typeof r.timeout_s === "number" && r.timeout_s > 0 ? Math.min(r.timeout_s, 3600) : DEFAULT_TIMEOUT_SEC;
    rules.push({ when, run: r.run.trim(), timeoutSec: t });
  }
  const pairs = (Array.isArray(doc.pairs) ? doc.pairs : []).filter((p): p is string[] => Array.isArray(p) && p.length >= 2 && p.every((x) => typeof x === "string"));
  return { source, file, rules, pairs };
}

/** The verify config for a session: the user's file wins over the repo's. */
export async function loadVerify(home: string, project: string, workspace: string): Promise<VerifyConfig | null> {
  const user = path.join(home, "projects", project, "verify.yaml");
  const repo = path.join(workspace, ".silence", "verify.yaml");
  for (const [file, source] of [
    [user, "user"],
    [repo, "repo"],
  ] as const) {
    const text = await readMaybe(file);
    if (text === null) continue;
    try {
      return parseConfig(text, source, file);
    } catch {
      return { source, file, rules: [], pairs: [] };
    }
  }
  return null;
}

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

export function pathMatches(glob: string, file: string): boolean {
  return globToRegex(glob.replace(/\\/g, "/").replace(/^\.\//, "")).test(file.replace(/\\/g, "/"));
}

/** Commands to run for the changed files (each once, in file order) and pair violations. */
export function planChecks(cfg: VerifyConfig, changed: string[]): { commands: VerifyRule[]; pairErrors: string[] } {
  const commands: VerifyRule[] = [];
  for (const r of cfg.rules) {
    if (commands.some((c) => c.run === r.run)) continue;
    if (changed.some((f) => r.when.some((g) => pathMatches(g, f)))) commands.push(r);
  }
  const pairErrors: string[] = [];
  for (const pair of cfg.pairs) {
    const hit = pair.filter((p) => changed.some((f) => pathMatches(p, f)));
    if (hit.length > 0 && hit.length < pair.length) {
      const missing = pair.filter((p) => !hit.includes(p));
      pairErrors.push(`${hit.join(", ")} changed but ${missing.join(", ")} did not; they must change together.`);
    }
  }
  return { commands, pairErrors };
}

/**
 * Split a command line on top-level `;` (not inside quotes, parentheses or braces). Windows
 * PowerShell 5.1 has no `&&`, and `a; b` exits with b's status, which would hide a failing `a`.
 */
export function splitSequence(command: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (quote) {
      if (c === "`" && quote === '"' && i + 1 < command.length) {
        cur += c + command[++i]!;
        continue;
      }
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "{") depth++;
    else if ((c === ")" || c === "}") && depth > 0) depth--;
    else if (c === ";" && depth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/**
 * Run one check in the workspace: each `;`-separated part in turn, stopping at the first failure
 * (PowerShell on Windows, sh elsewhere). The exit code is the failing part's. Never throws.
 */
export async function runCheck(command: string, cwd: string, timeoutSec: number, env: NodeJS.ProcessEnv = process.env): Promise<CheckResult> {
  const started = Date.now();
  const deadline = started + timeoutSec * 1000;
  let output = "";
  let last: CheckResult = { command, ok: true, exit_code: 0, ms: 0, output: "" };
  for (const part of splitSequence(command)) {
    const left = Math.max(1, Math.round((deadline - Date.now()) / 1000));
    last = await runOne(part, cwd, left, env);
    output += (output ? "\n" : "") + last.output;
    if (!last.ok) break;
  }
  const text = output.trim();
  return { command, ok: last.ok, exit_code: last.exit_code ?? null, ms: Date.now() - started, output: text.length > OUTPUT_TAIL ? `…${text.slice(-OUTPUT_TAIL)}` : text };
}

function runOne(command: string, cwd: string, timeoutSec: number, env: NodeJS.ProcessEnv): Promise<CheckResult> {
  const started = Date.now();
  // PowerShell: exit with the native command's code, or 1 when a cmdlet failed.
  const ps = `${command}; if (-not $?) { if ($LASTEXITCODE) { exit $LASTEXITCODE } else { exit 1 } }; exit 0`;
  const [exe, args] = process.platform === "win32" ? ["powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps]] : ["sh", ["-c", command]];
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const add = (b: Buffer) => {
      out += b.toString("utf8");
      if (out.length > OUTPUT_TAIL * 4) out = out.slice(-OUTPUT_TAIL * 2);
    };
    const done = (ok: boolean, exit_code: number | null, note?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const text = (note ? `${out}\n${note}` : out).trim();
      resolve({ command, ok, exit_code, ms: Date.now() - started, output: redact(text.length > OUTPUT_TAIL ? `…${text.slice(-OUTPUT_TAIL)}` : text) });
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exe as string, args as string[], { cwd, env, windowsHide: true });
    } catch (e) {
      resolve({ command, ok: false, exit_code: null, ms: 0, output: `could not start: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      done(false, null, `timed out after ${timeoutSec}s`);
    }, timeoutSec * 1000);
    child.stdout?.on("data", add);
    child.stderr?.on("data", add);
    child.on("error", (e) => done(false, null, e.message));
    child.on("close", (code) => done(code === 0, code));
  });
}

/** Message sent to the agent when checks fail (English, fixed format). */
export function fixPrompt(failed: CheckResult[], round: number): string {
  const parts = failed.map((r) => `$ ${r.command}\n${r.output || "(no output)"}`);
  return [
    `[5ilence verify] The checks for the files you changed failed (fix round ${round} of ${MAX_FIX_ROUNDS}). Fix the cause, not the check. Do not disable, skip or weaken tests or lint rules.`,
    "",
    ...parts,
  ].join("\n");
}

export function commandHash(workspace: string, command: string): string {
  return createHash("sha256").update(`${path.resolve(workspace).toLowerCase()}\n${command}`).digest("hex");
}

/** Repo verify commands the user approved (`<dataDir>/verify-approvals.jsonl`, by workspace + command). */
export class VerifyApprovals {
  readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "verify-approvals.jsonl");
  }

  async isApproved(workspace: string, command: string): Promise<boolean> {
    const h = commandHash(workspace, command);
    return (await readJsonl<{ hash: string }>(this.file)).some((r) => r.hash === h);
  }

  approve(workspace: string, command: string): Promise<void> {
    return appendJsonl(this.file, { ts: new Date().toISOString(), workspace: path.resolve(workspace), command, hash: commandHash(workspace, command) });
  }
}
