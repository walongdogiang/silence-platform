import { describe, expect, it } from "vitest";
import { fmtMs, traceItems } from "./evalTrace";
import type { EvalTraceLine } from "./types";

describe("eval trace", () => {
  it("pairs tool calls and keeps the order", () => {
    const lines: EvalTraceLine[] = [
      { type: "route", t_ms: 0, task_class: "agent", model_id: "claude-haiku", slot: "", reason: "" },
      { type: "text", t_ms: 10, text: "Let me look." },
      { type: "tool_start", t_ms: 100, call_id: "c1", name: "read_file", input: { path: "a.py" } },
      { type: "cost", t_ms: 120, input_tokens: 900, output_tokens: 40, usd: 0.001 },
      { type: "tool_end", t_ms: 350, call_id: "c1", name: "read_file", ok: true, output: "x = 1" },
      { type: "text", t_ms: 400, text: "   " },
      { type: "tool_end", t_ms: 500, call_id: "zz", name: "shell", ok: false, output: "blocked" },
      { type: "terminal", t_ms: 600, data: "noise" },
      { type: "done", t_ms: 700, stop: "end_turn" },
    ];
    const items = traceItems(lines);
    expect(items.map((x) => x.kind)).toEqual(["route", "text", "tool", "cost", "tool", "note"]);
    expect(items[2]).toMatchObject({ name: "read_file", ok: true, output: "x = 1", ms: 250, input: { path: "a.py" } });
    expect(items[4]).toMatchObject({ name: "shell", ok: false, input: undefined });
    expect(items[5]).toMatchObject({ text: "done (end_turn)" });
  });

  it("handles a missing trace (attempts from older runs)", () => {
    expect(traceItems(undefined)).toEqual([]);
    expect(traceItems(null)).toEqual([]);
  });

  it("formats durations", () => {
    expect(fmtMs(850)).toBe("850ms");
    expect(fmtMs(12_345)).toBe("12.3s");
  });
});
