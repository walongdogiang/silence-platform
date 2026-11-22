import { describe, expect, it } from "vitest";
import { translator } from "./i18n";
import { parseKeys, parseTip, placeTip } from "./tooltip";

describe("parseKeys", () => {
  it("splits key combos", () => {
    expect(parseKeys("Ctrl+Shift+E")).toEqual(["Ctrl", "Shift", "E"]);
    expect(parseKeys("Ctrl+J")).toEqual(["Ctrl", "J"]);
    expect(parseKeys("Esc")).toEqual(["Esc"]);
    expect(parseKeys("Ctrl+,")).toEqual(["Ctrl", ","]);
  });
  it("rejects plain words and bare letters", () => {
    expect(parseKeys("not wired yet")).toBeNull();
    expect(parseKeys("A")).toBeNull();
    expect(parseKeys("beta")).toBeNull();
    expect(parseKeys("Ctrl+")).toBeNull();
  });
});

describe("parseTip", () => {
  const notes = [translator("en")("common.notWired"), translator("vi")("common.notWired")];

  it("pulls a trailing shortcut out of the label", () => {
    expect(parseTip("Toggle Panel (Ctrl+J)", notes)).toEqual({ label: "Toggle Panel", keys: ["Ctrl", "J"] });
    expect(parseTip(translator("vi")("shell.togglePanelKey"), notes)).toEqual({
      label: "Ẩn/hiện panel",
      keys: ["Ctrl", "J"],
    });
  });

  it("turns the not-wired suffix into a note in both languages", () => {
    expect(parseTip(translator("en")("composer.voice"), notes)).toEqual({ label: "Voice", note: "not wired yet" });
    expect(parseTip(translator("vi")("composer.voice"), notes)).toEqual({ label: "Giọng nói", note: "chưa gắn" });
  });

  it("handles note and shortcut together", () => {
    expect(parseTip("New Terminal (not wired yet) (Ctrl+Shift+`)", notes)).toEqual({
      label: "New Terminal",
      keys: ["Ctrl", "Shift", "`"],
      note: "not wired yet",
    });
  });

  it("leaves other parentheses alone", () => {
    expect(parseTip("Images (max 4)", notes)).toEqual({ label: "Images (max 4)" });
    expect(parseTip("Settings", notes)).toEqual({ label: "Settings" });
    expect(parseTip("(Ctrl+J)", notes)).toEqual({ label: "(Ctrl+J)" });
  });
});

describe("placeTip", () => {
  const vp = { width: 1000, height: 800 };
  const tip = { width: 100, height: 24 };

  it("centers below the anchor by default", () => {
    expect(placeTip({ left: 450, top: 10, width: 100, height: 30 }, tip, vp)).toEqual({ x: 450, y: 46, side: "below" });
  });

  it("flips above when there is no room below", () => {
    expect(placeTip({ left: 450, top: 760, width: 100, height: 30 }, tip, vp)).toEqual({ x: 450, y: 730, side: "above" });
  });

  it("prefer above: above when it fits, below when it does not", () => {
    expect(placeTip({ left: 450, top: 300, width: 100, height: 30 }, tip, vp, 6, 8, "above").side).toBe("above");
    expect(placeTip({ left: 450, top: 10, width: 100, height: 30 }, tip, vp, 6, 8, "above").side).toBe("below");
  });

  it("clamps to the viewport edges", () => {
    expect(placeTip({ left: 0, top: 10, width: 20, height: 20 }, tip, vp).x).toBe(8);
    expect(placeTip({ left: 990, top: 10, width: 10, height: 20 }, tip, vp).x).toBe(892);
  });
});
