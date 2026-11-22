// Lesson loop (roadmap 1.9, ADR 0004 pillar 6). The user writes what should be different after a
// turn; one Claude call proposes edits to the personal files; the user reviews the diffs; the core
// writes the accepted ones plus a lesson note to ~/.silence, commits and pushes.
// Only personal files are editable (profile, project profile, verify.yaml, skills). Permission rules
// are never touched: the loop must never widen permissions (ADR 0004).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { looksLikeSecret } from "../sessions/personal.js";

export interface LessonTarget {
  /** Path relative to ~/.silence, `/` separated. */
  file: string;
  kind: "profile" | "project_profile" | "verify" | "skill";
  /** Current content ("" when the file does not exist yet). */
  content: string;
  exists: boolean;
}

export interface LessonEdit {
  file: string;
  kind: LessonTarget["kind"];
  before: string;
  after: string;
  reason: string;
  isNew: boolean;
}

export interface LessonProposal {
  summary: string;
  edits: LessonEdit[];
  /** Edits the model proposed that were dropped (not allowed, secret, too big, unchanged). */
  warnings: string[];
}

export interface LessonContext {
  /** The user's message of the turn. */
  user?: string;
  /** The agent's answer of the turn. */
  answer?: string;
  workspace?: string;
}

const MAX_FILE = 64 * 1024;
const MAX_CONTEXT = 4000;
const SKILL_RE = /^plugin\/skills\/([a-z0-9][a-z0-9-]{0,39})\/SKILL\.md$/;

const cut = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n)}…` : (s ?? ""));

async function readMaybe(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

/** Which kind of personal file `file` is, or null when the lesson loop may not edit it. */
export function targetKind(file: string, project: string): LessonTarget["kind"] | null {
  const f = file.replace(/\\/g, "/").replace(/^\.?\//, "");
  if (f === "profile.md") return "profile";
  if (f === `projects/${project}/profile.md`) return "project_profile";
  if (f === `projects/${project}/verify.yaml`) return "verify";
  if (SKILL_RE.test(f)) return "skill";
  return null;
}

/** The files a lesson may change, with their current content. */
export async function lessonTargets(home: string, project: string): Promise<LessonTarget[]> {
  const out: LessonTarget[] = [];
  const add = async (file: string, kind: LessonTarget["kind"]) => {
    const text = await readMaybe(path.join(home, file));
    out.push({ file, kind, content: text ?? "", exists: text !== null });
  };
  await add("profile.md", "profile");
  await add(`projects/${project}/profile.md`, "project_profile");
  await add(`projects/${project}/verify.yaml`, "verify");
  try {
    for (const e of (await readdir(path.join(home, "plugin", "skills"), { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const file = `plugin/skills/${e.name}/SKILL.md`;
      if (e.isDirectory() && SKILL_RE.test(file) && existsSync(path.join(home, file))) await add(file, "skill");
    }
  } catch {
    /* no skills yet */
  }
  return out;
}

export const LESSON_SYSTEM = `You maintain a developer's personal coding-agent setup. From one lesson the user wrote after a turn, propose the smallest edits to their personal files so the agent behaves better next time.

Editable files (paths relative to ~/.silence):
- profile.md: short working profile for every project (keep it under 60 lines).
- projects/<project>/profile.md: conventions for this project only.
- projects/<project>/verify.yaml: checks run after each turn ("rules: [{when: [globs], run: command}]", "pairs").
- plugin/skills/<name>/SKILL.md: a skill with YAML front matter (name, description) and instructions. A new skill is allowed when the lesson is a reusable procedure.

