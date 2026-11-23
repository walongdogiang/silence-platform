// Session manager (roadmap 1.5b): owns core sessions, drives a Backend, and is the one place that
// decides tool calls (Risk Engine → Balanced policy → ask the user). Writes the event log, audit
// trail and per-turn git snapshots, and turns backend events into `session.event` for clients.
// Spec: docs/adapters/protocol.md, docs/security/permissions.md.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { RpcFailure, ErrorCodes, type CallContext } from "../api/jsonrpc.js";
import type { Backend, BackendEvent, Decision, Effort, Mode, SessionHandle, ToolCall } from "../backends/types.js";
import { changedSince, takeSnapshot } from "../git/snapshot.js";
import { createWorktree, discardWorktree, isDirty, mergeWorktree, repoRoot, worktreeChanges, type WorktreeInfo, type WorktreeReason } from "../worktrees/worktrees.js";
import { toToolCall } from "../backends/claude/toolMap.js";
import { coreSessionMetrics, externalSessionMetrics, summarize, transcriptLines, type MetricsSummary, type SessionMetrics, type TranscriptMessage } from "../metrics/metrics.js";
import { applyLesson, LESSON_SYSTEM, lessonPrompt, lessonTargets, parseProposal, type LessonContext, type LessonProposal } from "../lessons/lessons.js";
import { claudeOneShot, type OneShotResult } from "../backends/claude/oneShot.js";
import { fixPrompt, loadVerify, MAX_FIX_ROUNDS, planChecks, runCheck, type CheckResult, type VerifyApprovals } from "../verify/verify.js";
import { classify, shellPattern, type Verdict } from "../risk/classify.js";
import { askModeAllows, ASK_MODE_REASON, impactOf, levelOf, modeAction, normalizeMode, type Level, type ModeAction, type PermMode } from "../permissions/modes.js";
import { addRule, loadRules, matchRules, projectRulesFile, ruleFor, shellSegments, userRulesFile, type RuleSet } from "../permissions/rules.js";
import type { AuditLog } from "../store/audit.js";
import type { EventLog } from "../store/eventLog.js";
import { loadPersonal, projectName, type Personal } from "./personal.js";
import { scanRepoConfig, type RepoApprovals, type RepoReview } from "../repoConfig/review.js";

/** JSON-RPC error: the repo config needs the user's review first (`data.review`: `RepoReview`). */
export const REPO_CONFIG_REVIEW = -32010;

/** Outside transcripts read at once when building the metrics page. */
const EXTERNAL_READ_CONCURRENCY = 8;

/** `SessionEvent` of `packages/protocol` (subset the core emits). */
export type ClientEvent =
  | { type: "token"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_start"; call_id: string; name: string; input: unknown }
  | { type: "tool_end"; call_id: string; name: string; ok: boolean; output: string }
  | { type: "permission"; request_id: string; name: string; input: unknown; reason: string; risk?: ReturnType<Verdict["toRisk"]>; preview?: FilePreview }
  | { type: "plan"; markdown: string }
  | { type: "diff"; path: string; before: string; after: string; applied?: boolean }
  | { type: "trace"; event: string; detail: unknown }
  | { type: "cost"; input_tokens: number; output_tokens: number; usd: number; cache_read_tokens?: number; cache_write_tokens?: number }
  | { type: "done"; stop: string }
  /** Checks after a turn (roadmap 1.8). `final` = no more fix rounds follow this one. */
  | { type: "verify"; ok: boolean; round: number; final: boolean; source: "user" | "repo"; changed: number; checks: CheckResult[] }
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
  createdAt?: number;
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
  /** Approved commands of a repo's own `.silence/verify.yaml` (roadmap 1.8). */
  verifyApprovals: VerifyApprovals;
  /** Where worktrees go (tests); default `worktreeBase()`. */
  worktreeBase?: string;
  /** Turns running at once across sessions (roadmap 1.11, default 2); more are queued. */
  maxConcurrent?: number;
  /** Messages of an outside session (Claude: SDK `getSessionMessages`). */
  externalMessages?: (sessionId: string, dir?: string) => Promise<TranscriptMessage[]>;
  /** One Claude call without tools (lesson proposals). Injected in tests; default `claudeOneShot`. */
  oneShot?: (system: string, prompt: string, o: { model?: string; cwd: string }) => Promise<OneShotResult>;
  /** Injected in tests; default `takeSnapshot`. */
  snapshot?: (root: string, session: string, turn: number) => Promise<string | null>;
  newId?: () => string;
}

/** Answer to a permission card. `allow_always` / `deny_always` also save a rule for the project. */
export type PermAnswer = "allow_once" | "allow_always" | "deny" | "deny_always";

