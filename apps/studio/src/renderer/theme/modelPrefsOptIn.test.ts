import { describe, expect, it } from "vitest";
import { isModelOn, lockedModels, parseModelPrefs, toggleModel, visibleModels } from "./modelsPrefs";
import type { ModelInfo } from "../types";

const m = (id: string, opt_in = false): ModelInfo => ({ id, tier: "strong", context_window: 1, tools: true, vision: false, opt_in });
const catalog = [m("claude-opus@cli"), m("claude-fable@cli", true)];

describe("opt-in models (Fable)", () => {
  it("is hidden by default and shows once switched on", () => {
    const prefs = parseModelPrefs(null);
    expect(visibleModels(catalog, prefs).map((x) => x.id)).toEqual(["claude-opus@cli"]);
    const on = toggleModel(catalog[1], prefs);
    expect(on.enabled).toEqual(["claude-fable@cli"]);
    expect(isModelOn(catalog[1], on)).toBe(true);
    expect(visibleModels(catalog, on).map((x) => x.id)).toEqual(["claude-opus@cli", "claude-fable@cli"]);
    expect(isModelOn(catalog[1], toggleModel(catalog[1], on))).toBe(false);
  });

  it("leaves normal models on the old disabled list", () => {
    const prefs = parseModelPrefs(null);
    const off = toggleModel(catalog[0], prefs);
    expect(off.disabled).toEqual(["claude-opus@cli"]);
    expect(off.enabled).toEqual([]);
    expect(isModelOn(catalog[0], off)).toBe(false);
  });

  it("loads prefs saved before `enabled` existed", () => {
    const old = parseModelPrefs(JSON.stringify({ disabled: ["x"], extras: [] }));
    expect(old).toEqual({ disabled: ["x"], enabled: [], extras: [] });
    expect(parseModelPrefs("not json")).toEqual({ disabled: [], enabled: [], extras: [] });
  });

  it("lists switched-off opt-in models as locked for the picker", () => {
    const prefs = parseModelPrefs(null);
    expect(lockedModels(catalog, prefs).map((x) => x.id)).toEqual(["claude-fable@cli"]);
    expect(lockedModels(catalog, toggleModel(catalog[1], prefs))).toEqual([]);
    expect(lockedModels(catalog, toggleModel(catalog[0], prefs)).map((x) => x.id)).toEqual(["claude-fable@cli"]);
  });
});
