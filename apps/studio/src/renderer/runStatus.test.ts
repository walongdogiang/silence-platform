import { describe, expect, it } from "vitest";
import { addCost, formatDuration, markStopping, pulseLabel, pulseTip, runPhase, startRun } from "./runStatus";

describe("run status pulse", () => {
  it("formats durations like the Worked-for line", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45_900)).toBe("45s");
    expect(formatDuration(72_000)).toBe("1m 12s");
    expect(formatDuration(120_000)).toBe("2m");
    expect(formatDuration(3_780_000)).toBe("1h 3m");
  });

  it("sums cost events across model calls of one turn", () => {
    let m = startRun(1000);
    m = addCost(m, { input_tokens: 1200, output_tokens: 300, usd: 0.001 })!;
    m = addCost(m, { input_tokens: 1800, output_tokens: 5600, usd: 0.02 })!;
    expect(m.inputTokens).toBe(3000);
    expect(m.outputTokens).toBe(5900);
    expect(m.usd).toBeCloseTo(0.021);
    expect(addCost(null, { input_tokens: 1, output_tokens: 1, usd: 0 })).toBeNull();
  });

  it("shows elapsed and output tokens while working", () => {
    const m = addCost(startRun(0), { input_tokens: 10, output_tokens: 5900, usd: 0 });
    expect(pulseLabel(m, 72_000, false)).toBe("Working · 1m 12s · 5.9K tokens");
    expect(pulseLabel(startRun(0), 3_000, false)).toBe("Working · 3s");
  });

  it("stop beats a pending permission", () => {
    const m = startRun(0);
    expect(runPhase(m, true)).toBe("awaiting_permission");
    expect(pulseLabel(m, 5_000, true)).toBe("Waiting for approval · 5s");
    const s = markStopping(m);
    expect(runPhase(s, true)).toBe("stopping");
    expect(pulseLabel(s, 5_000, true)).toBe("Stopping… · 5s");
  });

  it("falls back when no meter exists", () => {
    expect(pulseLabel(null, 0, false)).toBe("Working…");
    expect(pulseTip(null)).toBe("");
  });

  it("tooltip lists input, output and cost", () => {
    const m = addCost(startRun(0), { input_tokens: 12_000, output_tokens: 800, usd: 0.0042 });
    expect(pulseTip(m)).toBe("Lượt này: 12K input · 800 output · $0.0042");
  });
});
