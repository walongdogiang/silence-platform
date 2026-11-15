import { describe, expect, it } from "vitest";
import { applyProgress, liveProgress, replay, type Live } from "./evalLive";
import type { EvalProgress, EvalTaskMetrics } from "./types";

const metrics = (id: string, cost_usd: number): EvalTaskMetrics =>
  ({ id, kind: "edit", status: "PASS", model: "claude-haiku", cost_usd }) as EvalTaskMetrics;

const events: EvalProgress[] = [
  { type: "started", run_id: "r1", suite: "v0", tasks: ["E01", "B06", "X13"] },
  { type: "task_started", id: "E01", model: "claude-haiku", attempt: 1 },
  { type: "task_done", task: metrics("E01", 0.02) },
  { type: "skipped", id: "B06", model: "claude-haiku", reason: "ANTHROPIC_API_KEY not set" },
  { type: "task_started", id: "X13", model: "claude-haiku", attempt: 1 },
];

const fold = (xs: EvalProgress[]) => xs.reduce<Live | null>(applyProgress, null);

describe("eval live state", () => {
  it("folds progress events into rows", () => {
    const live = fold(events)!;
    expect(live.running).toBe(true);
    expect(live.rows.E01.metrics?.cost_usd).toBe(0.02);
    expect(live.rows.B06.skip).toMatch(/not set/);
    expect(live.rows.X13.attempt).toBe(1);
    expect(liveProgress(live)).toEqual({ done: 2, total: 3, usd: 0.02 });
  });

  it("ignores events before a run starts, except a failure", () => {
    expect(applyProgress(null, events[1])).toBeNull();
    expect(applyProgress(null, { type: "failed", message: "boom" })?.failed).toBe("boom");
  });

  it("replay rebuilds a running run and keeps Stop pressed for the same run", () => {
    const prev = { ...fold(events)!, stopping: true };
    const live = replay({ running: true, events }, prev)!;
    expect(live.running).toBe(true);
    expect(live.stopping).toBe(true);
    expect(liveProgress(live).done).toBe(2);
    expect(replay({ running: true, events }, null)!.stopping).toBe(false);
  });

  it("replay of a finished run is not running", () => {
    const summary = { run_id: "r1", suite: "v0", profile: "studio", started_at: "", tasks: [], counts: { pass: 1, fail: 0, error: 0, skip: 1 }, total_cost_usd: 0.02 };
    const done = [...events, { type: "finished", summary } as EvalProgress];
    const live = replay({ running: false, events: done })!;
    expect(live.running).toBe(false);
    expect(live.summary?.counts.pass).toBe(1);
    expect(replay({ running: false, events: [] })).toBeNull();
  });
});
