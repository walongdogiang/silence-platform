import { describe, expect, it, vi } from "vitest";
import { addSpend, autoSummaryShort, engineConfig, poolImpact, shortName, modeSlot, withModeSlot, loadSpend, saveSpend, EMPTY_SPEND, isSideRoute, loadAuto, saveAuto, slotModel, type AutoConfig } from "./autoConfig";
import type { ModelInfo } from "./types";

const m = (id: string, provider: string, tier: string, extra: Partial<ModelInfo> = {}): ModelInfo => ({
  id,
  label: id,
  provider,
  tier,
  context_window: 1,
  tools: true,
  vision: false,
  ...extra,
});

const cat: ModelInfo[] = [
  m("gw-haiku", "gw", "fast", { label: "Claude Haiku 5.5" }),
  m("gw-sonnet", "gw", "mid", { label: "Claude Sonnet 5.5" }),
  m("gw-opus", "gw", "strong", { label: "Claude Opus 5.5" }),
  m("cli-sonnet", "cli", "mid"),
  m("cli-opus", "cli", "strong"),
  m("cli-fable", "cli", "strong", { opt_in: true }),
];

const pick = (cfg: AutoConfig, slot: "frontier" | "strong" | "small", src = "gw") => slotModel(cfg, slot, src, cat)?.id;

describe("Auto config", () => {
  it("balanced: Opus plans, Sonnet does, Haiku helps", () => {
    const cfg: AutoConfig = { preset: "balanced" };
    expect([pick(cfg, "frontier"), pick(cfg, "strong"), pick(cfg, "small")]).toEqual(["gw-opus", "gw-sonnet", "gw-haiku"]);
    expect(autoSummaryShort(cfg, "gw", cat)).toBe("Opus · Sonnet · Haiku");
  });

  it("presets, custom slots and pool match the Engine", () => {
    expect(pick({ preset: "economy" }, "strong")).toBe("gw-haiku");
    expect(pick({ preset: "max" }, "strong")).toBe("gw-opus");
    expect(pick({ preset: "custom", slots: { frontier: "gw-sonnet" } }, "frontier")).toBe("gw-sonnet");
    expect(pick({ preset: "custom", slots: { frontier: "gone" } }, "frontier")).toBe("gw-opus");
    expect(pick({ preset: "balanced", pool: ["gw-haiku", "gw-sonnet"] }, "frontier")).toBe("gw-sonnet");
  });

  it("CLI source: own models, opt-in only via pool", () => {
    expect(pick({ preset: "balanced" }, "frontier", "cli")).toBe("cli-opus");
    expect(pick({ preset: "balanced", pool: ["cli-fable"] }, "frontier", "cli")).toBe("cli-fable");
    // Smallest available when the source has no fast model.
    expect(pick({ preset: "balanced" }, "small", "cli")).toBe("cli-sonnet");
  });

  it("persists per source and drops junk", () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    });
    saveAuto({ gw: { preset: "max", budget_usd: 2 }, bad: { preset: "nope" } as unknown as AutoConfig });
    expect(loadAuto()).toEqual({ gw: { preset: "max", budget_usd: 2 } });
    vi.unstubAllGlobals();
  });

  it("splits spend by slot and keeps the all-Opus baseline", () => {
    let s = addSpend(EMPTY_SPEND, { usd: 0.1, slot: "strong", baseline_usd: 0.3 });
    s = addSpend(s, { usd: 0.01, slot: "small", baseline_usd: 0.05 });
    s = addSpend(s, { usd: 0.2 });
    expect(s.bySlot.strong).toBeCloseTo(0.1);
    expect(s.bySlot.small).toBeCloseTo(0.01);
    expect(s.usd).toBeCloseTo(0.31);
    expect(s.baseline).toBeCloseTo(0.55);
    expect(isSideRoute("subagent:explore") && isSideRoute("title") && !isSideRoute("agent")).toBe(true);
  });

  it("models switched off in Settings stay out of the Engine's pool", () => {
    const visible = cat.filter((x) => x.id !== "gw-opus");
    expect(engineConfig({ preset: "balanced" }, "gw", cat, cat).pool).toEqual([]);
    expect(engineConfig({ preset: "balanced" }, "gw", visible, cat).pool).toEqual(["gw-haiku", "gw-sonnet"]);
    expect(engineConfig({ preset: "balanced", pool: ["gw-opus", "gw-haiku"] }, "gw", visible, cat).pool).toEqual(["gw-haiku"]);
  });

  it("keeps spend per thread, newest threads only", () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    });
    const a = addSpend(EMPTY_SPEND, { usd: 0.4, slot: "strong" });
    saveSpend({ t1: a, t2: a, junk: { usd: "x" } as unknown as typeof a }, ["t1"]);
    expect(loadSpend()).toEqual({ t1: a });
    vi.unstubAllGlobals();
  });

  it("slot per mode: override, back to default removes it", () => {
    const base: AutoConfig = { preset: "balanced" };
    expect(modeSlot(base, "ask")).toBe("strong");
    expect(modeSlot(base, "plan")).toBe("frontier");
    const cheap = withModeSlot(base, "ask", "small");
    expect(cheap.mode_slots).toEqual({ ask: "small" });
    expect(slotModel(cheap, modeSlot(cheap, "ask"), "gw", cat)?.id).toBe("gw-haiku");
    expect(withModeSlot(cheap, "ask", "strong")).toEqual({ preset: "balanced" });
  });

  it("short names and summary fit the picker; pool changes are explained", () => {
    expect(shortName(cat[2])).toBe("Opus 5.5");
    expect(autoSummaryShort({ preset: "balanced" }, "gw", cat)).toBe("Opus · Sonnet · Haiku");
    expect(autoSummaryShort({ preset: "economy" }, "gw", cat)).toBe("Sonnet · Haiku · Haiku");
    expect(poolImpact({ preset: "balanced" }, "gw", cat, ["gw-haiku", "gw-sonnet"])).toEqual([
      { slot: "frontier", model: "Sonnet 5.5" },
    ]);
    expect(poolImpact({ preset: "balanced" }, "gw", cat, ["gw-opus", "gw-sonnet", "gw-haiku"])).toEqual([]);
    expect(poolImpact({ preset: "balanced" }, "gw", cat, [])).toEqual([]);
  });
});
