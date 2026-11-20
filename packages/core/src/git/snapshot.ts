// Per-turn undo points (port of agent/sandbox.rs snapshots). The workspace tree is committed with a
// temporary index under `refs/silence/snap/<session>/<turn>`, so the user's index, HEAD and branches
// are untouched. Backend-neutral: works whatever app edited the files.
import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";

export const KEEP_SNAPSHOTS = 20;
const GIT_TIMEOUT_MS = 30_000;
const SAFE = /^[A-Za-z0-9._-]{1,128}$/;

function git(cwd: string, args: string[], env: Record<string, string> = {}): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, env: { ...process.env, ...env }, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : stdout.trim());
    });
  });
}

function ref(session: string, turn: number): string {
  if (!SAFE.test(session) || !Number.isInteger(turn) || turn < 0) throw new Error("invalid snapshot name");
  return `refs/silence/snap/${session}/${turn}`;
}

/** Snapshot the workspace; returns the ref name, or null when it is not a git repo (nothing to undo). */
export async function takeSnapshot(root: string, session: string, turn: number): Promise<string | null> {
  const name = ref(session, turn);
  const gd = await git(root, ["rev-parse", "--absolute-git-dir"]);
  if (!gd) return null;
  const idx = path.join(gd, `silence-snap-${session}-${turn}.idx`);
  const env = {
    GIT_INDEX_FILE: idx,
    GIT_AUTHOR_NAME: "5ilence",
    GIT_AUTHOR_EMAIL: "snapshot@5ilence.local",
    GIT_COMMITTER_NAME: "5ilence",
    GIT_COMMITTER_EMAIL: "snapshot@5ilence.local",
  };
  try {
    if ((await git(root, ["add", "-A", "--", "."], env)) === null) return null;
    const tree = await git(root, ["write-tree"], env);
    if (!tree) return null;
    const parent = await git(root, ["rev-parse", "-q", "--verify", "HEAD"]);
    const commit = await git(root, ["commit-tree", tree, "-m", "5ilence snapshot", ...(parent ? ["-p", parent] : [])], env);
    if (!commit) return null;
    if ((await git(root, ["update-ref", name, commit])) === null) return null;
  } finally {
    await rm(idx, { force: true });
  }
  await pruneSnapshots(root, session);
  return name;
}

/** Turns that have a snapshot, oldest first. */
export async function listSnapshots(root: string, session: string): Promise<number[]> {
  const prefix = `refs/silence/snap/${session}/`;
  const out = (await git(root, ["for-each-ref", "--format=%(refname)", prefix])) ?? "";
  return out
    .split("\n")
    .filter((l) => l.startsWith(prefix))
    .map((l) => Number(l.slice(prefix.length)))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b);
}

async function pruneSnapshots(root: string, session: string): Promise<void> {
  const turns = await listSnapshots(root, session);
  for (const t of turns.slice(0, Math.max(0, turns.length - KEEP_SNAPSHOTS))) {
    await git(root, ["update-ref", "-d", ref(session, t)]);
  }
}

/** Put tracked and untracked files back as they were at the snapshot (new files are left in place). */
export async function restoreSnapshot(root: string, session: string, turn: number): Promise<void> {
  const name = ref(session, turn);
  if ((await git(root, ["rev-parse", "-q", "--verify", name])) === null) throw new Error(`no snapshot for turn ${turn}`);
  if ((await git(root, ["restore", "--source", name, "--worktree", "--", "."])) === null) throw new Error("git restore failed");
}
