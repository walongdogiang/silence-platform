// Git worktrees for parallel chats (roadmap 1.11). A chat that would share a checkout with another
// running chat gets its own worktree on branch `silence/<name>`, outside the repo
// (`%LOCALAPPDATA%/silence/worktrees/<project>/<name>`). The merge card brings the work back.
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface WorktreeInfo {
  /** Checkout the chat works in. */
  path: string;
  branch: string;
  /** Branch of the main checkout when the worktree was made (where "merge" goes). */
  base: string;
  baseSha: string;
  /** Main checkout (repo root). */
  root: string;
  /** Why the chat was split off (shown to the user). */
  reason: WorktreeReason;
}

export type WorktreeReason = "forced" | "other_running" | "dirty";

export interface FileChange {
  path: string;
  added: number;
  removed: number;
  /** Untracked new file. */
  isNew?: boolean;
}

function git(cwd: string, args: string[], timeoutMs = 60_000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: (err ? `${stdout}${stderr}` : stdout).trim() });
    });
  });
}

/** `SILENCE_WORKTREES` or `%LOCALAPPDATA%/silence/worktrees` (outside every repo). */
export function worktreeBase(env: NodeJS.ProcessEnv = process.env): string {
  if (env.SILENCE_WORKTREES) return env.SILENCE_WORKTREES;
  return path.join(env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "silence", "worktrees");
}

/** Top of the git checkout that contains `dir`, or null outside git. */
export async function repoRoot(dir: string): Promise<string | null> {
  const r = await git(dir, ["rev-parse", "--show-toplevel"]);
  return r.ok && r.out ? path.resolve(r.out) : null;
}

/** The checkout has uncommitted changes (tracked or untracked). */
export async function isDirty(root: string): Promise<boolean> {
  const r = await git(root, ["status", "--porcelain"]);
  return r.ok && r.out.length > 0;
}

/** `20261122-0931-a1b2` — sortable, short, unique enough per repo. */
export function worktreeName(now = new Date(), rand = Math.random().toString(16).slice(2, 6)): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}-${rand}`;
}

/** New worktree + branch `silence/<name>` from the main checkout's HEAD (its commits, not its uncommitted edits). */
export async function createWorktree(root: string, project: string, reason: WorktreeReason, base = worktreeBase(), name = worktreeName()): Promise<WorktreeInfo> {
  const branchName = `silence/${name}`;
  const dir = path.join(base, project, name);
  await mkdir(path.dirname(dir), { recursive: true });
  const head = await git(root, ["rev-parse", "HEAD"]);
  if (!head.ok) throw new Error("the repository has no commit yet; a worktree needs one");
  const cur = await git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const add = await git(root, ["worktree", "add", "-q", "-b", branchName, dir, "HEAD"]);
  if (!add.ok) throw new Error(`git worktree add failed: ${add.out.slice(0, 300)}`);
  return { path: dir, branch: branchName, base: cur.ok ? cur.out : "HEAD", baseSha: head.out, root, reason };
}

/** What the worktree changed since it was made: committed and uncommitted, new files included. */
export async function worktreeChanges(w: WorktreeInfo): Promise<{ files: FileChange[]; commits: number }> {
  const files: FileChange[] = [];
  const numstat = await git(w.path, ["diff", "--numstat", "--no-renames", w.baseSha]);
  for (const line of numstat.ok ? numstat.out.split("\n") : []) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (m) files.push({ path: m[3]!, added: m[1] === "-" ? 0 : Number(m[1]), removed: m[2] === "-" ? 0 : Number(m[2]) });
  }
  const untracked = await git(w.path, ["ls-files", "--others", "--exclude-standard"]);
  for (const f of untracked.ok ? untracked.out.split("\n").filter(Boolean) : []) files.push({ path: f, added: 0, removed: 0, isNew: true });
  const ahead = await git(w.path, ["rev-list", "--count", `${w.baseSha}..HEAD`]);
  return { files, commits: ahead.ok ? Number(ahead.out) || 0 : 0 };
}

export interface MergeResult {
  ok: boolean;
  /** Merge commit on the base branch. */
  commit?: string;
  /** Files in conflict (the merge was aborted, nothing changed). */
  conflicts?: string[];
  message?: string;
}

/**
 * Commit what is left in the worktree, then merge its branch into the branch checked out in the main
 * checkout. A conflict aborts the merge and lists the files; the main checkout is left as it was.
 */
export async function mergeWorktree(w: WorktreeInfo, title: string): Promise<MergeResult> {
  await git(w.path, ["add", "-A"]);
  const staged = await git(w.path, ["diff", "--cached", "--quiet"]);
  if (!staged.ok) {
    const c = await git(w.path, ["commit", "-q", "-m", `5ilence: ${title.slice(0, 72) || "chat changes"}`]);
    if (!c.ok) return { ok: false, message: `commit in the worktree failed: ${c.out.slice(0, 300)}` };
  }
  const cur = await git(w.root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (cur.ok && cur.out !== w.base) return { ok: false, message: `the main checkout is on ${cur.out}, not ${w.base}; switch back to ${w.base} to merge` };
  const merge = await git(w.root, ["merge", "--no-ff", "--no-edit", "-m", `Merge ${w.branch} (5ilence chat)`, w.branch]);
  if (merge.ok) return { ok: true, commit: (await git(w.root, ["rev-parse", "--short", "HEAD"])).out };
  const unmerged = await git(w.root, ["diff", "--name-only", "--diff-filter=U"]);
  const conflicts = unmerged.ok ? unmerged.out.split("\n").filter(Boolean) : [];
  if (conflicts.length) {
    await git(w.root, ["merge", "--abort"]);
    return { ok: false, conflicts, message: "merge conflict; nothing was changed" };
  }
  return { ok: false, message: merge.out.slice(0, 400) || "git merge failed" };
}

/** Remove the worktree folder and its branch (the work in it is lost). */
export async function discardWorktree(w: WorktreeInfo): Promise<void> {
  const rm = await git(w.root, ["worktree", "remove", "--force", w.path]);
  if (!rm.ok) throw new Error(`git worktree remove failed: ${rm.out.slice(0, 300)}`);
  await git(w.root, ["branch", "-D", w.branch]);
}
