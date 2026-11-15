/**
 * Live state of the Studio eval run, kept at App level so closing the Evals page (or reloading
 * the window) does not lose progress. Events come from `eval.progress`; on start-up the App asks
 * `eval.status` for every event of the current (or last) run and replays them here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { EvalLiveStatus, EvalProgress, EvalRunSummary, EvalTaskMetrics } from "./types";

export type LiveRow = { id: string; model: string; attempt?: number; metrics?: EvalTaskMetrics; skip?: string };
export type Live = {
  run_id: string;
  suite: string;
  order: string[];
  rows: Record<string, LiveRow>;
  running: boolean;
  stopping: boolean;
  summary?: EvalRunSummary;
  failed?: string;
};

/** Apply one progress event. `failed` before any `started` (bad config) still shows. */
export function applyProgress(cur: Live | null, p: EvalProgress): Live | null {
  if (p.type === "started") {
    const rows: Record<string, LiveRow> = {};
    for (const id of p.tasks) rows[id] = { id, model: "" };
    return { run_id: p.run_id, suite: p.suite, order: p.tasks, rows, running: true, stopping: false };
  }
  if (!cur) {
    return p.type === "failed"
      ? { run_id: "", suite: "", order: [], rows: {}, running: false, stopping: false, failed: p.message }
      : null;
  }
  const rows = { ...cur.rows };
  if (p.type === "task_started") rows[p.id] = { ...rows[p.id], id: p.id, model: p.model, attempt: p.attempt };
  if (p.type === "skipped") rows[p.id] = { id: p.id, model: p.model, skip: p.reason };
  if (p.type === "task_done") rows[p.task.id] = { id: p.task.id, model: p.task.model, metrics: p.task };
  if (p.type === "finished") return { ...cur, rows, running: false, stopping: false, summary: p.summary };
  if (p.type === "failed") return { ...cur, rows, running: false, stopping: false, failed: p.message };
  return { ...cur, rows };
}

/** Rebuild the view from `eval.status`. A run the Engine still reports as running stays running. */
export function replay(status: EvalLiveStatus, prev: Live | null = null): Live | null {
  let live: Live | null = null;
  for (const p of status.events ?? []) live = applyProgress(live, p);
  if (!live) return null;
  if (status.running && !live.summary && !live.failed) {
    live = { ...live, running: true, stopping: Boolean(prev?.running && prev.run_id === live.run_id && prev.stopping) };
  }
  return live;
}

/** Tasks finished (done or skipped) out of the run's tasks, and money spent so far. */
export function liveProgress(live: Live | null): { done: number; total: number; usd: number } {
  if (!live) return { done: 0, total: 0, usd: 0 };
  let done = 0;
  let usd = 0;
  for (const id of live.order) {
    const r = live.rows[id];
    if (r?.metrics || r?.skip) done += 1;
    usd += r?.metrics?.cost_usd ?? 0;
  }
  return { done, total: live.order.length, usd };
}

/**
 * App-level hook. `ended` increases each time a run ends while this window listens (not on
 * replay), so the page can refresh its catalog and the App can send a notification.
 */
export function useEvalLive(onEnd?: (live: Live) => void) {
  const [live, setLiveState] = useState<Live | null>(null);
  const [ended, setEnded] = useState(0);
  // Events are folded outside React's updater so `onEnd` runs once per event (StrictMode safe).
  const ref = useRef<Live | null>(null);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const setLive = useCallback((next: Live | null) => {
    ref.current = next;
    setLiveState(next);
  }, []);

  const sync = useCallback(async () => {
    try {
      const s = (await window.silence?.rpc("eval.status")) as EvalLiveStatus | undefined;
      if (s) setLive(replay(s, ref.current));
    } catch {
      // Older Engine without `eval.status`: keep what the events gave.
    }
  }, [setLive]);

  useEffect(() => {
    void sync();
    const off = window.silence?.onEval?.((payload) => {
      const p = payload as EvalProgress;
      const next = applyProgress(ref.current, p);
      setLive(next);
      if (p.type === "finished" || p.type === "failed") {
        setEnded((n) => n + 1);
        if (next) onEndRef.current?.(next);
      }
    });
    return () => off?.();
  }, [sync, setLive]);

  const markStopping = useCallback(() => {
    if (ref.current) setLive({ ...ref.current, stopping: true });
  }, [setLive]);
  return { live, ended, sync, markStopping };
}

/** Share of a task's input tokens served from the prompt cache, e.g. `72%`; `–` when unknown. */
export function fmtCacheHit(m: Pick<EvalTaskMetrics, "input_tokens" | "cache_read_tokens">): string {
  if (!m.input_tokens) return "–";
  return `${Math.round((100 * (m.cache_read_tokens ?? 0)) / m.input_tokens)}%`;
}
