import { describe, expect, it } from "vitest";
import { groupModels, isNetworkTab, matchesFilter } from "./networkTabs";
import type { ModelInfo } from "./types";

const m = (id: string, provider?: string, provider_label?: string, kind?: ModelInfo["provider_kind"]): ModelInfo =>
  ({ id, tier: "mid", provider, provider_label, provider_kind: kind }) as ModelInfo;

describe("network tabs", () => {
  it("accepts only known tabs", () => {
    expect(isNetworkTab("auto")).toBe(true);
    expect(isNetworkTab("network")).toBe(false);
    expect(isNetworkTab(null)).toBe(false);
  });

  it("groups models by source and puts extras with OpenRouter", () => {
    const groups = groupModels(
      [
        m("claude-haiku", "or", "OpenRouter", "openai_compat"),
        m("claude-sonnet@cli", "cli", "Claude CLI", "claude_cli"),
        m("google/gemini-2.5-pro"),
      ],
      "Other",
    );
    expect(groups.map((g) => [g.label, g.models.map((x) => x.id)])).toEqual([
      ["OpenRouter", ["claude-haiku", "google/gemini-2.5-pro"]],
      ["Claude CLI", ["claude-sonnet@cli"]],
    ]);
  });

  it("puts extras in an other group without OpenRouter", () => {
    expect(groupModels([m("a/b")], "Other")).toEqual([{ id: "_other", label: "Other", models: [m("a/b")] }]);
  });

  it("filters on title, id and source", () => {
    const x = m("claude-opus@cli", "cli", "Claude CLI");
    expect(matchesFilter(x, "Claude Opus 5.5", "opus")).toBe(true);
    expect(matchesFilter(x, "Claude Opus 5.5", "cli")).toBe(true);
    expect(matchesFilter(x, "Claude Opus 5.5", "gemini")).toBe(false);
    expect(matchesFilter(x, "Claude Opus 5.5", "  ")).toBe(true);
  });
});

describe("focus freshness", () => {
  it("ignores stale or missing focus stamps", async () => {
    const { isFreshFocus } = await import("./networkTabs");
    expect(isFreshFocus(1000, 2000)).toBe(true);
    expect(isFreshFocus(1000, 10_000)).toBe(false);
    expect(isFreshFocus(undefined, 2000)).toBe(false);
    expect(isFreshFocus(0, 2000)).toBe(false);
  });
});

describe("settings drafts", () => {
  it("compares settings ignoring key order and undefined keys", async () => {
    const { sameValue } = await import("./networkTabs");
    expect(sameValue({ preset: "max", pool: ["a"] }, { pool: ["a"], preset: "max" })).toBe(true);
    expect(sameValue({ preset: "max", budget_usd: undefined }, { preset: "max" })).toBe(true);
    expect(sameValue({ pool: ["a", "b"] }, { pool: ["b", "a"] })).toBe(false);
    expect(sameValue({ preset: "max" }, { preset: "economy" })).toBe(false);
  });

  it("resets switches but keeps user-added models", async () => {
    const { defaultPrefs } = await import("./networkTabs");
    const extra = m("a/b");
    expect(defaultPrefs({ disabled: ["x"], enabled: ["y"], extras: [extra] })).toEqual({
      disabled: [],
      enabled: [],
      extras: [extra],
    });
  });
});
