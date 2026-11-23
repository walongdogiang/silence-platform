import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RpcClient } from "../api/jsonrpc.js";
import { memoryPair } from "../api/transport.js";
import type { Backend, BackendHooks, UserMessage } from "../backends/types.js";
import { createCoreWithSessions } from "../core.js";
import { changedSince, takeSnapshot } from "../git/snapshot.js";
import { fixPrompt, loadVerify, planChecks, runCheck, splitSequence, VerifyApprovals, type VerifyConfig } from "./verify.js";

const tmp = (p: string) => mkdtempSync(path.join(os.tmpdir(), p));
const write = (root: string, rel: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text);
};
const node = (js: string) => `node -e "${js}"`;

describe("planChecks", () => {
  const cfg: VerifyConfig = {
    source: "user",
    file: "x",
    rules: [
      { when: ["apps/studio/**", "packages/protocol/**"], run: "studio", timeoutSec: 60 },
      { when: ["packages/core/**"], run: "core", timeoutSec: 60 },
      { when: ["docs/**"], run: "docs", timeoutSec: 60 },
      { when: ["packages/core/**"], run: "core", timeoutSec: 60 },
    ],
    pairs: [["crates/protocol/src/lib.rs", "packages/protocol/src/index.ts"]],
  };

  it("runs each matching command once", () => {
    expect(planChecks(cfg, ["packages/core/src/a.ts", "packages/core/b.ts"]).commands.map((c) => c.run)).toEqual(["core"]);
    expect(planChecks(cfg, ["README.md"]).commands).toEqual([]);
  });

  it("flags a contract pair changed on one side only", () => {
    const p = planChecks(cfg, ["packages/protocol/src/index.ts"]);
    expect(p.commands.map((c) => c.run)).toEqual(["studio"]);
    expect(p.pairErrors).toEqual([expect.stringContaining("must change together")]);
    expect(planChecks(cfg, ["packages/protocol/src/index.ts", "crates/protocol/src/lib.rs"]).pairErrors).toEqual([]);
  });
});

describe("loadVerify", () => {
  it("prefers the user's file over the repo's and skips invalid rules", async () => {
    const home = tmp("v-home-");
    const ws = tmp("v-ws-");
    write(ws, ".silence/verify.yaml", "rules:\n  - when: ['**']\n    run: repo-check\n");
    expect((await loadVerify(home, "p", ws))?.source).toBe("repo");
    write(home, "projects/p/verify.yaml", "rules:\n  - when: ['src/**']\n    run: user-check\n    timeout_s: 30\n  - when: []\n    run: nope\n  - run: nope\n");
    const cfg = await loadVerify(home, "p", ws);
    expect(cfg).toMatchObject({ source: "user", rules: [{ when: ["src/**"], run: "user-check", timeoutSec: 30 }] });
    expect(await loadVerify(home, "none", tmp("v-empty-"))).toBeNull();
  });
});

describe("runCheck", () => {
  it("reports exit code, output tail, timeouts and redacts secrets", async () => {
    const ok = await runCheck(node("console.log('fine')"), os.tmpdir(), 30);
    expect(ok).toMatchObject({ ok: true, exit_code: 0 });
    expect(ok.output).toContain("fine");
    const bad = await runCheck(node("console.error('api_key=abcdefghijklmnop'); process.exit(3)"), os.tmpdir(), 30);
    expect(bad).toMatchObject({ ok: false, exit_code: 3 });
    expect(bad.output).toContain("[REDACTED]");
    const slow = await runCheck(node("setTimeout(() => {}, 20000)"), os.tmpdir(), 1);
    expect(slow.ok).toBe(false);
    expect(slow.output).toContain("timed out");
  }, 30_000);

  it("stops at the first failing part of a ; sequence (PowerShell would hide it)", async () => {
    const r = await runCheck(`${node("process.exit(2)")}; ${node("console.log('later')")}`, os.tmpdir(), 30);
    expect(r).toMatchObject({ ok: false, exit_code: 2 });
    expect(r.output).not.toContain("later");
    expect(splitSequence(`a; b 'x;y'; (c; d); e "f;g"`)).toEqual(["a", "b 'x;y'", "(c; d)", 'e "f;g"']);
  }, 30_000);

  it("the fix prompt carries the command and its output", () => {
    expect(fixPrompt([{ command: "npm test", ok: false, ms: 1, output: "1 failed" }], 1)).toMatch(/fix round 1 of 2[\s\S]*\$ npm test\n1 failed/);
  });
});

