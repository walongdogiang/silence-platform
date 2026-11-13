import { describe, expect, it, vi } from "vitest";
import { failedIds, lastFailed, loadEvalStore, rerunFailed, resetConfig, sanitize, saveEvalStore, withSuite } from "./evalConfig";
import type { EvalCatalog, EvalTaskInfo } from "./types";

const task = (id: string, last?: "PASS" | "FAIL" | "ERROR"): EvalTaskInfo => ({
  id,
  kind: "edit",
  mode: "agent",
  last: last ? { run_id: "1", status: last, model: "claude-haiku", cost_usd: 0.01 } : null,
});

const catalog: EvalCatalog = {
  available: true,
  running: false,
  sources: [{ id: "claude-api", label: "Claude API", kind: "claude_api", available: true, unavailable_reason: "" }],
  suites: [
    { name: "modes", tasks: [task("M01"), task("A01", "FAIL")] },
    { name: "v0", tasks: [task("E01", "PASS"), task("B06", "ERROR"), task("X13")] },
  ],
};

describe("eval config", () => {
  it("reset = v0 with every task, own models, $1 cap, no history", () => {
    expect(resetConfig(catalog)).toEqual({
      suite: "v0",
      tasks: ["E01", "B06", "X13"],
      repeat: 1,
      retry_failed: false,
      max_cost: 1,
      history: false,
    });
  });

  it("drops what the catalog no longer has", () => {
    const c = sanitize(
      { suite: "v0", tasks: ["E01", "GONE"], source: "nope", repeat: 99, retry_failed: false, history: false },
      catalog,
    );
    expect(c.tasks).toEqual(["E01"]);
    expect(c.source).toBeUndefined();
    expect(c.repeat).toBe(5);
    expect(sanitize({ suite: "old", tasks: ["x"], repeat: 1, retry_failed: false, history: false }, catalog).suite).toBe("v0");
  });

  it("switching suite selects its tasks; failed filters", () => {
    expect(withSuite(resetConfig(catalog), "modes", catalog).tasks).toEqual(["M01", "A01"]);
    expect(lastFailed(catalog.suites[1].tasks)).toEqual(["B06"]);
    const run = {
      suite: "v0",
      tasks: [
        { id: "E01", status: "PASS" as const },
        { id: "B06", status: "FAIL" as const },
        { id: "X13", status: "ERROR" as const },
      ],
    };
    expect(failedIds(run)).toEqual(["B06", "X13"]);
    expect(rerunFailed(resetConfig(catalog), run).tasks).toEqual(["B06", "X13"]);
  });

  it("keeps named setups", () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    });
    const cur = resetConfig(catalog);
    saveEvalStore({ current: cur, saved: { quick: { ...cur, tasks: ["E01"] }, bad: { nope: 1 } as never } });
    const s = loadEvalStore();
    expect(s.current).toEqual(cur);
    expect(Object.keys(s.saved)).toEqual(["quick"]);
    vi.unstubAllGlobals();
  });
});
