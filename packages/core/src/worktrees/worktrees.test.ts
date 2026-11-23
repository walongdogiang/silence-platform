import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RpcClient } from "../api/jsonrpc.js";
import { memoryPair } from "../api/transport.js";
import type { Backend, BackendHooks, StartOptions, UserMessage } from "../backends/types.js";
import { createCoreWithSessions } from "../core.js";
import { createWorktree, discardWorktree, isDirty, mergeWorktree, newFileLines, repoRoot, worktreeChanges, worktreeName } from "./worktrees.js";

const tmp = (p: string) => mkdtempSync(path.join(os.tmpdir(), p));
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function repo(): string {
  const root = path.join(tmp("wt-parent-"), "shop");
  mkdirSync(root);
  sh(root, "init", "-q", "-b", "main");
  sh(root, "config", "user.name", "t");
  sh(root, "config", "user.email", "t@t");
  sh(root, "config", "core.autocrlf", "false");
  writeFileSync(path.join(root, "a.txt"), "one\n");
  sh(root, "add", ".");
  sh(root, "commit", "-q", "-m", "init");
  return root;
}

describe("worktrees", () => {
  it("counts the lines of a new file like git diff: none for empty or binary", async () => {
    const d = tmp("wt-lines-");
    writeFileSync(path.join(d, "a.txt"), "one\ntwo\n");
    writeFileSync(path.join(d, "b.txt"), "no newline at end");
    writeFileSync(path.join(d, "e.txt"), "");
    writeFileSync(path.join(d, "bin.dat"), Buffer.from([1, 0, 2, 10]));
    expect(await newFileLines(path.join(d, "a.txt"))).toBe(2);
    expect(await newFileLines(path.join(d, "b.txt"))).toBe(1);
    expect(await newFileLines(path.join(d, "e.txt"))).toBe(0);
    expect(await newFileLines(path.join(d, "bin.dat"))).toBe(0);
    expect(await newFileLines(path.join(d, "missing.txt"))).toBe(0);
  });

  it("are created outside the repo on a silence/ branch and list what changed", async () => {
    const root = repo();
    const base = tmp("wt-base-");
    expect(await repoRoot(path.join(root))).toBe(path.resolve(root));
    const w = await createWorktree(root, "shop", "forced", base, "n1");
    expect(w).toMatchObject({ path: path.join(base, "shop", "n1"), branch: "silence/n1", base: "main", reason: "forced" });
    expect(path.relative(root, w.path).startsWith("..")).toBe(true);
    writeFileSync(path.join(w.path, "a.txt"), "one\ntwo\n");
    writeFileSync(path.join(w.path, "new.txt"), "x\ny\nz");
    const ch = await worktreeChanges(w);
    expect(ch.files).toEqual([
      { path: "a.txt", added: 1, removed: 0 },
      { path: "new.txt", added: 3, removed: 0, isNew: true }, // a new file counts its lines (it was 0)
    ]);
    expect(await isDirty(root)).toBe(false);
    expect(worktreeName(new Date(2026, 10, 22, 9, 5), "ab12")).toBe("20261122-0905-ab12");
  });

  it("merge commits the leftovers and merges into the base branch", async () => {
    const root = repo();
    const w = await createWorktree(root, "shop", "forced", tmp("wt-base-"), "n2");
    writeFileSync(path.join(w.path, "a.txt"), "one\nfrom chat\n");
    const res = await mergeWorktree(w, "Add a line");
    expect(res.ok).toBe(true);
    expect(readFileSync(path.join(root, "a.txt"), "utf8")).toBe("one\nfrom chat\n");
    expect(sh(root, "log", "-2", "--format=%s").split("\n")).toEqual(["Merge silence/n2 (5ilence chat)", "5ilence: Add a line"]);
  });

  it("after a merge the card counts only what changed since, and a second merge brings that in", async () => {
    const root = repo();
    const w = await createWorktree(root, "shop", "forced", tmp("wt-base-"), "n5");
    writeFileSync(path.join(w.path, "a.txt"), "ONE\n");
    expect((await mergeWorktree(w, "first")).ok).toBe(true);
    expect(await worktreeChanges(w)).toEqual({ files: [], commits: 0 });
    writeFileSync(path.join(w.path, "a.txt"), "ONE\ntwo\n");
    // Only the new line, not the already-merged rewrite of line 1 (+2 −1 before the fix).
    expect((await worktreeChanges(w)).files).toEqual([{ path: "a.txt", added: 1, removed: 0 }]);
    expect((await mergeWorktree(w, "second")).ok).toBe(true);
    expect(readFileSync(path.join(root, "a.txt"), "utf8")).toBe("ONE\ntwo\n");
    expect((await worktreeChanges(w)).files).toEqual([]);
  }, 30_000); // ~20 git calls; slow on Windows

  it("a conflict aborts the merge, lists the files and leaves the main checkout as it was", async () => {
    const root = repo();
    const w = await createWorktree(root, "shop", "forced", tmp("wt-base-"), "n3");
    const before = w.baseSha;
    writeFileSync(path.join(w.path, "a.txt"), "chat version\n");
    writeFileSync(path.join(root, "a.txt"), "main version\n");
    sh(root, "commit", "-q", "-am", "main edit");
    const res = await mergeWorktree(w, "x");
    expect(w.baseSha).toBe(before); // nothing went in: the card still shows the whole change
    expect(res).toMatchObject({ ok: false, conflicts: ["a.txt"] });
    expect(readFileSync(path.join(root, "a.txt"), "utf8")).toBe("main version\n");
    expect(sh(root, "status", "--porcelain")).toBe("");
  });

  it("discard removes the folder and the branch", async () => {
    const root = repo();
    const w = await createWorktree(root, "shop", "forced", tmp("wt-base-"), "n4");
    await discardWorktree(w);
    expect(existsSync(w.path)).toBe(false);
    expect(sh(root, "branch", "--list", "silence/n4")).toBe("");
  });
});

