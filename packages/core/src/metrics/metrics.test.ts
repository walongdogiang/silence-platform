import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RpcClient } from "../api/jsonrpc.js";
import { memoryPair } from "../api/transport.js";
import { createCoreWithSessions } from "../core.js";
import { EventLog, type LogRecord } from "../store/eventLog.js";
import { coreSessionMetrics, externalSessionMetrics, localDay, summarize, transcriptLines, type TranscriptMessage } from "./metrics.js";

const tmp = (p: string) => mkdtempSync(path.join(os.tmpdir(), p));
let seq = 0;
const rec = (body: LogRecord["body"], ts = "2026-11-20T10:00:00.000Z"): LogRecord => ({ v: 1, seq: ++seq, ts, session: "s1", body });
const usage = (i: number, o: number, usd = 0.01) => rec({ type: "event", event: { type: "usage", inputTokens: i, outputTokens: o, cacheRead: 5, cacheWrite: 0, usd, usdKind: "estimate", model: "" } });

describe("coreSessionMetrics", () => {
  it("counts turns, false done, fix rounds, repeats, tokens and the last quota", () => {
    const recs = [
      rec({ type: "session.start", cwd: "D:/w/shop", backend: "claude", mode: "agent" }),
      rec({ type: "user", text: "Add a test" }),
      usage(10, 20),
      rec({ type: "verify", ok: false, commands: ["npm test"] }),
      rec({ type: "verify", ok: false, commands: ["npm test"] }),
      rec({ type: "verify", ok: true, commands: ["npm test"] }),
      rec({ type: "user", text: "add a test " }),
      usage(1, 2),
      rec({ type: "verify", ok: true, commands: ["npm test"] }),
      rec({ type: "user", text: "Now docs" }),
      rec({ type: "event", event: { type: "quota", status: "warning", utilization: 0.8, window: "five_hour" } }, "2026-11-20T11:00:00.000Z"),
    ];
    const m = coreSessionMetrics("s1", recs)!;
    expect(m.project).toBe("shop");
    expect(m.totals).toMatchObject({ sessions: 1, turns: 3, verifiedTurns: 2, falseDone: 1, fixRounds: 2, repeats: 1, inputTokens: 11, outputTokens: 22, cacheReadTokens: 10 });
    expect(m.totals.usd).toBeCloseTo(0.02);
    expect(m.quota).toMatchObject({ status: "warning", utilization: 0.8, window: "five_hour" });
    expect(coreSessionMetrics("x", [rec({ type: "user", text: "no start" })])).toBeNull();
  });
});

describe("outside sessions", () => {
  const msgs: TranscriptMessage[] = [
    { type: "user", message: { role: "user", content: "Fix the build" } },
    { type: "assistant", message: { id: "m1", usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 7 }, content: [{ type: "text", text: "Looking." }] } },
    { type: "assistant", message: { id: "m1", usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: "tool_use", id: "t", name: "Bash", input: {} }] } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] } },
    { type: "assistant", message: { id: "m2", usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: "text", text: "Fixed." }] } },
    { type: "user", message: { role: "user", content: "<command-name>/clear</command-name>" } },
    { type: "user", message: { role: "user", content: [{ type: "text", text: "fix the build" }] } },
    { type: "assistant", message: { id: "s", usage: { input_tokens: 999, output_tokens: 999 }, content: [] }, parent_tool_use_id: "t" },
  ];

  it("count typed turns, repeats and each API response's tokens once", () => {
    const m = externalSessionMetrics("e1", "C:/x/blog", Date.UTC(2026, 10, 19, 12), msgs);
    expect(m.project).toBe("blog");
    expect(m.totals).toMatchObject({ sessions: 1, turns: 2, repeats: 1, inputTokens: 110, outputTokens: 55, cacheReadTokens: 7, falseDone: 0, verifiedTurns: 0 });
  });

  it("render as user / assistant text for the read-only view", () => {
    expect(transcriptLines(msgs)).toEqual([
      { role: "user", text: "Fix the build" },
      { role: "assistant", text: "Looking.\n\nFixed." },
      { role: "user", text: "fix the build" },
    ]);
  });
});

