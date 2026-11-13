import { describe, expect, it } from "vitest";
import { DEFAULT_CODE_FONT, DEFAULT_PREFS, normalizePrefs, transcriptOpen } from "./prefs";

describe("prefs", () => {
  it("falls back to defaults on missing or broken data", () => {
    expect(normalizePrefs(undefined)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs("nope")).toEqual(DEFAULT_PREFS);
    expect(
      normalizePrefs({ transcript: "loud", codeFontSize: 99, autoTitle: "yes", retentionDays: 5, codeFont: "   " }),
    ).toEqual(DEFAULT_PREFS);
  });

  it("keeps valid fields", () => {
    const p = normalizePrefs({ transcript: "verbose", codeFontSize: 15, minimap: true, codeFont: " Fira Code ", retentionDays: 30 });
    expect(p.transcript).toBe("verbose");
    expect(p.codeFontSize).toBe(15);
    expect(p.minimap).toBe(true);
    expect(p.codeFont).toBe("Fira Code");
    expect(p.retentionDays).toBe(30);
    expect(DEFAULT_PREFS.codeFont).toBe(DEFAULT_CODE_FONT);
  });

  it("caps the font string", () => {
    expect(normalizePrefs({ codeFont: "a".repeat(500) }).codeFont.length).toBe(200);
  });
});

describe("transcriptOpen", () => {
  const done = { live: false, thoughtHasBody: true, thinkingLive: false, hasSteps: true, hasThought: true };
  it("compact keeps finished turns folded", () => {
    expect(transcriptOpen("compact", done)).toEqual({ meta: false, thought: true, explored: false, tools: false });
    expect(transcriptOpen("compact", { ...done, live: true }).meta).toBe(true);
  });
  it("thinking keeps the turn and its thought open", () => {
    expect(transcriptOpen("thinking", done)).toEqual({ meta: true, thought: true, explored: false, tools: false });
    expect(transcriptOpen("thinking", { ...done, hasThought: false }).meta).toBe(false);
  });
  it("verbose opens everything", () => {
    expect(transcriptOpen("verbose", done)).toEqual({ meta: true, thought: true, explored: true, tools: true });
  });
});
