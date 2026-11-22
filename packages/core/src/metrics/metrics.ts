// Session metrics (roadmap 1.10, ADR 0004 pillar 7): turns, false "done", fix rounds, repeats,
// tokens / estimated cost and quota, from the core's event log; the same counts that exist for
// sessions made in Claude desktop / terminal (read from ~/.claude through the SDK), to compare
// 5ilence with bare Claude.
import path from "node:path";
import type { LogRecord } from "../store/eventLog.js";

export interface Totals {
  sessions: number;
  turns: number;
  /** Turns whose first check failed: the agent said done, verification said no (5ilence only). */
  falseDone: number;
  /** Turns that ran checks at all (denominator of the false-done rate; 5ilence only). */
  verifiedTurns: number;
  /** Fix rounds the core sent after failed checks (5ilence only). */
  fixRounds: number;
  /** User messages that repeat the previous one (Retry, or saying it again). */
  repeats: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** Client-side estimate (Agent SDK); informational on a subscription. */
  usd: number;
}

export const emptyTotals = (): Totals => ({ sessions: 0, turns: 0, falseDone: 0, verifiedTurns: 0, fixRounds: 0, repeats: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, usd: 0 });

function add(a: Totals, b: Totals): Totals {
  const out = { ...a };
  for (const k of Object.keys(b) as Array<keyof Totals>) out[k] += b[k];
  return out;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export interface SessionMetrics {
  id: string;
  /** Project name: folder of the workspace. */
  project: string;
  /** Day the session started (YYYY-MM-DD, local time). */
  day: string;
  totals: Totals;
  /** Latest quota report seen in the session. */
  quota?: { status: string; utilization?: number; window?: string; resetsAt?: number; at: string };
}

export function localDay(iso: string | number): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Metrics of one core session from its event log. */
export function coreSessionMetrics(id: string, recs: LogRecord[]): SessionMetrics | null {
  const start = recs.find((r) => r.body.type === "session.start");
  if (!start || start.body.type !== "session.start") return null;
  const t = { ...emptyTotals(), sessions: 1 };
  let lastUser = "";
  let verifyInTurn = 0;
  let quota: SessionMetrics["quota"];
  for (const r of recs) {
    const b = r.body;
    if (b.type === "user") {
      t.turns++;
      if (lastUser && norm(b.text) === norm(lastUser)) t.repeats++;
      lastUser = b.text;
      verifyInTurn = 0;
    } else if (b.type === "verify") {
      if (verifyInTurn === 0) {
        t.verifiedTurns++;
        if (!b.ok) t.falseDone++;
      } else t.fixRounds++;
      verifyInTurn++;
    } else if (b.type === "event") {
      const e = b.event as Record<string, unknown>;
      if (e.type === "usage") {
        t.inputTokens += Number(e.inputTokens) || 0;
        t.outputTokens += Number(e.outputTokens) || 0;
        t.cacheReadTokens += Number(e.cacheRead) || 0;
        t.usd += Number(e.usd) || 0;
      } else if (e.type === "quota") {
        quota = {
          status: String(e.status ?? ""),
          ...(typeof e.utilization === "number" ? { utilization: e.utilization } : {}),
          ...(typeof e.window === "string" ? { window: e.window } : {}),
          ...(typeof e.resetsAt === "number" ? { resetsAt: e.resetsAt } : {}),
          at: r.ts,
        };
      }
    }
  }
  return { id, project: path.basename(start.body.cwd), day: localDay(start.ts), totals: t, ...(quota ? { quota } : {}) };
}

/** A message of a Claude Code transcript (SDK `getSessionMessages`). */
export interface TranscriptMessage {
  type: string;
  message: unknown;
  parent_tool_use_id?: string | null;
}

/** Text a user typed (not a tool result), or null. */
function typedText(message: unknown): string | null {
  const content = (message as { content?: unknown } | null)?.content;
  if (typeof content === "string") return content.trim() ? content : null;
  if (!Array.isArray(content)) return null;
  if (content.some((c) => (c as { type?: string })?.type === "tool_result")) return null;
  const text = content
    .filter((c) => (c as { type?: string })?.type === "text")
    .map((c) => String((c as { text?: unknown }).text ?? ""))
    .join("\n");
  return text.trim() ? text : null;
}

/** Messages the harness injects as "user" (command output, reminders): not a turn the user typed. */
const INJECTED = /^<(command-|local-command|system-reminder|bash-|user-memory)/;

/** Metrics of a session made outside 5ilence. Only what bare Claude has: turns, repeats, tokens. */
export function externalSessionMetrics(id: string, cwd: string, startedAt: number, messages: TranscriptMessage[]): SessionMetrics {
  const t = { ...emptyTotals(), sessions: 1 };
  let lastUser = "";
  const seen = new Set<string>();
  for (const m of messages) {
    if (m.parent_tool_use_id) continue; // inside a subagent
    if (m.type === "user") {
      const text = typedText(m.message);
      if (!text || INJECTED.test(text.trim())) continue;
      t.turns++;
      if (lastUser && norm(text) === norm(lastUser)) t.repeats++;
      lastUser = text;
    } else if (m.type === "assistant") {
      const msg = m.message as { id?: string; usage?: Record<string, number> } | null;
      // One API response is stored as several transcript lines; count its usage once.
      if (!msg?.usage || (msg.id && seen.has(msg.id))) continue;
      if (msg.id) seen.add(msg.id);
      t.inputTokens += msg.usage.input_tokens ?? 0;
      t.outputTokens += msg.usage.output_tokens ?? 0;
      t.cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0;
    }
  }
  return { id, project: path.basename(cwd || "unknown"), day: localDay(startedAt), totals: t };
}

export interface MetricsSummary {
  days: number;
  core: Totals;
  external: Totals;
  byDay: Array<{ day: string; core: Totals; external: Totals }>;
  byProject: Array<{ project: string; core: Totals; external: Totals }>;
  /** Latest quota report across core sessions. */
  quota?: SessionMetrics["quota"];
}

/** Totals, per day (newest first) and per project, for sessions of the last `days` days. */
export function summarize(core: SessionMetrics[], external: SessionMetrics[], days: number, today = new Date()): MetricsSummary {
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const from = localDay(cutoff.getTime());
  const inRange = (s: SessionMetrics) => s.day >= from;
  const c = core.filter(inRange);
  const e = external.filter(inRange);
  const byDay = new Map<string, { core: Totals; external: Totals }>();
  const byProject = new Map<string, { core: Totals; external: Totals }>();
  const bump = (map: Map<string, { core: Totals; external: Totals }>, key: string, side: "core" | "external", t: Totals) => {
    const row = map.get(key) ?? { core: emptyTotals(), external: emptyTotals() };
    row[side] = add(row[side], t);
    map.set(key, row);
  };
  for (const s of c) {
    bump(byDay, s.day, "core", s.totals);
    bump(byProject, s.project, "core", s.totals);
  }
  for (const s of e) {
    bump(byDay, s.day, "external", s.totals);
    bump(byProject, s.project, "external", s.totals);
  }
  const quota = c
    .map((s) => s.quota)
    .filter((q): q is NonNullable<SessionMetrics["quota"]> => Boolean(q))
    .sort((a, b) => (a.at < b.at ? 1 : -1))[0];
  return {
    days,
    core: c.reduce((acc, s) => add(acc, s.totals), emptyTotals()),
    external: e.reduce((acc, s) => add(acc, s.totals), emptyTotals()),
    byDay: [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, v]) => ({ day, ...v })),
    byProject: [...byProject.entries()].sort((a, b) => b[1].core.turns + b[1].external.turns - (a[1].core.turns + a[1].external.turns)).map(([project, v]) => ({ project, ...v })),
    ...(quota ? { quota } : {}),
  };
}

/** Transcript as chat lines for the read-only view of an outside session. */
export function transcriptLines(messages: TranscriptMessage[]): Array<{ role: "user" | "assistant"; text: string }> {
  const out: Array<{ role: "user" | "assistant"; text: string }> = [];
  for (const m of messages) {
    if (m.parent_tool_use_id) continue;
    if (m.type === "user") {
      const text = typedText(m.message);
      if (text && !INJECTED.test(text.trim())) out.push({ role: "user", text });
    } else if (m.type === "assistant") {
      const content = (m.message as { content?: unknown } | null)?.content;
      const text = Array.isArray(content)
        ? content
            .filter((c) => (c as { type?: string })?.type === "text")
            .map((c) => String((c as { text?: unknown }).text ?? ""))
            .join("\n")
        : "";
      if (!text.trim()) continue;
      const last = out[out.length - 1];
      if (last?.role === "assistant") last.text += `\n\n${text}`;
      else out.push({ role: "assistant", text });
    }
  }
  return out;
}