describe("summarize", () => {
  it("keeps the last N days, groups by day (newest first) and project", () => {
    const today = new Date(2026, 10, 22, 12);
    const t = (turns: number) => ({ sessions: 1, turns, falseDone: 0, verifiedTurns: 0, fixRounds: 0, repeats: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, usd: 0 });
    const s = summarize(
      [
        { id: "a", project: "shop", day: "2026-11-22", totals: t(3) },
        { id: "b", project: "blog", day: "2026-11-01", totals: t(9) },
      ],
      [{ id: "e", project: "shop", day: "2026-11-21", totals: t(4) }],
      7,
      today,
    );
    expect(s.core.turns).toBe(3);
    expect(s.external.turns).toBe(4);
    expect(s.byDay.map((d) => d.day)).toEqual(["2026-11-22", "2026-11-21"]);
    expect(s.byProject).toEqual([{ project: "shop", core: expect.objectContaining({ turns: 3 }), external: expect.objectContaining({ turns: 4 }) }]);
  });
});

describe("metrics RPC", () => {
  it("summarises core sessions and outside ones, leaving out 5ilence's own and lesson calls", async () => {
    const dataDir = tmp("m-data-");
    const home = tmp("m-home-");
    const log = new EventLog(dataDir);
    const now = new Date().toISOString();
    await log.append("c1", { type: "session.start", cwd: "D:/w/shop", backend: "claude", mode: "agent" });
    await log.append("c1", { type: "session.backend", backendSessionId: "b-own" });
    await log.append("c1", { type: "user", text: "hi" });
    const read: string[] = [];
    const modified = Date.now() - 60_000;
    const core = createCoreWithSessions({
      host: "test",
      dataDir,
      home,
      sessions: {
        backends: {},
        listExternal: async () => [
          { sessionId: "b-own", summary: "started by 5ilence", lastModified: modified, cwd: "D:/w/shop" },
          { sessionId: "lesson-call", summary: "lesson", lastModified: modified, cwd: home },
          { sessionId: "ext-1234", summary: "from terminal", lastModified: modified, cwd: "D:/w/shop" },
        ],
        externalMessages: async (id) => {
          read.push(id);
          return [{ type: "user", message: { content: "do it" } }];
        },
      },
    });
    const [a, b] = memoryPair();
    core.server.attach(a);
    const client = new RpcClient(b);
    const ext = await client.call<{ sessions: Array<{ backend_session_id: string }> }>("session.external", {});
    expect(ext.sessions.map((s) => s.backend_session_id)).toEqual(["ext-1234"]);
    const sum = await client.call<{ core: { turns: number }; external: { turns: number }; byDay: Array<{ day: string }> }>("metrics.summary", { days: 7 });
    expect(sum.core.turns).toBe(1);
    expect(sum.external.turns).toBe(1);
    expect(sum.byDay[0]!.day).toBe(localDay(now));
    await client.call("metrics.summary", { days: 7 });
    expect(read).toEqual(["ext-1234"]); // cached until the transcript changes
    await expect(client.call("session.external_messages", { backend_session_id: "ext-1234" })).resolves.toEqual({ lines: [{ role: "user", text: "do it" }] });
    await expect(client.call("session.external_messages", { backend_session_id: "../x" })).rejects.toThrow(/required/);
  });

  it("reads many outside transcripts at once (bounded), counts each one, and skips an unreadable one", async () => {
    const modified = Date.now() - 60_000;
    const ids = Array.from({ length: 40 }, (_, i) => `ext-${String(i).padStart(4, "0")}`);
    let running = 0;
    let peak = 0;
    const core = createCoreWithSessions({
      host: "test",
      dataDir: tmp("m-data-"),
      home: tmp("m-home-"),
      sessions: {
        backends: {},
        listExternal: async () => ids.map((id) => ({ sessionId: id, summary: id, lastModified: modified, cwd: "D:/w/shop" })),
        externalMessages: async (id) => {
          running++;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 5));
          running--;
          if (id === "ext-0007") throw new Error("unreadable");
          return [{ type: "user", message: { content: "do it" } }];
        },
      },
    });
    const [a, b] = memoryPair();
    core.server.attach(a);
    const client = new RpcClient(b);
    const sum = await client.call<{ external: { turns: number } }>("metrics.summary", { days: 7 });
    expect(sum.external.turns).toBe(39);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
  });
});
