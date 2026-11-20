import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AuditLog } from "./audit.js";
import { EventLog } from "./eventLog.js";
import { readJsonl } from "./jsonl.js";
import { redact, redactValue } from "./redact.js";
import { listSnapshots, restoreSnapshot, takeSnapshot, KEEP_SNAPSHOTS } from "../git/snapshot.js";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "core-store-"));

describe("redact", () => {
  it("masks keys, tokens and bearer headers", () => {
    expect(redact("api_key=abcdefgh1234 rest")).toBe("[REDACTED] rest");
    expect(redact("use sk-ABCDEFGHIJKLMNOPQRST now")).toBe("use [REDACTED] now");
    expect(redact("Authorization: Bearer abc.def-ghi")).toContain("[REDACTED]");
    expect(redact("plain text")).toBe("plain text");
    expect(redactValue({ a: ["token: 12345678abc"], n: 3 })).toEqual({ a: ["[REDACTED]"], n: 3 });
  });
});

describe("EventLog", () => {
  it("appends with increasing seq, redacts, and survives a restart", async () => {
    const dir = tmp();
    const log = new EventLog(dir);
    await log.append("s1", { type: "session.start", cwd: "D:/x", backend: "claude", mode: "agent" });
    await Promise.all([log.append("s1", { type: "user", text: "hello" }), log.append("s1", { type: "user", text: "password=supersecret99" })]);
    const again = new EventLog(dir);
    await again.append("s1", { type: "session.backend", backendSessionId: "b-1" });
    const recs = await again.read("s1");
    expect(recs.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
    expect(JSON.stringify(recs)).not.toContain("supersecret99");
    const [sum] = await again.list();
    expect(sum).toMatchObject({ id: "s1", backend: "claude", records: 4, backendSessionId: "b-1" });
  });

  it("skips a torn last line and rejects unsafe session ids", async () => {
    const dir = tmp();
    const log = new EventLog(dir);
    await log.append("s2", { type: "user", text: "a" });
    appendFileSync(log.file("s2"), '{"v":1,"seq":2,');
    expect((await readJsonl(log.file("s2"))).length).toBe(1);
    expect(() => log.file("../evil")).toThrow(/invalid session id/);
  });
});

describe("AuditLog", () => {
  it("appends in order and filters by session", async () => {
    const audit = new AuditLog(tmp());
    await audit.append({ session: "a", kind: "tool", tool: "shell", detail: { command: "echo token=abcdefghijk" } });
    await audit.append({ session: "b", kind: "cost", usd: 0.01 });
    expect((await audit.query()).map((e) => e.kind)).toEqual(["tool", "cost"]);
    const [a] = await audit.query("a");
    expect(JSON.stringify(a)).not.toContain("abcdefghijk");
  });
});

describe("git snapshots", () => {
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();

  it("snapshots and restores without touching HEAD or the index", async () => {
    const root = tmp();
    git(root, "init", "-q");
    git(root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
    writeFileSync(path.join(root, "a.txt"), "one\n");
    git(root, "add", "a.txt");
    const headBefore = git(root, "rev-parse", "HEAD");
    const statusBefore = git(root, "status", "--porcelain");

    expect(await takeSnapshot(root, "sess", 1)).toBe("refs/silence/snap/sess/1");
    expect(git(root, "rev-parse", "HEAD")).toBe(headBefore);
    expect(git(root, "status", "--porcelain")).toBe(statusBefore);

    writeFileSync(path.join(root, "a.txt"), "two\n");
    await restoreSnapshot(root, "sess", 1);
    expect(readFileSync(path.join(root, "a.txt"), "utf8").replace(/\r\n/g, "\n")).toBe("one\n");
    await expect(restoreSnapshot(root, "sess", 9)).rejects.toThrow(/no snapshot/);
  });

  it("keeps the newest snapshots only, and returns null outside git", async () => {
    const root = tmp();
    git(root, "init", "-q");
    writeFileSync(path.join(root, "f.txt"), "x");
    for (let t = 1; t <= KEEP_SNAPSHOTS + 2; t++) await takeSnapshot(root, "s", t);
    const turns = await listSnapshots(root, "s");
    expect(turns.length).toBe(KEEP_SNAPSHOTS);
    expect(turns[0]).toBe(3);
    expect(await takeSnapshot(tmp(), "s", 1)).toBeNull();
  }, 60_000);
});