describe("parallel sessions", () => {
  /** Fake backend: a turn ends only when the test says so (`finish(i)`). */
  function setup(maxConcurrent = 2) {
    const started: StartOptions[] = [];
    const hooks: BackendHooks[] = [];
    const sent: Array<{ i: number; m: UserMessage }> = [];
    const fake: Backend = {
      info: { id: "fake", version: "0", capabilities: {} as never },
      start: async (o, h) => {
        const i = started.length;
        started.push(o);
        hooks.push(h);
        return { send: async (m) => void sent.push({ i, m }), interrupt: async () => {}, close: async () => {} };
      },
    };
    const core = createCoreWithSessions({ host: "test", dataDir: tmp("wt-data-"), home: tmp("wt-home-"), sessions: { backends: { claude: fake }, listExternal: async () => [], snapshot: async () => null, worktreeBase: tmp("wt-base-"), maxConcurrent } });
    const [a, b] = memoryPair();
    core.server.attach(a);
    const client = new RpcClient(b);
    const events: Array<{ sid: string; ev: Record<string, unknown> }> = [];
    client.onNotification((m, p) => m === "session.event" && events.push({ sid: (p as { session_id: string }).session_id, ev: (p as { event: Record<string, unknown> }).event }));
    const finish = (i: number) => hooks[i]!.emit({ type: "turn.end", stop: "interrupted", durationMs: 1 });
    const tick = () => new Promise((r) => setTimeout(r, 20));
    return { client, started, sent, events, finish, tick };
  }
  type Created = { session_id: string; worktree: { path: string; branch: string; reason: string } | null };

  it("splits a second chat into a worktree while the first one runs, with the reason", async () => {
    const root = repo();
    const t = setup();
    const a = await t.client.call<Created>("session.create", { workspace: root });
    expect(a.worktree).toBeNull();
    expect(t.started[0]!.cwd).toBe(path.resolve(root));
    await t.client.call("session.prompt", { session_id: a.session_id, text: "go" });
    const b = await t.client.call<Created>("session.create", { workspace: root });
    expect(b.worktree).toMatchObject({ reason: "other_running", branch: expect.stringMatching(/^silence\//) });
    expect(t.started[1]!.cwd).toBe(b.worktree!.path);
    await expect(t.client.call("worktree.status", { session_id: b.session_id })).resolves.toMatchObject({ worktree: { reason: "other_running" }, files: [], commits: 0 });
  });

  it("splits when the first chat left uncommitted changes, not when the checkout is clean; on/off force it", async () => {
    const root = repo();
    const t = setup();
    await t.client.call<Created>("session.create", { workspace: root });
    const clean = await t.client.call<Created>("session.create", { workspace: root });
    expect(clean.worktree).toBeNull();
    writeFileSync(path.join(root, "a.txt"), "edited\n");
    const dirty = await t.client.call<Created>("session.create", { workspace: root });
    expect(dirty.worktree?.reason).toBe("dirty");
    expect((await t.client.call<Created>("session.create", { workspace: root, worktree: "off" })).worktree).toBeNull();
    const solo = repo();
    expect((await t.client.call<Created>("session.create", { workspace: solo, worktree: "on" })).worktree?.reason).toBe("forced");
  });

  it("queues turns beyond the limit and starts them when a slot frees; aborting a queued turn ends it", async () => {
    const t = setup(1);
    const ws = tmp("wt-plain-");
    const a = await t.client.call<Created>("session.create", { workspace: ws });
    const b = await t.client.call<Created>("session.create", { workspace: ws });
    const c = await t.client.call<Created>("session.create", { workspace: ws });
    await expect(t.client.call("session.prompt", { session_id: a.session_id, text: "A" })).resolves.toMatchObject({ ok: true });
    await expect(t.client.call("session.prompt", { session_id: b.session_id, text: "B" })).resolves.toMatchObject({ queued: true });
    await expect(t.client.call("session.prompt", { session_id: c.session_id, text: "C" })).resolves.toMatchObject({ queued: true });
    expect(t.events.find((e) => e.sid === b.session_id)?.ev).toMatchObject({ type: "trace", event: "queued", detail: { position: 1, limit: 1 } });
    expect(t.sent.map((x) => x.m.text)).toEqual(["A"]);
    await t.client.call("session.abort", { session_id: c.session_id });
    expect(t.events.filter((e) => e.sid === c.session_id).map((e) => e.ev.type)).toEqual(["trace", "done"]);
    t.finish(0);
    await t.tick();
    expect(t.sent.map((x) => x.m.text)).toEqual(["A", "B"]);
    await expect(t.client.call("core.set_limit", { max: 9 })).resolves.toEqual({ max: 4 });
  });

  it("merge and discard act on the chat's worktree", async () => {
    const root = repo();
    const t = setup();
    const b = await t.client.call<Created>("session.create", { workspace: root, worktree: "on" });
    writeFileSync(path.join(b.worktree!.path, "a.txt"), "one\nmerged\n");
    await expect(t.client.call("worktree.merge", { session_id: b.session_id, title: "x" })).resolves.toMatchObject({ ok: true });
    expect(readFileSync(path.join(root, "a.txt"), "utf8")).toContain("merged");
    await t.client.call("worktree.discard", { session_id: b.session_id });
    expect(existsSync(b.worktree!.path)).toBe(false);
    await expect(t.client.call("session.prompt", { session_id: b.session_id, text: "x" })).rejects.toThrow(/unknown session/);
  });
});
