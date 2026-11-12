import { describe, expect, it } from "vitest";
import { pickerRows } from "./modelsPrefs";

const m = (id: string, label: string, available?: boolean) => ({ id, label, available });

describe("pickerRows", () => {
  it("hides models of sources that cannot run, keeps names unique without a suffix", () => {
    const models = [
      m("claude-opus", "Claude Opus 5.5"),
      m("north", "North Mini Code"),
      m("claude-opus@api", "Claude Opus 5.5", false), // no Anthropic key
      m("claude-opus@cli", "Claude Opus 5.5", false), // CLI missing
    ];
    const { rows, dupes } = pickerRows(models, "auto");
    expect(rows.map((r) => r.id)).toEqual(["claude-opus", "north"]);
    expect(dupes.size).toBe(0);
  });

  it("marks only same-named rows when two usable sources share a model", () => {
    const models = [
      m("claude-opus", "Claude Opus 5.5"),
      m("north", "North Mini Code"),
      m("claude-opus@api", "Claude Opus 5.5", true),
    ];
    const { rows, dupes } = pickerRows(models, "auto");
    expect(rows).toHaveLength(3);
    expect([...dupes].sort()).toEqual(["claude-opus", "claude-opus@api"]);
  });

  it("keeps the selected model even when its source stopped working", () => {
    const models = [m("claude-opus", "Claude Opus 5.5"), m("claude-opus@api", "Claude Opus 5.5", false)];
    expect(pickerRows(models, "claude-opus@api").rows.map((r) => r.id)).toEqual(["claude-opus", "claude-opus@api"]);
  });
});
