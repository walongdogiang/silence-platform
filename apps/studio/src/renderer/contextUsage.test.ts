import { describe, expect, it } from "vitest";
import { contextLevel, contextPct, contextTip, fmtTok, usageRows } from "./contextUsage";
import type { ContextUsage } from "./types";

const usage = (used: number, window: number, measured = true): ContextUsage => ({
  used,
  window,
  model: "claude-haiku",
  measured,
  parts: { system: 1000, rules: 0, tools: 4000, mcp_tools: 0, summarized: 0, conversation: used - 5000 },
});

describe("context usage", () => {
  it("uses the model's own window, not a fixed 256K", () => {
    expect(contextPct(usage(10_000, 1_000_000))).toBe(1);
    expect(contextPct(usage(128_000, 256_000))).toBe(50);
    expect(contextPct(null)).toBe(0);
  });

  it("levels follow the 70% auto-compact threshold", () => {
    expect(contextLevel(69)).toBe("ok");
    expect(contextLevel(70)).toBe("warn");
    expect(contextLevel(90)).toBe("full");
  });

  it("formats tokens incl. 1M windows and marks estimates", () => {
    expect(fmtTok(1_000_000)).toBe("1M");
    expect(fmtTok(6_200)).toBe("6.2K");
    expect(contextTip(usage(6_200, 1_000_000, false))).toBe("Context · ~6.2K / 1M (1%)");
    expect(contextTip(usage(6_200, 1_000_000))).toBe("Context · 6.2K / 1M (1%)");
  });

  it("rows come from engine parts", () => {
    const rows = usageRows(usage(7_000, 1_000_000));
    expect(rows.find((r) => r.label === "Tool definitions")?.n).toBe(4000);
    expect(rows.find((r) => r.label === "Conversation")?.n).toBe(2000);
  });
});
