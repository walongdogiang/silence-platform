/** Background processes the agent started (`proc_*` tools) — Ports tab. Spec: docs/frontend/layout.md → Ports. */

export type ProcRow = { id: string; command: string; status: string; urls: string[] };

export type ProcState = "running" | "stopped" | "exited";

/** `exited 1` → `exited`. Unknown text counts as exited (the process is not running). */
export function procState(status: string): ProcState {
  if (status === "running") return "running";
  if (status === "stopped") return "stopped";
  return "exited";
}

/** Exit code from `exited <code>`, if any. */
export function exitCode(status: string): number | undefined {
  const m = /^exited (-?\d+)$/.exec(status);
  return m ? Number(m[1]) : undefined;
}

/** Upsert from a `proc` event. New processes go first; URLs accumulate (the Engine sends all it knows). */
export function applyProc(list: ProcRow[], ev: ProcRow): ProcRow[] {
  const row: ProcRow = { id: ev.id, command: ev.command, status: ev.status, urls: [...ev.urls] };
  const i = list.findIndex((p) => p.id === ev.id);
  if (i < 0) return [row, ...list];
  const next = list.slice();
  next[i] = row;
  return next;
}

/** Running first, then the rest; newest first inside each group (ids are `p<n>`). */
export function sortProcs(list: ProcRow[]): ProcRow[] {
  const n = (id: string) => Number(id.replace(/^\D+/, "")) || 0;
  return list.slice().sort((a, b) => {
    const ra = procState(a.status) === "running" ? 0 : 1;
    const rb = procState(b.status) === "running" ? 0 : 1;
    return ra - rb || n(b.id) - n(a.id);
  });
}

/** Only loopback http(s) URLs are offered as links (the Engine only reports those). */
export function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url);
}
