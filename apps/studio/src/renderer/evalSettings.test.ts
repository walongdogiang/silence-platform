import { describe, expect, it } from "vitest";
import { ciMonthlyCap, parseCap, sameSettings, weeklyCap } from "./evalSettings";
import type { EvalSettings } from "./types";

const settings = (ci: Partial<EvalSettings["ci"]> = {}): EvalSettings => ({
  source: "claude-cli",
  profiles: {
    smoke: { max_cost: 0.5 },
    nightly: { max_cost: 0.3 },
    weekly: { v0_max_cost: 1.2, modes_max_cost: 0.3, auto_max_cost: 0.5 },
  },
  ci: { enabled: true, source: "claude-api", nightly: true, weekly: true, ...ci },
});

describe("ciMonthlyCap", () => {
  it("matches the README budget: 26 × $0.30 + 4 × $2.00", () => {
    expect(weeklyCap(settings())).toBeCloseTo(2.0);
    expect(ciMonthlyCap(settings())).toBeCloseTo(15.8);
  });

  it("is 0 while CI is off and leaves out a run that is off", () => {
    expect(ciMonthlyCap(settings({ enabled: false }))).toBe(0);
    expect(ciMonthlyCap(settings({ nightly: false }))).toBeCloseTo(8);
    expect(ciMonthlyCap(settings({ weekly: false }))).toBeCloseTo(7.8);
  });
});

describe("parseCap", () => {
  it("accepts dollars with a dot or a comma", () => {
    expect(parseCap("0.3")).toBe(0.3);
    expect(parseCap(" 1,5 ")).toBe(1.5);
    expect(parseCap("0")).toBe(0);
    expect(parseCap(".5")).toBe(0.5);
  });

  it("rejects empty, text, negative and over the cap", () => {
    for (const bad of ["", "abc", "-1", "1e3", "1.2.3", "21", "$1"]) expect(parseCap(bad), bad).toBeNull();
    expect(parseCap("30", 50)).toBe(30);
  });
});

describe("sameSettings", () => {
  it("tells whether a save is needed", () => {
    expect(sameSettings(settings(), settings())).toBe(true);
    expect(sameSettings(settings(), { ...settings(), source: "per-task" })).toBe(false);
    expect(sameSettings(settings(), settings({ enabled: false }))).toBe(false);
  });
});
