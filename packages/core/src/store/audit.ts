// Global audit trail (`<dataDir>/audit.jsonl`): every decision, tool run and cost, across sessions.
import path from "node:path";
import { appendJsonl, readJsonl } from "./jsonl.js";
import { redactValue } from "./redact.js";

export interface AuditEvent {
  ts: string;
  session: string;
  kind: string;
  tool?: string;
  path?: string;
  inputTokens?: number;
  outputTokens?: number;
  usd?: number;
  detail?: Record<string, unknown>;
}

export class AuditLog {
  readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "audit.jsonl");
  }

  append(e: Omit<AuditEvent, "ts"> & { ts?: string }): Promise<void> {
    return appendJsonl(this.file, redactValue({ ts: new Date().toISOString(), ...e }));
  }

  /** Newest last; `limit` keeps the most recent entries. */
  async query(session?: string, limit = 500): Promise<AuditEvent[]> {
    const all = await readJsonl<AuditEvent>(this.file);
    const hit = session ? all.filter((e) => e.session === session) : all;
    return hit.slice(-limit);
  }
}
