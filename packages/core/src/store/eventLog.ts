// Per-session event log (`<dataDir>/sessions/<id>/events.jsonl`): the source of truth for the UI,
// audit and metrics (ADR 0004 §11). The backend's own transcript (e.g. ~/.claude/projects) is only
// used to resume. One writer: the core.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { appendJsonl, readJsonl } from "./jsonl.js";
import { redactValue } from "./redact.js";

export const LOG_VERSION = 1;

export type LogBody =
  | { type: "session.start"; cwd: string; backend: string; model?: string; mode: string; title?: string }
  | { type: "session.backend"; backendSessionId: string }
  | { type: "user"; text: string }
  | { type: "event"; event: Record<string, unknown> }
  | { type: "decision"; callId: string; tool: string; tier: string; codes: string[]; action: string; by: "policy" | "user" | "remembered" | "unattended" }
  | { type: "verify"; ok: boolean; commands: string[]; output?: string }
  | { type: "lesson"; text: string }
  | { type: "session.end"; reason: string };

export interface LogRecord {
  v: number;
  seq: number;
  ts: string;
  session: string;
  body: LogBody;
}

export interface SessionSummary {
  id: string;
  cwd: string;
  backend: string;
  title?: string;
  startedAt: string;
  updatedAt: string;
  records: number;
  backendSessionId?: string;
}

const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

export class EventLog {
  private readonly seqs = new Map<string, number>();

  constructor(readonly dataDir: string) {}

  file(session: string): string {
    if (!SAFE_ID.test(session)) throw new Error(`invalid session id: ${session}`);
    return path.join(this.dataDir, "sessions", session, "events.jsonl");
  }

  /** Append one record; strings are redacted. Returns the record as written. */
  async append(session: string, body: LogBody): Promise<LogRecord> {
    let seq = this.seqs.get(session);
    if (seq === undefined) seq = (await this.read(session)).at(-1)?.seq ?? 0;
    seq += 1;
    this.seqs.set(session, seq);
    const rec: LogRecord = { v: LOG_VERSION, seq, ts: new Date().toISOString(), session, body: redactValue(body) };
    await appendJsonl(this.file(session), rec);
    return rec;
  }

  read(session: string): Promise<LogRecord[]> {
    return readJsonl<LogRecord>(this.file(session));
  }

  async list(): Promise<SessionSummary[]> {
    let ids: string[];
    try {
      ids = await readdir(path.join(this.dataDir, "sessions"));
    } catch {
      return [];
    }
    const out: SessionSummary[] = [];
    for (const id of ids.filter((x) => SAFE_ID.test(x))) {
      const recs = await this.read(id);
      const start = recs.find((r) => r.body.type === "session.start");
      if (!start || start.body.type !== "session.start") continue;
      const backendRec = [...recs].reverse().find((r) => r.body.type === "session.backend");
      out.push({
        id,
        cwd: start.body.cwd,
        backend: start.body.backend,
        ...(start.body.title ? { title: start.body.title } : {}),
        startedAt: start.ts,
        updatedAt: recs.at(-1)?.ts ?? start.ts,
        records: recs.length,
        ...(backendRec?.body.type === "session.backend" ? { backendSessionId: backendRec.body.backendSessionId } : {}),
      });
    }
    return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }
}
