// Session manager end to end over JSON-RPC, with ClaudeBackend driven by a scripted fake `query`
// (no model call, no quota): Risk Engine decisions, permission round trip, logs, snapshots, list.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Options, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { RpcClient } from "../api/jsonrpc.js";
import { memoryPair } from "../api/transport.js";
import { ClaudeBackend, type QueryFn } from "../backends/claude/index.js";
import type { Backend, BackendHooks, ToolCall } from "../backends/types.js";
import { createCoreWithSessions } from "../core.js";
import { AuditLog } from "../store/audit.js";
import { EventLog } from "../store/eventLog.js";
import { applyEdit, parseImages, type ClientEvent } from "./manager.js";

const tmp = (p: string) => mkdtempSync(path.join(os.tmpdir(), p));

type Hook = (name: string, input: Record<string, unknown>, id: string) => Promise<{ hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } }>;
type Script = (ctx: { options: Options; input: AsyncIterator<SDKUserMessage>; hook: Hook }) => AsyncGenerator<Record<string, unknown>>;

const init = { type: "system", subtype: "init", session_id: "b-1", model: "claude-haiku-5-5", tools: ["Bash"], claude_code_version: "2.1.327", apiKeySource: "none" };
const result = { type: "result", subtype: "success", usage: { input_tokens: 5, output_tokens: 7 }, total_cost_usd: 0.01, duration_ms: 10, stop_reason: "end_turn" };
const text = (t: string) => ({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", delta: { type: "text_delta", text: t } } });

function setup(script: Script, opts: { unattended?: boolean; mode?: string; external?: Array<{ sessionId: string; summary: string; lastModified: number; cwd?: string }> } = {}) {
  const home = tmp("core-home-");
  writeFileSync(path.join(home, "profile.md"), "Tôi là một lập trình viên.\n");
  mkdirSync(path.join(home, "plugin", ".claude-plugin"), { recursive: true });
  writeFileSync(path.join(home, "plugin", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "me" }));
  const ws = tmp("core-ws-");
  writeFileSync(path.join(ws, "a.txt"), "hello world\n");
  const dataDir = tmp("core-data-");
  const calls = { interrupt: 0, close: 0, snapshots: [] as number[], modes: [] as string[], models: [] as Array<string | undefined> };
  let seen: Options | undefined;
  const queryFn: QueryFn = ({ prompt, options }) => {
    seen = options;
    const matcher = options.hooks!.PreToolUse![0]!;
    const hook: Hook = (tool_name, tool_input, tool_use_id) =>
      matcher.hooks[0]!({ hook_event_name: "PreToolUse", tool_name, tool_input, tool_use_id, session_id: "b-1", transcript_path: "", cwd: ws } as never, tool_use_id, { signal: new AbortController().signal }) as never;
    const gen = script({ options, input: prompt[Symbol.asyncIterator](), hook });
    return Object.assign(gen, {
      interrupt: async () => void calls.interrupt++,
      close: () => void calls.close++,
      setPermissionMode: async (m: string) => void calls.modes.push(m),
      setModel: async (m?: string) => void calls.models.push(m),
    }) as unknown as Query;
  };
  let n = 0;
  const core = createCoreWithSessions({
    host: "test",
    dataDir,
    home,
    sessions: {
      backends: { claude: new ClaudeBackend({ queryFn, env: {} }) },
      listExternal: async () => opts.external ?? [],
      snapshot: async (_root, _s, turn) => {
        calls.snapshots.push(turn);
        return `refs/silence/snap/x/${turn}`;
      },
      newId: () => `core-${++n}`,
    },
  });
  const [a, b] = memoryPair();
  core.server.attach(a);
  const client = new RpcClient(b);
  const events: ClientEvent[] = [];
  const waiters: Array<{ pred: (e: ClientEvent) => boolean; resolve: (e: ClientEvent) => void }> = [];
  client.onNotification((method, params) => {
    if (method !== "session.event") return;
    const ev = (params as { event: ClientEvent }).event;
    events.push(ev);
    for (const w of [...waiters]) if (w.pred(ev)) waiters.splice(waiters.indexOf(w), 1), w.resolve(ev);
  });
  const next = (pred: (e: ClientEvent) => boolean) =>
    new Promise<ClientEvent>((resolve) => {
      const hit = events.find(pred);
      if (hit) resolve(hit);
      else waiters.push({ pred, resolve });
    });
  const start = async () => {
    const { session_id } = await client.call<{ session_id: string }>("session.create", { workspace: ws, unattended: opts.unattended, mode: opts.mode });
    return session_id;
  };
  return { client, core, events, next, start, calls, ws, dataDir, home, options: () => seen! };
}

describe("SessionManager", () => {
  it("runs a turn: profile/plugin in options, Risk Engine decides, user answers an ask, logs and snapshot", async () => {
    const outs: unknown[] = [];
    const t = setup(async function* ({ input, hook }) {
      await input.next();
      yield init;
      yield text("Xin ");
      outs.push(await hook("Read", { file_path: "a.txt" }, "t1"));
      outs.push(await hook("Bash", { command: "git push origin main" }, "t2"));
      outs.push(await hook("Bash", { command: "npm install lodash" }, "t3"));
      outs.push(await hook("Edit", { file_path: "a.txt", old_string: "world", new_string: "5ilence" }, "t4"));
      yield { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "hello world" }] } };
      yield text("chào");
      yield result;
    });
    const sid = await t.start();
    expect(sid).toBe("core-1");
    const o = t.options();
    expect(o.systemPrompt).toMatchObject({ append: "Tôi là một lập trình viên." });
    expect(o.plugins).toEqual([{ type: "local", path: path.join(t.home, "plugin") }]);
    expect(o.cwd).toBe(path.resolve(t.ws));

    await t.client.call("session.prompt", { session_id: sid, text: "làm đi" });
    const perm = await t.next((e) => e.type === "permission");
    if (perm.type !== "permission") throw new Error("unreachable");
    expect(perm.name).toBe("Bash");
    expect(perm.input).toEqual({ command: "npm install lodash" });
    expect(perm.risk?.tier).toBe("ask");
    expect(perm.risk?.pattern).toBe("npm install *");
    await expect(t.client.call("session.permission", { session_id: sid, request_id: perm.request_id, allow: true })).resolves.toEqual({ ok: true });
    await t.next((e) => e.type === "done");

    expect(outs.map((x) => (x as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput.permissionDecision)).toEqual(["allow", "deny", "allow", "allow"]);
    expect((outs[1] as { hookSpecificOutput: { permissionDecisionReason: string } }).hookSpecificOutput.permissionDecisionReason).toContain("GIT_PUSH_DEFAULT");
    const types = t.events.map((e) => e.type);
    expect(types).toContain("token");
    expect(types).toContain("tool_start");
    expect(types).toContain("tool_end");
    expect(types).toContain("cost");
    expect(types.at(-1)).toBe("done");
    expect(t.events.find((e) => e.type === "tool_end")).toMatchObject({ call_id: "t1", name: "read", ok: true });
    expect(t.events.find((e) => e.type === "diff")).toMatchObject({ path: path.join(path.resolve(t.ws), "a.txt"), before: "hello world\n", after: "hello 5ilence\n", applied: true });
    expect(t.calls.snapshots).toEqual([1]);

    await t.core.sessions.settle();
    const recs = await new EventLog(t.dataDir).read(sid);
    const decisions = recs.flatMap((r) => (r.body.type === "decision" ? [r.body] : []));
    expect(decisions.map((d) => [d.tool, d.action, d.by])).toEqual([
      ["Read", "allow", "policy"],
      ["Bash", "deny", "policy"],
      ["Bash", "allow", "user"],
      ["Edit", "allow", "policy"],
    ]);
    expect(recs.some((r) => r.body.type === "session.backend" && r.body.backendSessionId === "b-1")).toBe(true);
    expect(recs.some((r) => r.body.type === "event" && (r.body.event as { type: string }).type === "text.delta")).toBe(false);
    const audit = await new AuditLog(t.dataDir).query(sid);
    expect(audit.filter((e) => e.kind === "decision")).toHaveLength(4);
    expect(audit.some((e) => e.kind === "usage" && e.usd === 0.01)).toBe(true);
    expect(audit.some((e) => e.kind === "snapshot")).toBe(true);
  });

  it("denies an ask without a permission card when unattended", async () => {
    const outs: unknown[] = [];
    const t = setup(
      async function* ({ input, hook }) {
        await input.next();
        yield init;
        outs.push(await hook("Bash", { command: "npm install lodash" }, "t1"));
        yield result;
      },
      { unattended: true },
    );
    const sid = await t.start();
    await t.client.call("session.prompt", { session_id: sid, text: "x" });
    await t.next((e) => e.type === "done");
    expect(t.events.some((e) => e.type === "permission")).toBe(false);
    expect(outs[0]).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: expect.stringContaining("human approval") } });
  });

  it("ask mode refuses writes but allows reads", async () => {
    const outs: unknown[] = [];
    const t = setup(
      async function* ({ input, hook }) {
        await input.next();
        yield init;
        outs.push(await hook("Write", { file_path: "b.txt", content: "x" }, "t1"));
        outs.push(await hook("Read", { file_path: "a.txt" }, "t2"));
        yield result;
      },
      { mode: "ask" },
    );
    const sid = await t.start();
    await t.client.call("session.prompt", { session_id: sid, text: "x" });
    await t.next((e) => e.type === "done");
    expect(outs.map((x) => (x as { hookSpecificOutput: { permissionDecision: string } }).hookSpecificOutput.permissionDecision)).toEqual(["deny", "allow"]);
  });

  it("abort while a permission is pending denies it and interrupts the backend", async () => {
    const outs: unknown[] = [];
    const t = setup(async function* ({ input, hook }) {
      await input.next();
      yield init;
      outs.push(await hook("Bash", { command: "npm install lodash" }, "t1"));
      yield { ...result, subtype: "error_during_execution" };
    });
    const sid = await t.start();
    await t.client.call("session.prompt", { session_id: sid, text: "x" });
    await t.next((e) => e.type === "permission");
    await t.client.call("session.abort", { session_id: sid });
    const done = await t.next((e) => e.type === "done");
    expect(done).toEqual({ type: "done", stop: "interrupted" });
    expect(t.calls.interrupt).toBe(1);
    expect(outs[0]).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });

  it("a failure while deciding is a deny", async () => {
    let hooks: BackendHooks | undefined;
    const fake: Backend = {
      info: { id: "fake", version: "0", capabilities: {} as never },
      start: async (_o, h) => {
        hooks = h;
        return { send: async () => {}, interrupt: async () => {}, close: async () => {} };
      },
    };
    const core = createCoreWithSessions({ host: "test", dataDir: tmp("core-data-"), home: tmp("core-home-"), sessions: { backends: { claude: fake }, listExternal: async () => [] } });
    await core.sessions.create({ workspace: tmp("core-ws-") });
    // Args whose getter throws make classify fail: the call must be denied, never allowed.
    const args = Object.defineProperty({}, "command", { enumerable: true, get: () => { throw new Error("boom"); } });
    const bad = { callId: "x", kind: "shell", name: "shell", args, raw: { tool: "Bash", input: {} }, cwd: "." } as ToolCall;
    await expect(hooks!.decide(bad)).resolves.toMatchObject({ action: "deny", reason: expect.stringContaining("boom") });
  });

  it("lists core sessions and external ones not already known", async () => {
    const t = setup(
      async function* ({ input }) {
        await input.next();
        yield init;
        yield result;
      },
      { external: [{ sessionId: "b-1", summary: "known", lastModified: 1 }, { sessionId: "ext-9", summary: "from terminal", lastModified: Date.UTC(2026, 10, 1), cwd: "D:/x" }] },
    );
    const sid = await t.start();
    await t.client.call("session.prompt", { session_id: sid, text: "x" });
    await t.next((e) => e.type === "done");
    const res = await t.client.call<{ sessions: Array<{ session_id: string; live: boolean; backend_session_id?: string }>; external: Array<{ backend_session_id: string; title: string }> }>("session.list", {});
    expect(res.sessions).toEqual([expect.objectContaining({ session_id: sid, live: true, backend_session_id: "b-1" })]);
    expect(res.external).toEqual([expect.objectContaining({ backend_session_id: "ext-9", title: "from terminal", workspace: "D:/x" })]);
    await t.client.call("session.close", { session_id: sid });
    expect(t.calls.close).toBe(1);
    await expect(t.client.call("session.prompt", { session_id: sid, text: "x" })).rejects.toThrow(/unknown session/);
  });

  it("set_mode reaches the backend and switches ask-mode enforcement; set_model too", async () => {
    const outs: unknown[] = [];
    const t = setup(async function* ({ input, hook }) {
      await input.next();
      yield init;
      outs.push(await hook("Write", { file_path: "b.txt", content: "x" }, "t1"));
      yield result;
    });
    const sid = await t.start();
    await t.client.call("session.set_mode", { session_id: sid, mode: "ask" });
    await t.client.call("session.set_model", { session_id: sid, model: "haiku" });
    expect(t.calls.modes).toEqual(["default"]);
    expect(t.calls.models).toEqual(["haiku"]);
    await t.client.call("session.prompt", { session_id: sid, text: "x" });
    await t.next((e) => e.type === "done");
    expect(outs[0]).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });

  it("refuses yolo and a missing workspace", async () => {
    const t = setup(async function* () {});
    await expect(t.client.call("session.create", { workspace: t.ws, permission: "yolo" })).rejects.toThrow(/yolo/);
    await expect(t.client.call("session.create", {})).rejects.toThrow(/workspace/);
  });
});

describe("helpers", () => {
  const call = (kind: string, args: Record<string, unknown>) => ({ kind, args }) as unknown as ToolCall;
  it("applyEdit computes write, edit, replace-all and multi-edit results", () => {
    expect(applyEdit(call("write", { content: "new" }), "old")).toBe("new");
    expect(applyEdit(call("edit", { old: "a", new: "b" }), "a a")).toBe("b a");
    expect(applyEdit(call("edit", { old: "a", new: "b", replaceAll: true }), "a a")).toBe("b b");
    expect(applyEdit(call("edit", { old: "$&", new: "$1" }), "x$&")).toBe("x$1");
    expect(applyEdit(call("edit", { old: "zz", new: "b" }), "a")).toBeNull();
    expect(applyEdit(call("edit", { edits: [{ old_string: "a", new_string: "b" }, { old_string: "b c", new_string: "d" }] }), "a c")).toBe("d");
  });
  it("parseImages accepts data URLs and rejects anything else", () => {
    expect(parseImages(["data:image/png;base64,AAAA"])).toEqual([{ mediaType: "image/png", data: "AAAA" }]);
    expect(() => parseImages(["file:///etc/passwd"])).toThrow(/data URLs/);
    expect(parseImages(undefined)).toEqual([]);
  });
});