describe("changedSince", () => {
  it("lists edited, new and deleted files since the turn snapshot", async () => {
    const ws = tmp("v-git-");
    execFileSync("git", ["init", "-q"], { cwd: ws });
    write(ws, "a.txt", "a");
    write(ws, "b.txt", "b");
    expect(await takeSnapshot(ws, "s1", 1)).toBeTruthy();
    write(ws, "a.txt", "changed");
    write(ws, "src/new.ts", "x");
    const { rmSync } = await import("node:fs");
    rmSync(path.join(ws, "b.txt"));
    expect((await changedSince(ws, "s1", 1))?.sort()).toEqual(["a.txt", "b.txt", "src/new.ts"]);
    expect(await changedSince(ws, "s1", 2)).toBeNull();
  });
});

describe("verify after a turn", () => {
  /** Fake backend: each send ends a turn; the first one "edits" a.txt. */
  async function setup(opts: { permission?: string; unattended?: boolean; userVerify?: string; repoVerify?: string }) {
    const home = tmp("v-home-");
    const ws = tmp("v-ws-");
    if (opts.userVerify) write(home, `projects/${path.basename(ws)}/verify.yaml`, opts.userVerify);
    if (opts.repoVerify) write(ws, ".silence/verify.yaml", opts.repoVerify);
    const sent: UserMessage[] = [];
    let hooks: BackendHooks | undefined;
    const fake: Backend = {
      info: { id: "fake", version: "0", capabilities: {} as never },
      start: async (_o, h) => {
        hooks = h;
        return {
          send: async (m) => {
            sent.push(m);
            setTimeout(() => {
              if (sent.length === 1) hooks!.emit({ type: "tool.start", callId: "t1", name: "edit", args: { path: "a.txt" } });
              hooks!.emit({ type: "turn.end", stop: "completed", durationMs: 1 });
            }, 5);
          },
          interrupt: async () => {},
          close: async () => {},
        };
      },
    };
    const core = createCoreWithSessions({ host: "test", dataDir: tmp("v-data-"), home, sessions: { backends: { claude: fake }, listExternal: async () => [], snapshot: async () => null } });
    const [a, b] = memoryPair();
    core.server.attach(a);
    const client = new RpcClient(b);
    const events: Array<Record<string, unknown>> = [];
    client.onNotification((m, p) => m === "session.event" && events.push((p as { event: Record<string, unknown> }).event));
    const { session_id } = await client.call<{ session_id: string }>("session.create", { workspace: ws, permission: opts.permission ?? "auto", unattended: opts.unattended });
    const until = async (pred: () => boolean) => {
      for (let i = 0; i < 400 && !pred(); i++) await new Promise((r) => setTimeout(r, 25));
    };
    return { client, session_id, events, sent, until, ws };
  }

  it("passes: one verify event, then done", async () => {
    const t = await setup({ userVerify: `rules:\n  - when: ['*.txt']\n    run: ${JSON.stringify(node("console.log('ok')"))}\n` });
    await t.client.call("session.prompt", { session_id: t.session_id, text: "go" });
    await t.until(() => t.events.some((e) => e.type === "done"));
    const kinds = t.events.map((e) => e.type);
    expect(kinds.indexOf("verify")).toBeLessThan(kinds.indexOf("done"));
    expect(t.events.find((e) => e.type === "verify")).toMatchObject({ ok: true, round: 0, final: true, source: "user", changed: 1 });
    expect(t.sent).toHaveLength(1);
  }, 30_000);

  it("fails: sends the errors back at most twice, then reports and ends the turn", async () => {
    const t = await setup({ userVerify: `rules:\n  - when: ['*.txt']\n    run: ${JSON.stringify(node("console.error('boom'); process.exit(1)"))}\n` });
    await t.client.call("session.prompt", { session_id: t.session_id, text: "go" });
    await t.until(() => t.events.some((e) => e.type === "done"));
    const v = t.events.filter((e) => e.type === "verify");
    expect(v.map((e) => [e.ok, e.round, e.final])).toEqual([
      [false, 0, false],
      [false, 1, false],
      [false, 2, true],
    ]);
    expect(t.sent).toHaveLength(3);
    expect(t.sent[1]!.text).toContain("[5ilence verify]");
    expect(t.sent[1]!.text).toContain("boom");
    expect(t.events.filter((e) => e.type === "done")).toHaveLength(1);
  }, 60_000);

  it("a fix that puts the file back as it was is still checked again (git snapshot sees no change)", async () => {
    const home = tmp("v-home-");
    const ws = tmp("v-ws-git-");
    execFileSync("git", ["init", "-q"], { cwd: ws });
    write(ws, "a.txt", "ok\n");
    write(home, `projects/${path.basename(ws)}/verify.yaml`, `rules:\n  - when: ['*.txt']\n    run: ${JSON.stringify(node("process.exit(require('fs').readFileSync('a.txt','utf8').includes('bad')?1:0)"))}\n`);
    const sent: UserMessage[] = [];
    let hooks: BackendHooks | undefined;
    const fake: Backend = {
      info: { id: "fake", version: "0", capabilities: {} as never },
      start: async (_o, h) => {
        hooks = h;
        return {
          send: async (m) => {
            sent.push(m);
            setTimeout(() => {
              // Turn: break a.txt. Fix round: put it back exactly as it was at the turn's start.
              write(ws, "a.txt", sent.length === 1 ? "bad\n" : "ok\n");
              hooks!.emit({ type: "tool.start", callId: `t${sent.length}`, name: "edit", args: { path: "a.txt" } });
              hooks!.emit({ type: "turn.end", stop: "completed", durationMs: 1 });
            }, 5);
          },
          interrupt: async () => {},
          close: async () => {},
        };
      },
    };
    const core = createCoreWithSessions({ host: "test", dataDir: tmp("v-data-"), home, sessions: { backends: { claude: fake }, listExternal: async () => [] } });
    const [a, b] = memoryPair();
    core.server.attach(a);
    const client = new RpcClient(b);
    const events: Array<Record<string, unknown>> = [];
    client.onNotification((m, p) => m === "session.event" && events.push((p as { event: Record<string, unknown> }).event));
    const { session_id } = await client.call<{ session_id: string }>("session.create", { workspace: ws, permission: "auto" });
    await client.call("session.prompt", { session_id, text: "go" });
    for (let i = 0; i < 400 && !events.some((e) => e.type === "done"); i++) await new Promise((r) => setTimeout(r, 25));
    const v = events.filter((e) => e.type === "verify");
    expect(v.map((e) => [e.ok, e.round, e.final])).toEqual([
      [false, 0, false],
      [true, 1, true],
    ]);
    expect(sent).toHaveLength(2);
  }, 60_000);

  it("a repo's verify command asks first; Always allow approves it for next time", async () => {
    const cmd = node("console.log('repo')");
    const t = await setup({ repoVerify: `rules:\n  - when: ['*.txt']\n    run: ${JSON.stringify(cmd)}\n` });
    await t.client.call("session.prompt", { session_id: t.session_id, text: "go" });
    await t.until(() => t.events.some((e) => e.type === "permission"));
    const card = t.events.find((e) => e.type === "permission") as { request_id: string; risk: Record<string, unknown> };
    expect(card.risk).toMatchObject({ source: "verify", allow_rule: cmd });
    expect(card.risk.deny_rule).toBeUndefined();
    await t.client.call("session.permission", { session_id: t.session_id, request_id: card.request_id, decision: "allow_always" });
    await t.until(() => t.events.some((e) => e.type === "done"));
    expect(t.events.find((e) => e.type === "verify")).toMatchObject({ ok: true, source: "repo" });

    // Next turn (same workspace, files edited again): approved, so no card.
    t.events.length = 0;
    t.sent.length = 0;
    await t.client.call("session.prompt", { session_id: t.session_id, text: "again" });
    await t.until(() => t.events.some((e) => e.type === "done"));
    expect(t.events.some((e) => e.type === "permission")).toBe(false);
    expect(t.events.find((e) => e.type === "verify")).toMatchObject({ ok: true });
  }, 60_000);

  it("unattended: an unapproved repo command is skipped, not run", async () => {
    const t = await setup({ unattended: true, repoVerify: `rules:\n  - when: ['*.txt']\n    run: ${JSON.stringify(node("process.exit(1)"))}\n` });
    await t.client.call("session.prompt", { session_id: t.session_id, text: "go" });
    await t.until(() => t.events.some((e) => e.type === "done"));
    const v = t.events.find((e) => e.type === "verify") as { ok: boolean; checks: Array<{ skipped?: string }> };
    expect(v.ok).toBe(true);
    expect(v.checks[0]!.skipped).toContain("unattended");
    expect(t.sent).toHaveLength(1);
  }, 30_000);

  it("Ask mode does not verify", async () => {
    const t = await setup({ permission: "ask", userVerify: `rules:\n  - when: ['**']\n    run: ${JSON.stringify(node("process.exit(1)"))}\n` });
    await t.client.call("session.prompt", { session_id: t.session_id, text: "go" });
    await t.until(() => t.events.some((e) => e.type === "done"));
    expect(t.events.some((e) => e.type === "verify")).toBe(false);
  }, 30_000);
});

describe("VerifyApprovals", () => {
  it("approves a command per workspace", async () => {
    const ap = new VerifyApprovals(tmp("v-data-"));
    const ws = tmp("v-ws-");
    expect(await ap.isApproved(ws, "npm test")).toBe(false);
    await ap.approve(ws, "npm test");
    expect(await ap.isApproved(ws, "npm test")).toBe(true);
    expect(await ap.isApproved(ws, "npm test -- --watch")).toBe(false);
    expect(await ap.isApproved(tmp("v-ws-"), "npm test")).toBe(false);
  });
});
