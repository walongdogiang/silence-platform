import { describe, expect, it } from "vitest";
import { MSG_KEYS, translator } from "./i18n";
import { SETTINGS_INDEX, fold, isSettingsSection, searchSettings } from "./settingsIndex";

const en = translator("en");
const vi = translator("vi");

describe("settings search", () => {
  it("folds case and Vietnamese diacritics", () => {
    expect(fold("Màu Nhấn Đậm")).toBe("mau nhan dam");
  });

  it("finds settings in the UI language, with or without diacritics", () => {
    expect(searchSettings("accent", en).map((e) => e.id)).toContain("accent");
    expect(searchSettings("màu nhấn", vi).map((e) => e.id)).toContain("accent");
    expect(searchSettings("mau nhan", vi).map((e) => e.id)).toContain("accent");
  });

  it("matches keywords in either language and needs every word", () => {
    expect(searchSettings("hình nền", en).map((e) => e.id)).toEqual(["background"]);
    expect(searchSettings("api key", en).map((e) => e.id)).toEqual(["models-sources"]);
    expect(searchSettings("theme zzz", en)).toEqual([]);
  });

  it("finds the new chat, code and notification rows", () => {
    expect(searchSettings("cỡ chữ", vi).map((e) => e.id)).toContain("code-size");
    expect(searchSettings("thong bao xong", vi).map((e) => e.id)).toContain("notif-done");
    expect(searchSettings("verbose", en).map((e) => e.id)).toEqual(["chat-view"]);
  });

  it("returns nothing for an empty query", () => {
    expect(searchSettings("   ", en)).toEqual([]);
  });

  it("only points at real strings and sections", () => {
    const keys = new Set<string>(MSG_KEYS);
    for (const e of SETTINGS_INDEX) {
      expect(keys.has(e.label), e.label).toBe(true);
      if (e.desc) expect(keys.has(e.desc), e.desc).toBe(true);
      expect(isSettingsSection(e.section)).toBe(true);
    }
    expect(new Set(SETTINGS_INDEX.map((e) => e.id)).size).toBe(SETTINGS_INDEX.length);
  });
});
