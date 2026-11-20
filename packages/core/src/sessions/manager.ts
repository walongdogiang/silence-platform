// Session manager (roadmap 1.5b): owns core sessions, drives a Backend, and is the one place that
// decides tool calls (Risk Engine → Balanced policy → ask the user). Writes the event log, audit
// trail and per-turn git snapshots, and turns backend events into `session.event` for clients.
// Spec: docs/adapters/protocol.md, docs/security/permissions.md.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { RpcFailure, ErrorCodes, type CallContext } from "../api/jsonrpc.js";
import type { Backend, BackendEvent, Decision, Effort, Mode, SessionHandle, ToolCall } from "../backends/types.js";
import { takeSnapshot } from "../git/snapshot.js";
import { classify, shellPattern, type Verdict } from "../risk/classify.js";
import type { AuditLog } from "../store/audit.js";
import type { EventLog } from "../store/eventLog.js";
import { loadPersonal, type Personal } from "./personal.js";
import { scanRepoConfig, type RepoApprovals, type RepoReview } from "../repoConfig/review.js";

/** JSON-RPC error: the repo config needs the user's review first (`data.review`: `RepoReview`). */
export const REPO_CONFIG_REVIEW = -32010;

/** `SessionEvent` of `packages/protocol` (subset the core emits). */
export type ClientEvent =
  | { type: "token"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_start"; call_id: string; name: string; input: unknown }
  | { type: "tool_end"; call_id: string; name: string; ok: boolean; output: string }
  | { type: "permission"; request_id: string; name: string; input: unknown; reason: string; risk?: ReturnType<Verdict["toRisk"]> }
  | { type: "plan"; markdown: string }
  | { type: "diff"; path: string; before: string; after: string; applied?: boolean }
  | { type: "trace"; event: string; detail: unknown }
  | { type: "cost"; input_tokens: number; output_tokens: number; usd: number; cache_read_tokens?: number; cache_write_tokens?: number }
  | { type: "done"; stop: string }
  | { type: "error"; message: string; error?: { code: string; retryable: boolean; detail: string } };

/** A session made outside 5ilence (Claude desktop, terminal), from the SDK's `listSessions`. */
export interface ExternalSession {
  sessionId: string;
  summary: string;
  lastModified: number;
  customTitle?: string;
  firstPrompt?: string;
  gitBranch?: string;
  cwd?: string;
}

export interface SessionManagerOptions {
  backends: Record<string, Backend>;
  log: EventLog;
  audit: AuditLog;
  /** `~/.silence`: profile and plugin. */
  home: string;
  /** Lists the backend's own sessions (Claude: SDK `listSessions`). */
  listExternal?: (opts: { dir?: string; limit?: number }) => Promise<ExternalSession[]>;
  /** Approved repo-config hashes (roadmap 1.6). */
  approvals: RepoApprovals;
  /** Injected in tests; default `takeSnapshot`. */
  snapshot?: (root: string, session: string, turn: number) => Promise<string | null>;
  newId?: () => string;
}

interface Pending {
  resolve: (allow: boolean) => void;
  callId: string;
}

interface Session {
  id: string;
  cwd: string;
  backend: string;
  mode: Mode;
  model?: string;
  /** No one is watching: `ask` becomes `deny` (job queue, schedules). */
  unattended: boolean;
  handle: SessionHandle;
  clients: Set<CallContext>;
  pending: Map<string, Pending>;
  toolNames: Map<string, string>;
  turn: number;
  running: boolean;
  /** This turn already took in outside content (web, MCP): the Risk Engine tightens shell calls. */
  tainted: boolean;
  /** Problems found in `~/.silence` at start, shown once with the first turn. */
  personalWarnings: string[];
  /** The backend loads the repo's own config (approved, or nothing to review). */
  projectConfig: boolean;
  /** Hash of the repo config the session started with (empty when none). */
  configHash: string;
}

const DIFF_MAX_BYTES = 512 * 1024;
const UNATTENDED_REASON = "needs human approval; the call was logged for review. Do not retry it; continue without it or stop.";

function toMode(m: unknown): Mode {
  return m === "plan" || m === "ask" ? m : "agent";
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function obj(params: unknown): Record<string, unknown> {
  if (typeof params !== "object" || params === null) throw new RpcFailure(ErrorCodes.InvalidParams, "params must be an object");
  return params as Record<string, unknown>;
}

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  /** Log/audit writes started from events; `list` and `close` wait for them. */
  private readonly inflight = new Set<Promise<unknown>>();

  constructor(private readonly o: SessionManagerOptions) {}

  // ---- RPC ---------------------------------------------------------------------------------

  async create(params: unknown, ctx?: CallContext): Promise<{ session_id: string; personal: PersonalSummary }> {
    const p = obj(params);
    const cwd = str(p.workspace);
    if (!cwd) throw new RpcFailure(ErrorCodes.InvalidParams, "workspace is required");
    if (p.permission === "yolo") throw new RpcFailure(ErrorCodes.InvalidParams, "permission yolo is not allowed over RPC");
    const backendId = str(p.backend) ?? "claude";
    const backend = this.o.backends[backendId];
    if (!backend) throw new RpcFailure(ErrorCodes.InvalidParams, `unknown backend: ${backendId}`);
    const id = (this.o.newId ?? randomUUID)();
    const mode = toMode(p.mode);
    const model = str(p.model);
    const effort = str(p.effort) as Effort | undefined;
    // Read fresh each session: editing ~/.silence applies to the next chat without restarting.
    const personal = await loadPersonal(this.o.home, cwd);
    const resume = str(p.resume_backend_session);
    const unattended = p.unattended === true;
    const review = await scanRepoConfig(cwd);
    let projectConfig = true;
    if (p.repo_config === "ignore") projectConfig = false;
    else if (!(await this.o.approvals.isApproved(review.workspace, review.hash))) {
      if (!unattended) throw reviewNeeded(review);
      projectConfig = false; // nobody to ask: run without the repo's hooks, MCP servers and CLAUDE.md
    }

    const s = {
      id,
      cwd: path.resolve(cwd),
      backend: backendId,
      mode,
      ...(model ? { model } : {}),
      unattended,
      projectConfig,
      configHash: projectConfig ? review.hash : "",
      clients: new Set<CallContext>(ctx ? [ctx] : []),
      pending: new Map(),
      toolNames: new Map(),
      turn: 0,
      running: false,
      tainted: false,
      personalWarnings: personal.warnings,
    } as Omit<Session, "handle"> as Session;
    this.sessions.set(id, s);
    await this.o.log.append(id, { type: "session.start", cwd: s.cwd, backend: backendId, mode, ...(model ? { model } : {}) });
    if (review.hash) {
      this.track(this.o.audit.append({ session: id, kind: "repo_config", detail: { hash: review.hash, items: review.items.length, loaded: projectConfig, by: p.repo_config === "ignore" ? "user" : projectConfig ? "approved" : "unattended" } }));
    }
    try {
      s.handle = await backend.start(
        {
          sessionId: id,
          cwd: s.cwd,
          mode,
          ...(model ? { model } : {}),
          ...(effort && effort !== ("auto" as string) ? { effort } : {}),
          ...(personal.systemAppend ? { systemAppend: personal.systemAppend } : {}),
          ...(personal.plugins.length ? { plugins: personal.plugins } : {}),
          ...(resume ? { resume: { backendSessionId: resume, fork: p.fork === true } } : {}),
          ...(projectConfig ? {} : { projectConfig: false }),
        },
        { decide: (call) => this.decide(s, call), emit: (ev) => this.onEvent(s, ev) },
      );
    } catch (e) {
      this.sessions.delete(id);
      await this.o.log.append(id, { type: "session.end", reason: `start failed: ${e instanceof Error ? e.message : String(e)}` });
      throw e;
    }
    this.track(this.o.audit.append({ session: id, kind: "personal", detail: { ...personalSummary(personal) } }));
    return { session_id: id, personal: personalSummary(personal) };
  }

  /** What `~/.silence` gives a session in `workspace` (profile, project profile, plugin, warnings). */
  async profileStatus(params: unknown): Promise<PersonalSummary> {
    const p = (typeof params === "object" && params !== null ? params : {}) as Record<string, unknown>;
    return personalSummary(await loadPersonal(this.o.home, str(p.workspace)));
  }

  async prompt(params: unknown, ctx?: CallContext): Promise<{ ok: true; turn: number }> {
    const p = obj(params);
    const s = this.get(p.session_id);
    if (ctx) s.clients.add(ctx);
    const text = typeof p.text === "string" ? p.text : "";
    const context = str(p.context);
    if (!text.trim() && !context) throw new RpcFailure(ErrorCodes.InvalidParams, "text is required");
    if (s.running) throw new RpcFailure(ErrorCodes.InvalidRequest, "a turn is already running");
    const images = parseImages(p.images);
    if (s.projectConfig) {
      // The repo config may have changed since the session started (the agent or a pull edited it).
      const review = await scanRepoConfig(s.cwd);
      if (review.hash !== s.configHash) {
        if (!(await this.o.approvals.isApproved(review.workspace, review.hash))) throw reviewNeeded(review);
        s.configHash = review.hash;
      }
    }
    s.turn += 1;
    s.running = true;
    if (s.turn === 1 && s.personalWarnings.length) this.emit(s, { type: "trace", event: "profile", detail: { warnings: s.personalWarnings } });
    s.tainted = false;
    await this.o.log.append(s.id, { type: "user", text });
    try {
      const ref = await (this.o.snapshot ?? takeSnapshot)(s.cwd, s.id, s.turn);
      if (ref) this.track(this.o.audit.append({ session: s.id, kind: "snapshot", detail: { ref, turn: s.turn } }));
    } catch {
      /* no undo point for this turn; the turn still runs */
    }
    try {
      await s.handle.send({ text: context ? `${text}\n\n${context}` : text, ...(images.length ? { images } : {}) });
    } catch (e) {
      s.running = false;
      throw e;
    }
    return { ok: true, turn: s.turn };
  }

  async abort(params: unknown): Promise<{ ok: true }> {
    const s = this.get(obj(params).session_id);
    this.denyPending(s);
    if (s.running) await s.handle.interrupt();
    return { ok: true };
  }

  /** Change the mode for the next tool calls (ask mode is enforced here; plan goes to the backend too). */
  async setMode(params: unknown): Promise<{ ok: true }> {
    const p = obj(params);
    const s = this.get(p.session_id);
    const mode = toMode(p.mode);
    if (mode !== s.mode) {
      s.mode = mode;
      await s.handle.setMode?.(mode);
    }
    return { ok: true };
  }

  /** Change the model; empty means the backend's default. */
  async setModel(params: unknown): Promise<{ ok: true }> {
    const p = obj(params);
    const s = this.get(p.session_id);
    const model = str(p.model);
    if (model !== s.model) {
      await s.handle.setModel?.(model);
      if (model) s.model = model;
      else delete s.model;
    }
    return { ok: true };
  }

  /** What the repo config of `workspace` would run, and whether that exact content is approved. */
  async reviewRepoConfig(params: unknown): Promise<RepoReview & { approved: boolean }> {
    const ws = str(obj(params).workspace);
    if (!ws) throw new RpcFailure(ErrorCodes.InvalidParams, "workspace is required");
    const review = await scanRepoConfig(ws);
    return { ...review, approved: await this.o.approvals.isApproved(review.workspace, review.hash) };
  }

  /** Approve the reviewed config. `hash` must match the config on disk now (no swap after review). */
  async approveRepoConfig(params: unknown): Promise<{ ok: true }> {
    const p = obj(params);
    const ws = str(p.workspace);
    if (!ws) throw new RpcFailure(ErrorCodes.InvalidParams, "workspace is required");
    const review = await scanRepoConfig(ws);
    if (!review.hash) return { ok: true };
    if (p.hash !== review.hash) throw new RpcFailure(REPO_CONFIG_REVIEW, "the repo config changed since it was reviewed", { review });
    await this.o.approvals.approve(review.workspace, review.hash);
    await this.o.audit.append({ session: "", kind: "repo_config.approve", path: review.workspace, detail: { hash: review.hash, items: review.items } });
    return { ok: true };
  }

  /** Answer a `permission` event. */
  permission(params: unknown): { ok: boolean } {
    const p = obj(params);
    const s = this.get(p.session_id);
    const rid = str(p.request_id) ?? "";
    const pending = s.pending.get(rid);
    if (!pending) return { ok: false };
    s.pending.delete(rid);
    pending.resolve(p.allow === true);
    return { ok: true };
  }

  async close(params: unknown): Promise<{ ok: true }> {
    const s = this.get(obj(params).session_id);
    await this.closeSession(s, "closed");
    return { ok: true };
  }

  async list(params: unknown): Promise<{ sessions: unknown[]; external: unknown[] }> {
    const p = (typeof params === "object" && params !== null ? params : {}) as Record<string, unknown>;
    await this.settle();
    const ours = await this.o.log.list();
    const live = new Set(this.sessions.keys());
    const sessions = ours
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map((r) => ({
        session_id: r.id,
        workspace: r.cwd,
        backend: r.backend,
        title: r.title ?? "",
        created_at: r.startedAt,
        updated_at: r.updatedAt,
        live: live.has(r.id),
        ...(r.backendSessionId ? { backend_session_id: r.backendSessionId } : {}),
      }));
    let external: unknown[] = [];
    if (this.o.listExternal && p.external !== false) {
      const known = new Set(ours.map((r) => r.backendSessionId).filter(Boolean));
      try {
        const dir = str(p.workspace);
        const limit = typeof p.limit === "number" ? p.limit : 50;
        external = (await this.o.listExternal({ ...(dir ? { dir } : {}), limit }))
          .filter((x) => !known.has(x.sessionId))
          .map((x) => ({
            backend: "claude",
            backend_session_id: x.sessionId,
            title: x.customTitle || x.summary || x.firstPrompt || "",
            workspace: x.cwd ?? "",
            updated_at: new Date(x.lastModified).toISOString(),
            ...(x.gitBranch ? { git_branch: x.gitBranch } : {}),
          }));
      } catch {
        external = []; // the backend's own store is optional
      }
    }
    return { sessions, external };
  }

  /** End every session (core shutting down): pending decisions become deny. */
  async shutdown(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((s) => this.closeSession(s, "core shutdown")));
  }

  // ---- decisions ---------------------------------------------------------------------------

  /** The core's answer to one tool call. Any failure is a deny, never an allow. */
  async decide(s: Session, call: ToolCall): Promise<Decision> {
    try {
      return await this.decideInner(s, call);
    } catch (e) {
      const reason = `harness error: ${e instanceof Error ? e.message : String(e)}`;
      this.track(this.record(s, call, "error", ["INTERNAL_ERROR"], "deny", "policy"));
      return { action: "deny", reason };
    }
  }

  private async decideInner(s: Session, call: ToolCall): Promise<Decision> {
    const v = classify(call.name, call.args, { workspace: s.cwd, tainted: s.tainted, mcpReadOnly: call.mcp?.readOnly ?? false });

    // Ask mode: read-only. Writes, edits and any shell command that is not plain reading are refused.
    if (s.mode === "ask" && (call.kind === "write" || call.kind === "edit" || (call.kind === "shell" && v.tier !== "auto"))) {
      await this.record(s, call, v.tier, v.codes, "deny", "policy");
      return { action: "deny", reason: "ask mode is read-only: describe the change instead of making it." };
    }

    let allow: boolean;
    let by: "policy" | "user" | "unattended";
    if (v.tier === "block") {
      await this.record(s, call, v.tier, v.codes, "deny", "policy");
      return { action: "deny", reason: v.blockMessage() };
    } else if (v.tier === "ask") {
      if (s.unattended) {
        await this.record(s, call, v.tier, v.codes, "deny", "unattended");
        return { action: "deny", reason: UNATTENDED_REASON };
      }
      allow = await this.askUser(s, call, v);
      by = "user";
    } else {
      allow = true;
      by = "policy";
    }
    await this.record(s, call, v.tier, v.codes, allow ? "allow" : "deny", by);
    if (!allow) return { action: "deny", reason: "the user declined this call. Do not retry it; ask what they want instead." };

    if (call.name === "submit_plan" && typeof call.args.markdown === "string") this.emit(s, { type: "plan", markdown: call.args.markdown });
    if (call.kind === "write" || call.kind === "edit") await this.emitDiff(s, call);
    return { action: "allow" };
  }

  private askUser(s: Session, call: ToolCall, v: Verdict): Promise<boolean> {
    const requestId = randomUUID();
    const pattern = call.kind === "shell" && typeof call.args.command === "string" ? shellPattern(call.args.command) ?? undefined : undefined;
    return new Promise<boolean>((resolve) => {
      s.pending.set(requestId, { resolve, callId: call.callId });
      this.emit(s, { type: "permission", request_id: requestId, name: call.raw.tool, input: call.raw.input, reason: v.title(), risk: v.toRisk(pattern) });
    });
  }

  private denyPending(s: Session): void {
    for (const p of s.pending.values()) p.resolve(false);
    s.pending.clear();
  }

  private async record(s: Session, call: ToolCall, tier: string, codes: string[], action: "allow" | "deny", by: "policy" | "user" | "unattended"): Promise<void> {
    await this.o.log.append(s.id, { type: "decision", callId: call.callId, tool: call.raw.tool, tier, codes, action, by });
    const p = typeof call.args.path === "string" ? call.args.path : undefined;
    await this.o.audit.append({ session: s.id, kind: "decision", tool: call.name, ...(p ? { path: p } : {}), detail: { tier, codes, action, by, callId: call.callId } });
  }

  /** Diff card before the write lands (Balanced: `applied`, the UI offers Undo). */
  private async emitDiff(s: Session, call: ToolCall): Promise<void> {
    const rel = typeof call.args.path === "string" ? call.args.path : "";
    if (!rel) return;
    const file = path.resolve(s.cwd, rel);
    let before = "";
    try {
      before = await readFile(file, "utf8");
    } catch {
      before = "";
    }
    if (before.length > DIFF_MAX_BYTES) return;
    const after = applyEdit(call, before);
    if (after === null || after === before) return;
    this.emit(s, { type: "diff", path: file, before, after, applied: true });
  }

  // ---- events ------------------------------------------------------------------------------

  private onEvent(s: Session, ev: BackendEvent): void {
    const out = this.toClient(s, ev);
    if (out) this.emit(s, out);
    if (ev.type !== "text.delta" && ev.type !== "thinking.delta") this.track(this.log(s, ev));
    if (ev.type === "usage") {
      this.track(this.o.audit.append({ session: s.id, kind: "usage", inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, usd: ev.usd, detail: { usdKind: ev.usdKind, cacheRead: ev.cacheRead, cacheWrite: ev.cacheWrite } }));
    }
  }

  private track(p: Promise<unknown>): void {
    const q = p.catch(() => {}).finally(() => this.inflight.delete(q));
    this.inflight.add(q);
  }

  /** Wait until every log/audit write started so far is on disk. */
  async settle(): Promise<void> {
    while (this.inflight.size) await Promise.all([...this.inflight]);
  }

  private async log(s: Session, ev: BackendEvent): Promise<void> {
    try {
      if (ev.type === "ready") await this.o.log.append(s.id, { type: "session.backend", backendSessionId: ev.backendSessionId });
      await this.o.log.append(s.id, { type: "event", event: ev as unknown as Record<string, unknown> });
    } catch {
      /* logging must not break the turn */
    }
  }

  private toClient(s: Session, ev: BackendEvent): ClientEvent | null {
    switch (ev.type) {
      case "text.delta":
        return { type: "token", text: ev.text };
      case "thinking.delta":
        return { type: "thinking", text: ev.text };
      case "tool.start":
        s.toolNames.set(ev.callId, ev.name);
        return { type: "tool_start", call_id: ev.callId, name: ev.name, input: ev.args };
      case "tool.end":
        if (ev.untrusted) s.tainted = true;
        return { type: "tool_end", call_id: ev.callId, name: s.toolNames.get(ev.callId) ?? "", ok: ev.ok, output: ev.output };
      case "usage":
        return { type: "cost", input_tokens: ev.inputTokens, output_tokens: ev.outputTokens, usd: ev.usd, cache_read_tokens: ev.cacheRead, cache_write_tokens: ev.cacheWrite };
      case "turn.end":
        s.running = false;
        this.denyPending(s);
        return { type: "done", stop: ev.stop };
      case "error":
        return { type: "error", message: ev.message, error: { code: ev.code, retryable: ev.retryable, detail: ev.message } };
      case "ready":
        if (!s.model && ev.model) s.model = ev.model;
        return { type: "trace", event: "ready", detail: { model: ev.model, backend_version: ev.backendVersion, auth: ev.auth.source } };
      case "quota":
      case "compacted":
      case "subagent": {
        const { type, ...detail } = ev;
        return { type: "trace", event: type, detail };
      }
      case "message":
        return null;
    }
  }

  private emit(s: Session, ev: ClientEvent): void {
    for (const c of s.clients) {
      try {
        c.notify("session.event", { session_id: s.id, event: ev });
      } catch {
        s.clients.delete(c);
      }
    }
  }

  // ---- helpers -----------------------------------------------------------------------------

  private get(id: unknown): Session {
    const s = typeof id === "string" ? this.sessions.get(id) : undefined;
    if (!s) throw new RpcFailure(ErrorCodes.InvalidParams, `unknown session: ${String(id)}`);
    return s;
  }

  private async closeSession(s: Session, reason: string): Promise<void> {
    this.denyPending(s);
    this.sessions.delete(s.id);
    try {
      await s.handle.close();
    } finally {
      await this.settle();
      await this.o.log.append(s.id, { type: "session.end", reason });
    }
  }
}