interface Pending {
  resolve: (answer: PermAnswer) => void;
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
  /** Permission mode (docs/security/permissions.md). */
  permMode: PermMode;
  /** allow / ask / deny rules, reloaded every turn and after a card saves one. */
  rules: RuleSet;
  /** `~/.silence/projects/<project>/`: where "Always allow" / "Deny always" save rules. */
  project: string;
  /** Turn whose git snapshot exists (an edit can be undone). */
  snapshotTurn: number;
  /** Main checkout of the session's repo (null outside git). */
  root: string | null;
  /** Set when the chat runs in its own worktree (roadmap 1.11). */
  worktree?: WorktreeInfo;
  /** The turn waits for a free slot (`maxConcurrent`). */
  queued: boolean;
  /** Fix rounds already sent for this turn's failed checks (0..MAX_FIX_ROUNDS). */
  verifyRound: number;
  /** Paths written or edited this turn (fallback for "changed files" outside git). */
  editedPaths: Set<string>;
  /** Files the last failed check covered: a fix round checks them again even when the fix put
   *  them back as they were at the turn's start (the git snapshot then reports no change). */
  verifyFiles: string[];
  /** The backend loads the repo's own config (approved, or nothing to review). */
  projectConfig: boolean;
  /** Hash of the repo config the session started with (empty when none). */
  configHash: string;
}

const DIFF_MAX_BYTES = 512 * 1024;

/** What a write/edit would change, for the permission card (`path` relative to the session folder when inside it). */
export interface FilePreview {
  path: string;
  before: string;
  after: string;
}
const UNATTENDED_REASON = "needs human approval; the call was logged for review. Do not retry it; continue without it or stop.";

