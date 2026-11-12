import { describe, expect, it } from "vitest";
import {
  effortOptions,
  modelForSource,
  modelSources,
  normalizeEffort,
  placeSubmenu,
  recommendedEffort,
  resolveSource,
} from "./effort";
import type { ModelInfo } from "./types";

const m = (id: string, efforts: string[] = [], default_effort = ""): ModelInfo => ({
  id,
  tier: "mid",
  context_window: 1000,
  tools: true,
  vision: false,
  efforts,
  default_effort,
});

const ALL = ["low", "medium", "high", "xhigh", "max"];
const models = [m("opus", ALL, "medium"), m("lite", ["low", "medium", "high"], "high"), m("free")];

describe("effort", () => {
  it("offers the model's own levels", () => {
    expect(effortOptions("opus", models)).toEqual(ALL);
    expect(effortOptions("free", models)).toEqual([]);
    // Added in Settings: not in the list or no `efforts` field → every level.
    expect(effortOptions("vendor/new", models)).toEqual(ALL);
    const extra = { id: "x", tier: "mid", context_window: 1, tools: true, vision: false };
    expect(effortOptions("x", [extra])).toEqual(ALL);
  });

  it("offers on Auto only the levels every effort-capable model shares", () => {
    expect(effortOptions("auto", models)).toEqual(["low", "medium", "high"]);
  });

  it("marks the model default as recommended; on Auto only a shared default", () => {
    expect(recommendedEffort("opus", models)).toBe("medium");
    expect(recommendedEffort("auto", models)).toBeNull(); // medium vs high
    expect(recommendedEffort("free", models)).toBeNull();
    const same = [m("a", ALL, "medium"), m("b", ["low", "medium"], "medium"), m("free"), m("untuned", ALL)];
    expect(recommendedEffort("auto", same)).toBe("medium");
  });

  describe("model sources", () => {
    const src = (id: string, provider: string, kind: string, tier: string, available = true): ModelInfo => ({
      ...m(id),
      tier,
      provider,
      provider_label: provider.toUpperCase(),
      provider_kind: kind as ModelInfo["provider_kind"],
      available,
      unavailable_reason: available ? "" : "No key",
    });
    const cat = [
      src("or-sonnet", "or", "openai_compat", "mid"),
      src("api-sonnet", "api", "anthropic", "mid", false),
      src("cli-haiku", "cli", "claude_cli", "fast"),
      src("cli-sonnet", "cli", "claude_cli", "mid"),
    ];

    it("lists sources in catalog order with availability", () => {
      const s = modelSources(cat);
      expect(s.map((x) => [x.id, x.available])).toEqual([
        ["or", true],
        ["api", false],
        ["cli", true],
      ]);
      expect(s[1].reason).toBe("No key");
    });

    it("falls back to a usable source when the saved one is gone", () => {
      const s = modelSources(cat);
      expect(resolveSource("cli", s)).toBe("cli");
      expect(resolveSource("gone", s)).toBe("or");
    });

    it("keeps, resets to Auto, or picks the CLI mid model on switch", () => {
      expect(modelForSource("or-sonnet", "or", cat)).toBe("or-sonnet");
      expect(modelForSource("or-sonnet", "api", cat)).toBe("auto");
      expect(modelForSource("auto", "cli", cat)).toBe("cli-sonnet");
      expect(modelForSource("cli-haiku", "cli", cat)).toBe("cli-haiku");
    });
  });

  describe("submenu placement", () => {
    const size = { w: 280, h: 300 };
    const vp = { w: 1400, h: 900 };
    const row = { left: 0, right: 0, top: 820, bottom: 852 };

    it("opens right when there is room", () => {
      const menu = { left: 600, right: 880, top: 400, bottom: 880 };
      const p = placeSubmenu(menu, row, size, vp);
      expect(p.side).toBe("right");
      expect(p.left).toBe(888);
      expect(p.top).toBe(852 - 300);
    });

    it("flips left near the right edge (the clipped case)", () => {
      const menu = { left: 1000, right: 1280, top: 400, bottom: 880 };
      const p = placeSubmenu(menu, row, size, vp);
      expect(p.side).toBe("left");
      expect(p.left).toBe(1000 - 8 - 280);
    });

    it("overlays the menu when neither side fits, staying on screen", () => {
      const narrow = { w: 560, h: 900 };
      const menu = { left: 140, right: 420, top: 400, bottom: 880 };
      const p = placeSubmenu(menu, row, size, narrow);
      expect(p.side).toBe("over");
      expect(p.left).toBeGreaterThanOrEqual(8);
      expect(p.left + size.w).toBeLessThanOrEqual(narrow.w - 8);
    });

    it("clamps vertically inside the viewport", () => {
      const menu = { left: 600, right: 880, top: 0, bottom: 200 };
      const high = { left: 0, right: 0, top: 100, bottom: 120 };
      expect(placeSubmenu(menu, high, size, vp).top).toBe(8);
      const low = { left: 0, right: 0, top: 2000, bottom: 2040 };
      expect(placeSubmenu(menu, low, size, vp).top).toBe(900 - 300 - 8);
    });
  });

  it("drops an unsupported level back to auto on model switch", () => {
    expect(normalizeEffort("max", "lite", models)).toBe("auto");
    expect(normalizeEffort("high", "lite", models)).toBe("high");
    expect(normalizeEffort("auto", "free", models)).toBe("auto");
  });
});