/** RPC shape of the personal layer (no profile text: it may be long and is the user's own file). */
export type PersonalSummary = Omit<Personal, "systemAppend" | "plugins">;

function personalSummary(p: Personal): PersonalSummary {
  return { home: p.home, profile: p.profile, project: p.project, plugin: p.plugin, warnings: p.warnings };
}

function reviewNeeded(review: RepoReview): RpcFailure {
  return new RpcFailure(REPO_CONFIG_REVIEW, `the repo config of ${review.workspace} runs commands outside tool calls and needs review`, { review });
}

/** File content after a write/edit call, or null when it cannot be computed. */
export function applyEdit(call: ToolCall, before: string): string | null {
  const a = call.args;
  if (call.kind === "write") return typeof a.content === "string" ? a.content : null;
  const one = (text: string, oldS: unknown, newS: unknown, all: unknown): string | null => {
    if (typeof oldS !== "string" || typeof newS !== "string") return null;
    if (oldS === "") return before === "" ? newS : null;
    if (!text.includes(oldS)) return null;
    return all === true ? text.split(oldS).join(newS) : text.replace(oldS, () => newS);
  };
  if (Array.isArray(a.edits)) {
    let text: string | null = before;
    for (const e of a.edits as Array<Record<string, unknown>>) {
      if (text === null) return null;
      text = one(text, e.old_string, e.new_string, e.replace_all);
    }
    return text;
  }
  return one(before, a.old, a.new, a.replaceAll);
}

/** `data:image/<png|jpeg|gif|webp>;base64,...` URLs (max 4) → backend images. */
export function parseImages(v: unknown): Array<{ mediaType: string; data: string }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ mediaType: string; data: string }> = [];
  for (const u of v.slice(0, 4)) {
    const m = typeof u === "string" ? u.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/) : null;
    if (!m) throw new RpcFailure(ErrorCodes.InvalidParams, "images must be base64 data URLs (png, jpeg, gif, webp)");
    if (m[2]!.length > Math.ceil((5 * 1024 * 1024 * 4) / 3)) throw new RpcFailure(ErrorCodes.InvalidParams, "image larger than 5 MB");
    out.push({ mediaType: m[1]!, data: m[2]! });
  }
  return out;
}
