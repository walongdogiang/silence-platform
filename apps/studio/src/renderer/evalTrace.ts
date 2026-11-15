/**
 * Eval trace (`eval.task` → `trace`, from `trace.jsonl`) → rows for the Trace tab. A tool call's
 * `tool_start` and `tool_end` become one row (paired by `call_id`) with its duration.
 */
import type { EvalTraceLine } from "./types";

export type TraceItem =
  | { kind: "text" | "thinking" | "plan"; t_ms: number; text: string }
  | { kind: "tool"; t_ms: number; name: string; input: unknown; output?: string; ok?: boolean; ms?: number }
  | { kind: "route"; t_ms: number; model: string; slot: string; purpose: string; escalated: boolean }
  | { kind: "cost"; t_ms: number; input: number; output: number; usd: number }
  | { kind: "diff"; t_ms: number; path: string }
  | { kind: "error"; t_ms: number; text: string }
  | { kind: "note"; t_ms: number; text: string };

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function traceItems(lines: EvalTraceLine[] | undefined | null): TraceItem[] {
  const out: TraceItem[] = [];
  const open = new Map<string, number>();
  for (const l of lines ?? []) {
    const t_ms = num(l.t_ms);
    switch (l.type) {
      case "text":
      case "thinking":
        if (str(l.text).trim()) out.push({ kind: l.type, t_ms, text: str(l.text) });
        break;
      case "plan":
        out.push({ kind: "plan", t_ms, text: str(l.markdown) });
        break;
      case "tool_start":
        open.set(str(l.call_id), out.length);
        out.push({ kind: "tool", t_ms, name: str(l.name), input: l.input });
        break;
      case "tool_end": {
        const i = open.get(str(l.call_id));
        const row = i === undefined ? undefined : out[i];
        if (row && row.kind === "tool") {
          out[i!] = { ...row, output: str(l.output), ok: Boolean(l.ok), ms: Math.max(0, t_ms - row.t_ms) };
          open.delete(str(l.call_id));
        } else {
          out.push({ kind: "tool", t_ms, name: str(l.name), input: undefined, output: str(l.output), ok: Boolean(l.ok) });
        }
        break;
      }
      case "route":
        out.push({ kind: "route", t_ms, model: str(l.model_id), slot: str(l.slot), purpose: str(l.task_class), escalated: Boolean(l.escalated) });
        break;
      case "cost":
        out.push({ kind: "cost", t_ms, input: num(l.input_tokens), output: num(l.output_tokens), usd: num(l.usd) });
        break;
      case "diff":
        out.push({ kind: "diff", t_ms, path: str(l.path) });
        break;
      case "error":
        out.push({ kind: "error", t_ms, text: str(l.message) });
        break;
      case "permission":
        out.push({ kind: "note", t_ms, text: `permission: ${str(l.name)} — ${str(l.reason)}` });
        break;
      case "mode_suggestion":
        out.push({ kind: "note", t_ms, text: `mode_suggestion: ${str(l.mode)} — ${str(l.reason)}` });
        break;
      case "done":
        out.push({ kind: "note", t_ms, text: `done (${str(l.stop)})` });
        break;
      case "truncated":
        out.push({ kind: "note", t_ms, text: "truncated" });
        break;
      default:
        // `trace`, `terminal` and future events: not shown.
        break;
    }
  }
  return out;
}

/** `12.3s` / `850ms` for the time column. */
export function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}