/** `D:/w/src/a.ts` → `src/a.ts` inside the session folder; outside it stays absolute. */
function displayPath(cwd: string, file: string): string {
  const rel = path.relative(cwd, file);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : file;
}

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
  /** Metrics of outside sessions by id + lastModified (transcripts are large; re-read only when changed). */
  private readonly externalCache = new Map<string, { key: number; m: SessionMetrics }>();
  /** Turns waiting for a free slot, oldest first (roadmap 1.11). */
  private readonly queue: Array<{ s: Session; start: () => Promise<void> }> = [];
  private maxConcurrent: number;
  /** Lesson proposals waiting for review (roadmap 1.9), by id. */
  private readonly lessons = new Map<string, { lesson: string; ctx: LessonContext; proposal: LessonProposal; at: number }>();

  constructor(private readonly o: SessionManagerOptions) {
    this.maxConcurrent = clampLimit(o.maxConcurrent ?? 2);
  }

  // ---- RPC ---------------------------------------------------------------------------------

  async create(params: unknown, ctx?: CallContext): Promise<{ session_id: string; personal: PersonalSummary; worktree: PublicWorktree | null }> {
    const p = obj(params);
    const cwd = str(p.workspace);
    if (!cwd) throw new RpcFailure(ErrorCodes.InvalidParams, "workspace is required");
    const permMode = normalizeMode(p.permission);
    if (!permMode) throw new RpcFailure(ErrorCodes.InvalidParams, "permission yolo is not allowed over RPC");
    const backendId = str(p.backend) ?? "claude";
    const backend = this.o.backends[backendId];
    if (!backend) throw new RpcFailure(ErrorCodes.InvalidParams, `unknown backend: ${backendId}`);
    const id = (this.o.newId ?? randomUUID)();
    // The old read-only `ask` permission mode is the Ask work mode now.
    const mode = p.permission === "ask" ? "ask" : toMode(p.mode);
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

    // Parallel chats (roadmap 1.11): split off into a worktree when another chat already works in this
    // checkout and is running or left uncommitted changes, or when the chat asks for it.
    const want = p.worktree === "on" || p.worktree === "off" ? p.worktree : "auto";
    const root = await repoRoot(cwd);
    let worktree: WorktreeInfo | undefined;
    if (root && want !== "off") {
      let reason: WorktreeReason | null = want === "on" ? "forced" : null;
      if (!reason) {
        const sharing = [...this.sessions.values()].filter((x) => x.root && !x.worktree && samePath(x.root, root));
        if (sharing.length) reason = sharing.some((x) => x.running) ? "other_running" : (await isDirty(root)) ? "dirty" : null;
      }
      if (reason) worktree = await createWorktree(root, personal.projectName ?? path.basename(root), reason, this.o.worktreeBase);
    }
    const workCwd = worktree && root ? path.join(worktree.path, path.relative(root, path.resolve(cwd))) : path.resolve(cwd);

    const s = {
      id,
      cwd: workCwd,
      root,
      ...(worktree ? { worktree } : {}),
      queued: false,
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
      permMode,
      project: personal.projectName ?? path.basename(path.resolve(cwd)),
      rules: { rules: [], errors: [] },
      snapshotTurn: 0,
      verifyRound: 0,
      editedPaths: new Set<string>(),
      verifyFiles: [],
    } as Omit<Session, "handle"> as Session;
    s.rules = await loadRules(this.o.home, s.project, s.cwd);
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
    if (worktree) this.track(this.o.audit.append({ session: id, kind: "worktree.create", path: worktree.path, detail: { branch: worktree.branch, base: worktree.base, reason: worktree.reason } }));
    return { session_id: id, personal: personalSummary(personal), worktree: worktree ? publicWorktree(worktree) : null };
  }

  /** What `~/.silence` gives a session in `workspace` (profile, project profile, plugin, warnings). */
  async profileStatus(params: unknown): Promise<PersonalSummary> {
    const p = (typeof params === "object" && params !== null ? params : {}) as Record<string, unknown>;
    return personalSummary(await loadPersonal(this.o.home, str(p.workspace)));
  }

  async prompt(params: unknown, ctx?: CallContext): Promise<{ ok: true; turn: number; queued?: boolean }> {
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
    s.rules = await loadRules(this.o.home, s.project, s.cwd);
    // Count before marking this session as running, or it would take its own slot.
    const full = this.activeCount() >= this.maxConcurrent;
    s.running = true;
    if (full) {
      // No free slot: wait in line; the turn starts when another one finishes.
      s.queued = true;
      this.queue.push({ s, start: () => this.startTurn(s, text, context, images) });
      this.emit(s, { type: "trace", event: "queued", detail: { position: this.queue.length, limit: this.maxConcurrent } });
      return { ok: true, turn: s.turn + 1, queued: true };
    }
    await this.startTurn(s, text, context, images);
    return { ok: true, turn: s.turn };
  }

  /** Turns running now (queued ones excluded). */
  private activeCount(): number {
    return [...this.sessions.values()].filter((x) => x.running && !x.queued).length;
  }

  /** Start queued turns while there are free slots. */
  private pump(): void {
    while (this.queue.length && this.activeCount() < this.maxConcurrent) {
      const next = this.queue.shift()!;
      next.s.queued = false;
      this.emit(next.s, { type: "trace", event: "dequeued", detail: {} });
      void next.start().catch((e) => {
        this.emit(next.s, { type: "error", message: e instanceof Error ? e.message : String(e) });
        this.emit(next.s, this.finishTurn(next.s, "error"));
      });
    }
  }

  /** `core.set_limit {max}`: turns at once (1..4, from Settings). */
  setLimit(params: unknown): { max: number } {
    this.maxConcurrent = clampLimit(Number(obj(params).max));
    this.pump();
    return { max: this.maxConcurrent };
  }

  private async startTurn(s: Session, text: string, context: string | undefined, images: Array<{ mediaType: string; data: string }>): Promise<void> {
    s.queued = false;
    s.turn += 1;
    s.verifyRound = 0;
    s.editedPaths.clear();
    s.verifyFiles = [];
    if (s.turn === 1 && s.personalWarnings.length) this.emit(s, { type: "trace", event: "profile", detail: { warnings: s.personalWarnings } });
    s.tainted = false;
    await this.o.log.append(s.id, { type: "user", text });
    try {
      const ref = await (this.o.snapshot ?? takeSnapshot)(s.cwd, s.id, s.turn);
      if (ref) {
        s.snapshotTurn = s.turn;
        this.track(this.o.audit.append({ session: s.id, kind: "snapshot", detail: { ref, turn: s.turn } }));
      }
    } catch {
      /* no undo point for this turn; the turn still runs */
    }
    try {
      await s.handle.send({ text: context ? `${text}\n\n${context}` : text, ...(images.length ? { images } : {}) });
    } catch (e) {
      s.running = false;
      this.pump();
      throw e;
    }
  }

  async abort(params: unknown): Promise<{ ok: true }> {
    const s = this.get(obj(params).session_id);
    if (s.queued) {
      const i = this.queue.findIndex((q) => q.s === s);
      if (i >= 0) this.queue.splice(i, 1);
      s.queued = false;
      this.emit(s, this.finishTurn(s, "interrupted"));
      return { ok: true };
    }
    this.denyPending(s);
    if (s.running) await s.handle.interrupt();
    return { ok: true };
  }

  /** Change the work mode for the next tool calls (Ask is enforced here; plan goes to the backend too). */
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

  /** Change the permission mode from the next tool call. `yolo` is refused; legacy `ask` = Ask work mode + Auto. */
  setPermission(params: unknown): { ok: true; permission: PermMode } {
    const p = obj(params);
    const s = this.get(p.session_id);
    const mode = normalizeMode(p.permission);
    if (!mode) throw new RpcFailure(ErrorCodes.InvalidParams, "permission yolo is not allowed over RPC");
    if (p.permission === "ask" && s.mode !== "ask") {
      s.mode = "ask";
      void s.handle.setMode?.("ask")?.catch(() => undefined);
    }
    if (mode !== s.permMode) this.track(this.o.audit.append({ session: s.id, kind: "permission_mode", detail: { from: s.permMode, to: mode } }));
    s.permMode = mode;
    return { ok: true, permission: mode };
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

  /** Rules that apply in `workspace` (user, project, repo ask/deny), and where to edit them. */
  async listRules(params: unknown): Promise<{ rules: Array<{ behavior: string; text: string; source: string }>; errors: string[]; files: { user: string; project: string }; project: string }> {
    const ws = str(obj(params).workspace);
    if (!ws) throw new RpcFailure(ErrorCodes.InvalidParams, "workspace is required");
    const project = await projectName(ws);
    const set = await loadRules(this.o.home, project, ws);
    return {
      rules: set.rules.map((r) => ({ behavior: r.behavior, text: r.text, source: r.source })),
      errors: set.errors,
      files: { user: userRulesFile(this.o.home), project: projectRulesFile(this.o.home, project) },
      project,
    };
  }

  /**
   * Lesson loop step 1 (roadmap 1.9): one Claude call proposes edits to the personal files from the
   * lesson and the turn. Nothing is written until `lesson.apply`.
   */
  async lessonPropose(params: unknown): Promise<{ lesson_id: string; project: string; model: string; summary: string; edits: LessonProposal["edits"]; warnings: string[] }> {
    const p = obj(params);
    const lesson = typeof p.text === "string" ? p.text.trim() : "";
    if (!lesson) throw new RpcFailure(ErrorCodes.InvalidParams, "text is required");
    const workspace = str(p.workspace);
    const project = workspace ? await projectName(workspace) : "default";
    const ctx: LessonContext = { ...(str(p.user) ? { user: str(p.user)! } : {}), ...(str(p.answer) ? { answer: str(p.answer)! } : {}), ...(workspace ? { workspace } : {}) };
    const targets = await lessonTargets(this.o.home, project);
    const model = str(p.model) ?? "haiku";
    const run = this.o.oneShot ?? ((system, prompt, o) => claudeOneShot(system, prompt, o));
    const res = await run(LESSON_SYSTEM, lessonPrompt(lesson, ctx, project, targets), { model, cwd: this.o.home });
    let proposal: LessonProposal;
    try {
      proposal = parseProposal(res.text, project, targets);
    } catch (e) {
      throw new RpcFailure(ErrorCodes.Internal, `could not read the proposal: ${e instanceof Error ? e.message : String(e)}`);
    }
    const id = randomUUID();
    for (const [k, v] of this.lessons) if (Date.now() - v.at > 3_600_000) this.lessons.delete(k);
    this.lessons.set(id, { lesson, ctx, proposal, at: Date.now() });
    await this.o.audit.append({ session: "", kind: "lesson.propose", inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, usd: res.usage.usd, detail: { model: res.model, project, edits: proposal.edits.map((e) => e.file), warnings: proposal.warnings } });
    return { lesson_id: id, project, model: res.model, summary: proposal.summary, edits: proposal.edits, warnings: proposal.warnings };
  }

  /** Lesson loop step 2: write the accepted edits + the lesson note, commit and push ~/.silence. */
  async lessonApply(params: unknown): Promise<Awaited<ReturnType<typeof applyLesson>>> {
    const p = obj(params);
    const id = str(p.lesson_id) ?? "";
    const entry = this.lessons.get(id);
    if (!entry) throw new RpcFailure(ErrorCodes.InvalidParams, "unknown or expired lesson; propose again");
    const idx = Array.isArray(p.accept) ? p.accept.filter((i): i is number => Number.isInteger(i)) : [];
    const accepted = entry.proposal.edits.filter((_, i) => idx.includes(i));
    let res: Awaited<ReturnType<typeof applyLesson>>;
    try {
      res = await applyLesson(this.o.home, entry.lesson, entry.ctx, entry.proposal, accepted);
    } catch (e) {
      throw new RpcFailure(ErrorCodes.InvalidRequest, e instanceof Error ? e.message : String(e));
    }
    this.lessons.delete(id);
    await this.o.audit.append({ session: "", kind: "lesson.apply", detail: { written: res.written, lessonFile: res.lessonFile, commit: res.commit, pushed: res.pushed, note: res.note } });
    return res;
  }

  /** The chat's worktree and what it changed so far (merge card). */
  async worktreeStatus(params: unknown): Promise<{ worktree: PublicWorktree | null; files: Awaited<ReturnType<typeof worktreeChanges>>["files"]; commits: number }> {
    const s = this.get(obj(params).session_id);
    if (!s.worktree) return { worktree: null, files: [], commits: 0 };
    const ch = await worktreeChanges(s.worktree);
    return { worktree: publicWorktree(s.worktree), ...ch };
  }

  /** Merge the chat's worktree into its base branch (conflict → aborted, files listed). */
  async worktreeMerge(params: unknown): Promise<Awaited<ReturnType<typeof mergeWorktree>>> {
    const p = obj(params);
    const s = this.get(p.session_id);
    if (!s.worktree) throw new RpcFailure(ErrorCodes.InvalidRequest, "this chat has no worktree");
    if (s.running) throw new RpcFailure(ErrorCodes.InvalidRequest, "wait for the turn to finish before merging");
    const res = await mergeWorktree(s.worktree, str(p.title) ?? "chat changes");
    await this.o.audit.append({ session: s.id, kind: "worktree.merge", path: s.worktree.path, detail: { branch: s.worktree.branch, base: s.worktree.base, ...res } });
    return res;
  }

  /** Delete the chat's worktree and branch, and end the session (the next message starts a new one). */
  async worktreeDiscard(params: unknown): Promise<{ ok: true }> {
    const s = this.get(obj(params).session_id);
    if (!s.worktree) throw new RpcFailure(ErrorCodes.InvalidRequest, "this chat has no worktree");
    const w = s.worktree;
    await this.closeSession(s, "worktree discarded");
    await discardWorktree(w);
    await this.o.audit.append({ session: s.id, kind: "worktree.discard", path: w.path, detail: { branch: w.branch } });
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
    pending.resolve(toAnswer(p));
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

  /**
   * Sessions made outside 5ilence (Claude desktop / terminal), newest first. Leaves out the ones
   * 5ilence started (known backend id) and the lesson calls run in ~/.silence.
   */
  async externalSessions(params: unknown): Promise<{ sessions: Array<{ backend_session_id: string; title: string; workspace: string; updated_at: string; created_at?: string; git_branch?: string }> }> {
    const p = (typeof params === "object" && params !== null ? params : {}) as Record<string, unknown>;
    if (!this.o.listExternal) return { sessions: [] };
    await this.settle();
    const known = new Set((await this.o.log.list()).map((r) => r.backendSessionId).filter(Boolean));
    const home = path.resolve(this.o.home).toLowerCase();
    const dir = str(p.workspace);
    const limit = typeof p.limit === "number" ? Math.min(p.limit, 500) : 100;
    let list: ExternalSession[] = [];
    try {
      list = await this.o.listExternal({ ...(dir ? { dir } : {}), limit });
    } catch {
      return { sessions: [] };
    }
    return {
      sessions: list
        .filter((x) => !known.has(x.sessionId) && !(x.cwd && path.resolve(x.cwd).toLowerCase() === home))
        .sort((a, b) => b.lastModified - a.lastModified)
        .map((x) => ({
          backend_session_id: x.sessionId,
          title: x.customTitle || x.summary || x.firstPrompt || "",
          workspace: x.cwd ?? "",
          updated_at: new Date(x.lastModified).toISOString(),
          ...(x.createdAt ? { created_at: new Date(x.createdAt).toISOString() } : {}),
          ...(x.gitBranch ? { git_branch: x.gitBranch } : {}),
        })),
    };
  }

  /** Read-only transcript of an outside session (user / assistant text only). */
  async externalMessages(params: unknown): Promise<{ lines: Array<{ role: "user" | "assistant"; text: string }> }> {
    const p = obj(params);
    const id = str(p.backend_session_id);
    if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) throw new RpcFailure(ErrorCodes.InvalidParams, "backend_session_id is required");
    if (!this.o.externalMessages) return { lines: [] };
    return { lines: transcriptLines(await this.o.externalMessages(id, str(p.workspace))) };
  }

  /** Roadmap 1.10: 5ilence sessions (event log) next to outside Claude sessions, last `days` days. */
  async metricsSummary(params: unknown): Promise<MetricsSummary> {
    const p = (typeof params === "object" && params !== null ? params : {}) as Record<string, unknown>;
    const days = typeof p.days === "number" && p.days >= 1 ? Math.min(Math.floor(p.days), 365) : 30;
    await this.settle();
    const core: SessionMetrics[] = [];
    for (const s of await this.o.log.list()) {
      const m = coreSessionMetrics(s.id, await this.o.log.read(s.id));
      if (m) core.push(m);
    }
    const external: SessionMetrics[] = [];
    if (this.o.externalMessages) {
      const cutoff = Date.now() - days * 86_400_000;
      const { sessions } = await this.externalSessions({ limit: 500 });
      const read = this.o.externalMessages;
      const pending: typeof sessions = [];
      for (const x of sessions) {
        const modified = Date.parse(x.updated_at);
        if (modified < cutoff) continue;
        const hit = this.externalCache.get(x.backend_session_id);
        if (hit && hit.key === modified) external.push(hit.m);
        else pending.push(x);
      }
      // Cold cache: reading hundreds of transcripts one by one took ~10s, so read a few at a time.
      let next = 0;
      const worker = async (): Promise<void> => {
        while (next < pending.length) {
          const x = pending[next++]!;
          try {
            const msgs = await read(x.backend_session_id, x.workspace || undefined);
            const m = externalSessionMetrics(x.backend_session_id, x.workspace, Date.parse(x.created_at ?? x.updated_at), msgs);
            this.externalCache.set(x.backend_session_id, { key: Date.parse(x.updated_at), m });
            external.push(m);
          } catch {
            /* unreadable transcript: leave it out */
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(EXTERNAL_READ_CONCURRENCY, pending.length) }, worker));
    }
    return summarize(core, external, days);
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
      this.track(this.record(s, call, null, "error", "deny", "policy"));
      return { action: "deny", reason };
    }
  }

  private async decideInner(s: Session, call: ToolCall): Promise<Decision> {
    const v = classify(call.name, call.args, { workspace: s.cwd, tainted: s.tainted, mcpReadOnly: call.mcp?.readOnly ?? false });
    const level = levelOf(v);
    const rule = matchRules(s.rules, call);
    const deny = async (reason: string, by: DecisionBy, detail: Record<string, unknown> = {}): Promise<Decision> => {
      await this.record(s, call, v, level, "deny", by, detail);
      return { action: "deny", reason };
    };

    // 1. A deny rule wins over everything, Bypass included.
    if (rule?.behavior === "deny") return deny(`denied by the user's rule ${rule.text}. Do not retry it.`, "remembered", { rule: rule.text });
    // 2. The Ask work mode only offers reading; nothing (not even an allow rule or Bypass) widens it.
    if (s.mode === "ask" && !askModeAllows(call, v)) return deny(ASK_MODE_REASON, "policy");

    // 3. Hard blocks and Bypass exceptions come from the mode; otherwise ask/allow rules, then the mode.
    const special = s.permMode === "bypass" ? modeAction("bypass", call, v).kind === "ask" : level === "hard_block";
    let action: ModeAction;
    let by: DecisionBy = "policy";
    if (special) action = modeAction(s.permMode, call, v);
    else if (rule?.behavior === "ask") action = { kind: "ask" };
    else if (rule?.behavior === "allow" && level !== "danger") {
      action = { kind: "allow" };
      by = "remembered";
    } else action = modeAction(s.permMode, call, v);

    if (action.kind === "deny") return deny(action.reason, "policy");
    if (action.kind === "ask") {
      if (s.unattended) return deny(UNATTENDED_REASON, "unattended");
      const answer = await this.askUser(s, call, v, level, action.countdownSec);
      if (answer === "deny" || answer === "deny_always") return deny("the user declined this call. Do not retry it; ask what they want instead.", "user", { answer });
      by = "user";
    }
    await this.record(s, call, v, level, "allow", by, rule && by === "remembered" ? { rule: rule.text } : {});

    if (call.name === "submit_plan" && typeof call.args.markdown === "string") this.emit(s, { type: "plan", markdown: call.args.markdown });
    if (call.kind === "write" || call.kind === "edit") await this.emitDiff(s, call);
    return { action: "allow" };
  }

  /** Show a permission card and wait. Red calls never offer "Always allow"; a countdown ends in a refusal. */
  private async askUser(s: Session, call: ToolCall, v: Verdict, level: Level, countdownSec?: number): Promise<PermAnswer> {
    const requestId = randomUUID();
    const cmd = call.kind === "shell" && typeof call.args.command === "string" ? call.args.command : null;
    const pattern = cmd ? shellPattern(cmd) : null;
    // A repo's verify command: "Always allow" approves that exact command (not a Bash rule the agent
    // could reuse); no deny rule is offered, since it would also bind the agent.
    const isVerify = call.origin === "verify";
    const always = level === "safe" || level === "caution" ? (isVerify ? (cmd?.trim() ?? null) : ruleFor(call, pattern)) : null;
    const denyRule = isVerify ? null : (ruleFor(call, pattern) ?? (cmd ? `${call.raw.tool}(${cmd.trim()})` : null));
    const segs = cmd ? shellSegments(cmd) : [];
    const ctx = { workspace: s.cwd, tainted: s.tainted, mcpReadOnly: call.mcp?.readOnly ?? false };
    // The card shows the file and its diff instead of the raw tool input.
    const change = call.kind === "write" || call.kind === "edit" ? await this.changeOf(s, call) : null;
    const preview: FilePreview | null = change ? { ...change, path: displayPath(s.cwd, change.path) } : null;
    const risk = {
      ...v.toRisk(pattern ?? undefined),
      level,
      codes: v.codes,
      ...(segs.length > 1
        ? {
            segments: segs.map((text) => {
              const sv = classify("shell", { command: text }, ctx);
              return { text, level: levelOf(sv), codes: sv.codes };
            }),
          }
        : {}),
      impact: impactOf(v, call, s.snapshotTurn === s.turn),
      source: call.origin ?? (call.parentCallId ? "subagent" : "agent"),
      tainted: s.tainted,
      mode: s.permMode,
      ...(always ? { allow_rule: always } : {}),
      ...(denyRule ? { deny_rule: denyRule } : {}),
      ...(countdownSec ? { countdown_s: countdownSec } : {}),
    };
    const answer = await new Promise<PermAnswer>((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const done = (a: PermAnswer) => {
        if (timer) clearTimeout(timer);
        resolve(a);
      };
      if (countdownSec) {
        timer = setTimeout(() => {
          if (s.pending.delete(requestId)) resolve("deny");
        }, countdownSec * 1000);
      }
      s.pending.set(requestId, { resolve: done, callId: call.callId });
      this.emit(s, { type: "permission", request_id: requestId, name: call.raw.tool, input: call.raw.input, reason: v.title(), risk, ...(preview ? { preview } : {}) });
    });
    // Save the rule the card offered; "Always allow" is ignored where it was not offered (red calls).
    const save = isVerify ? null : answer === "allow_always" ? always : answer === "deny_always" ? denyRule : null;
    if (save) {
      const file = projectRulesFile(this.o.home, s.project);
      await addRule(file, answer === "allow_always" ? "allow" : "deny", save);
      s.rules = await loadRules(this.o.home, s.project, s.cwd);
      await this.o.audit.append({ session: s.id, kind: "rule.add", path: file, detail: { behavior: answer === "allow_always" ? "allow" : "deny", rule: save } });
    }
    return answer === "allow_always" && !always ? "allow_once" : answer;
  }

  // ---- verification (roadmap 1.8) -----------------------------------------------------------

  private finishTurn(s: Session, stop: string): ClientEvent {
    s.running = false;
    s.verifyRound = 0;
    s.verifyFiles = [];
    this.denyPending(s);
    queueMicrotask(() => this.pump());
    return { type: "done", stop };
  }

  /** Files changed this turn: snapshot diff, or the paths the agent wrote/edited when there is no git. */
  private async changedFiles(s: Session): Promise<string[]> {
    if (s.snapshotTurn === s.turn) {
      const fromGit = await changedSince(s.cwd, s.id, s.turn);
      if (fromGit) return fromGit;
    }
    return [...s.editedPaths].map((p) => path.relative(s.cwd, path.resolve(s.cwd, p)).split(path.sep).join("/"));
  }

  /** Run the checks for this turn's changes; on failure send the errors back (at most MAX_FIX_ROUNDS). */
  private async afterTurn(s: Session, stop: string): Promise<void> {
    try {
      const now = await this.changedFiles(s);
      // A fix round re-checks what failed, even if the fix reverted it to the turn's start.
      const changed = s.verifyRound > 0 ? [...new Set([...now, ...s.verifyFiles])] : now;
      const cfg = changed.length ? await loadVerify(this.o.home, s.project, s.cwd) : null;
      const plan = cfg ? planChecks(cfg, changed) : null;
      if (!cfg || !plan || (!plan.commands.length && !plan.pairErrors.length)) {
        this.emit(s, this.finishTurn(s, stop));
        return;
      }
      const checks: CheckResult[] = plan.pairErrors.map((e) => ({ command: "pairs", ok: false, ms: 0, output: e }));
      for (const c of plan.commands) {
        const gate = cfg.source === "repo" ? await this.gateVerify(s, c.run) : "run";
        if (gate !== "run") {
          checks.push({ command: c.run, ok: false, skipped: gate, ms: 0, output: "" });
          continue;
        }
        checks.push(await runCheck(c.run, s.cwd, c.timeoutSec));
      }
      const failed = checks.filter((r) => !r.ok && !r.skipped);
      const ok = failed.length === 0;
      const round = s.verifyRound;
      const retry = !ok && round < MAX_FIX_ROUNDS && s.running;
      await this.o.log.append(s.id, { type: "verify", ok, commands: checks.map((r) => r.command), ...(ok ? {} : { output: failed.map((r) => `$ ${r.command}\n${r.output}`).join("\n\n").slice(0, 8000) }) });
      this.track(this.o.audit.append({ session: s.id, kind: "verify", detail: { ok, round, source: cfg.source, changed: changed.length, checks: checks.map((r) => ({ command: r.command, ok: r.ok, skipped: r.skipped, ms: r.ms })) } }));
      this.emit(s, { type: "verify", ok, round, final: !retry, source: cfg.source, changed: changed.length, checks });
      if (retry) {
        s.verifyRound = round + 1;
        s.verifyFiles = changed;
        await s.handle.send({ text: fixPrompt(failed, s.verifyRound) });
        return; // the fix turn ends in another turn.end, which checks again
      }
      this.emit(s, this.finishTurn(s, stop));
    } catch (e) {
      this.emit(s, { type: "error", message: `verify failed to run: ${e instanceof Error ? e.message : String(e)}` });
      this.emit(s, this.finishTurn(s, stop));
    }
  }

  /**
   * A command from the repo's own verify.yaml (untrusted, decision 4d): approved and unchanged → run;
   * otherwise the same flow as a tool call (deny rules, hard blocks, Bypass) and a permission card.
   * Unattended → refused. Returns "run" or why it was skipped.
   */
  private async gateVerify(s: Session, command: string): Promise<"run" | string> {
    const call = { ...toToolCall({ toolName: "Bash", input: { command }, toolUseId: `verify-${randomUUID()}`, cwd: s.cwd }), origin: "verify" as const };
    const v = classify(call.name, call.args, { workspace: s.cwd, tainted: false, mcpReadOnly: false });
    const level = levelOf(v);
    const rule = matchRules(s.rules, call);
    const deny = async (why: string, by: DecisionBy) => {
      await this.record(s, call, v, level, "deny", by, { origin: "verify" });
      return why;
    };
    if (rule?.behavior === "deny") return deny(`denied by rule ${rule.text}`, "remembered");
    const special = s.permMode === "bypass" ? modeAction("bypass", call, v) : null;
    if (level === "hard_block" && s.permMode !== "bypass") return deny(v.blockMessage(), "policy");
    let countdown: number | undefined;
    if (special?.kind === "ask") countdown = special.countdownSec;
    else if (level !== "hard_block" && (await this.o.verifyApprovals.isApproved(s.cwd, command))) {
      await this.record(s, call, v, level, "allow", "remembered", { origin: "verify" });
      return "run";
    } else if (s.permMode === "bypass" && special?.kind === "allow") {
      await this.record(s, call, v, level, "allow", "policy", { origin: "verify" });
      return "run";
    }
    if (s.unattended) return deny("needs approval (unattended)", "unattended");
    const answer = await this.askUser(s, call, v, level, countdown);
    if (answer === "deny" || answer === "deny_always") return deny("declined", "user");
    if (answer === "allow_always" && level !== "danger" && level !== "hard_block") {
      await this.o.verifyApprovals.approve(s.cwd, command);
      this.track(this.o.audit.append({ session: s.id, kind: "verify.approve", detail: { command } }));
    }
    await this.record(s, call, v, level, "allow", "user", { origin: "verify" });
    return "run";
  }

  private denyPending(s: Session): void {
    for (const p of s.pending.values()) p.resolve("deny");
    s.pending.clear();
  }

  private async record(s: Session, call: ToolCall, v: Verdict | null, level: Level | "error", action: "allow" | "deny", by: DecisionBy, extra: Record<string, unknown> = {}): Promise<void> {
    const tier = v?.tier ?? "error";
    const codes = v?.codes ?? ["INTERNAL_ERROR"];
    await this.o.log.append(s.id, { type: "decision", callId: call.callId, tool: call.raw.tool, tier, codes, action, by });
    const p = typeof call.args.path === "string" ? call.args.path : undefined;
    await this.o.audit.append({ session: s.id, kind: "decision", tool: call.name, ...(p ? { path: p } : {}), detail: { tier, level, codes, action, by, mode: s.permMode, callId: call.callId, ...extra } });
  }

  /** What a write/edit changes (absolute path); null when unknown, unchanged or too large. */
  private async changeOf(s: Session, call: ToolCall): Promise<FilePreview | null> {
    const rel = typeof call.args.path === "string" ? call.args.path : "";
    if (!rel) return null;
    const file = path.resolve(s.cwd, rel);
    let before = "";
    try {
      before = await readFile(file, "utf8");
    } catch {
      before = "";
    }
    if (before.length > DIFF_MAX_BYTES) return null;
    const after = applyEdit(call, before);
    if (after === null || after === before || after.length > DIFF_MAX_BYTES) return null;
    return { path: file, before, after };
  }

  /** Diff card before the write lands (Balanced: `applied`, the UI offers Undo). */
  private async emitDiff(s: Session, call: ToolCall): Promise<void> {
    const change = await this.changeOf(s, call);
    if (change) this.emit(s, { type: "diff", ...change, applied: true });
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
        if ((ev.name === "write" || ev.name === "edit") && typeof ev.args.path === "string") s.editedPaths.add(ev.args.path);
        return { type: "tool_start", call_id: ev.callId, name: ev.name, input: ev.args };
      case "tool.end":
        if (ev.untrusted) s.tainted = true;
        return { type: "tool_end", call_id: ev.callId, name: s.toolNames.get(ev.callId) ?? "", ok: ev.ok, output: ev.output };
      case "usage":
        return { type: "cost", input_tokens: ev.inputTokens, output_tokens: ev.outputTokens, usd: ev.usd, cache_read_tokens: ev.cacheRead, cache_write_tokens: ev.cacheWrite };
      case "turn.end":
        // A completed turn that edited files is checked first; `done` is sent once checks finish.
        if (ev.stop === "completed" && s.mode !== "ask") {
          void this.afterTurn(s, ev.stop);
          return null;
        }
        return this.finishTurn(s, ev.stop);
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
    const qi = this.queue.findIndex((q) => q.s === s);
    if (qi >= 0) this.queue.splice(qi, 1);
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
  return { home: p.home, profile: p.profile, project: p.project, ...(p.projectName ? { projectName: p.projectName } : {}), plugin: p.plugin, warnings: p.warnings };
}

type DecisionBy = "policy" | "user" | "remembered" | "unattended";

/** What clients see of a worktree (no internal sha / root needed for display). */
export type PublicWorktree = { path: string; branch: string; base: string; reason: WorktreeReason };

function publicWorktree(w: WorktreeInfo): PublicWorktree {
  return { path: w.path, branch: w.branch, base: w.base, reason: w.reason };
}

function clampLimit(n: number): number {
  return Number.isFinite(n) ? Math.min(4, Math.max(1, Math.floor(n))) : 2;
}

function samePath(a: string, b: string): boolean {
  const n = (x: string) => path.resolve(x).toLowerCase();
  return n(a) === n(b);
}

/** `session.permission` params -> answer. Legacy `{allow, scope|remember}` still works. */
function toAnswer(p: Record<string, unknown>): PermAnswer {
  const d = p.decision;
  if (d === "allow_once" || d === "allow_always" || d === "deny" || d === "deny_always") return d;
  if (p.allow !== true) return "deny";
  return p.scope === "workspace" || p.scope === "session" || p.remember === true ? "allow_always" : "allow_once";
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