Rules:
- Never touch permissions or anything else; never add secrets, tokens or personal data.
- Prefer editing an existing line over adding new text; keep the user's language and style.
- If no file should change, return no edits and say so in the summary.
- Reply with ONE JSON object and nothing else:
{"summary": "<one sentence>", "edits": [{"file": "<path>", "content": "<the whole new file>", "reason": "<one sentence>"}]}`;

/** Prompt for the proposal: the lesson, the turn, and the current files. */
export function lessonPrompt(lesson: string, ctx: LessonContext, project: string, targets: LessonTarget[]): string {
  const files = targets.map((t) => `--- ${t.file}${t.exists ? "" : " (does not exist yet)"}\n${cut(t.content, 12000)}`).join("\n\n");
  return [
    `Project: ${project}`,
    "",
    "Lesson from the user:",
    lesson.trim(),
    "",
    "The turn it is about:",
    `User: ${cut(ctx.user, MAX_CONTEXT) || "(not given)"}`,
    `Agent: ${cut(ctx.answer, MAX_CONTEXT) || "(not given)"}`,
    "",
    "Current files:",
    files,
  ].join("\n");
}

/** First JSON object in `text` (models sometimes wrap it in a code fence). */
function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("the proposal is not JSON");
  return JSON.parse(body.slice(start, end + 1));
}

/** Validate the model's reply into edits the user can review. Disallowed edits become warnings. */
export function parseProposal(text: string, project: string, targets: LessonTarget[]): LessonProposal {
  const doc = extractJson(text) as { summary?: unknown; edits?: unknown };
  const summary = typeof doc.summary === "string" && doc.summary.trim() ? doc.summary.trim().slice(0, 300) : "Lesson";
  const edits: LessonEdit[] = [];
  const warnings: string[] = [];
  for (const raw of Array.isArray(doc.edits) ? (doc.edits as Array<Record<string, unknown>>) : []) {
    const file = typeof raw?.file === "string" ? raw.file.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/^~\/\.silence\//, "") : "";
    const after = typeof raw?.content === "string" ? raw.content : null;
    const reason = typeof raw?.reason === "string" ? raw.reason.slice(0, 300) : "";
    const kind = file ? targetKind(file, project) : null;
    if (!kind || after === null) {
      warnings.push(`not allowed: ${file || "(no file)"}`);
      continue;
    }
    if (after.length > MAX_FILE) {
      warnings.push(`too big: ${file}`);
      continue;
    }
    if (looksLikeSecret(after)) {
      warnings.push(`looks like it contains a secret: ${file}`);
      continue;
    }
    const cur = targets.find((t) => t.file === file);
    const before = cur?.content ?? "";
    const normalized = after.endsWith("\n") || !after ? after : `${after}\n`;
    if (normalized === before) continue;
    if (edits.some((e) => e.file === file)) continue;
    edits.push({ file, kind, before, after: normalized, reason, isNew: !cur?.exists });
  }
  return { summary, edits, warnings };
}

function git(cwd: string, args: string[], timeoutMs = 30_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout}${stderr}`.trim() });
    });
  });
}

export interface ApplyResult {
  written: string[];
  lessonFile: string;
  /** Commit sha, or null when ~/.silence is not a git repo or the commit failed. */
  commit: string | null;
  pushed: boolean;
  /** Why commit or push did not happen (short, for the UI). */
  note?: string;
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "lesson";

/**
 * Write the accepted edits and the lesson note, then commit and push ~/.silence. An edit whose file
 * changed since the proposal is refused (no silent overwrite).
 */
export async function applyLesson(home: string, lesson: string, ctx: LessonContext, proposal: LessonProposal, accepted: LessonEdit[], now = new Date()): Promise<ApplyResult> {
  for (const e of accepted) {
    const cur = (await readMaybe(path.join(home, e.file))) ?? "";
    if (cur !== e.before) throw new Error(`${e.file} changed since the proposal; propose again`);
  }
  const written: string[] = [];
  for (const e of accepted) {
    const abs = path.join(home, e.file);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, e.after, "utf8");
    written.push(e.file);
  }
  const day = now.toISOString().slice(0, 10);
  let lessonFile = `lessons/${day}-${slug(proposal.summary)}.md`;
  for (let i = 2; existsSync(path.join(home, lessonFile)); i++) lessonFile = `lessons/${day}-${slug(proposal.summary)}-${i}.md`;
  const note = [
    "---",
    `date: ${now.toISOString()}`,
    ctx.workspace ? `workspace: ${path.basename(ctx.workspace)}` : null,
    `applied: [${written.map((w) => JSON.stringify(w)).join(", ")}]`,
    "---",
    "",
    `# ${proposal.summary}`,
    "",
    lesson.trim(),
    "",
    ...(accepted.length ? ["## Changes", "", ...accepted.map((e) => `- \`${e.file}\`: ${e.reason || "updated"}`), ""] : []),
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
  await mkdir(path.join(home, "lessons"), { recursive: true });
  await writeFile(path.join(home, lessonFile), note, "utf8");

  const res: ApplyResult = { written, lessonFile, commit: null, pushed: false };
  if (!(await git(home, ["rev-parse", "--is-inside-work-tree"])).ok) return { ...res, note: "~/.silence is not a git repository; files were written only" };
  const add = await git(home, ["add", "--", lessonFile, ...written]);
  if (!add.ok) return { ...res, note: `git add failed: ${add.out.slice(0, 200)}` };
  const commit = await git(home, ["commit", "-m", `lesson: ${proposal.summary}`, "--", lessonFile, ...written]);
  if (!commit.ok) return { ...res, note: `git commit failed: ${commit.out.slice(0, 200)}` };
  const sha = (await git(home, ["rev-parse", "--short", "HEAD"])).out || null;
  const push = await git(home, ["push"], 60_000);
  return { ...res, commit: sha, pushed: push.ok, ...(push.ok ? {} : { note: `git push failed: ${push.out.slice(0, 200)}` }) };
}
