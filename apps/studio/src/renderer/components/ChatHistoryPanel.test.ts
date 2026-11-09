import { describe, expect, it } from "vitest";
import type { ChatLine } from "../models";
import { firstExchange, titleFrom, titleLocked } from "./ChatHistoryPanel";

describe("titleFrom", () => {
  it("capitalizes the first letter, including Vietnamese diacritics", () => {
    expect(titleFrom([{ kind: "user", text: "sửa lại biến so_a" }])).toBe("Sửa lại biến so_a");
    expect(titleFrom([{ kind: "user", text: "đổi tên file" }])).toBe("Đổi tên file");
  });

  it("keeps the rest of the text as typed and still truncates", () => {
    expect(titleFrom([{ kind: "user", text: "fix getUserID bug" }])).toBe("Fix getUserID bug");
    const t = titleFrom([{ kind: "user", text: "a".repeat(80) }]);
    expect(t.length).toBe(48);
    expect(t.endsWith("…")).toBe(true);
  });

  it("falls back when there is no user text", () => {
    expect(titleFrom([])).toBe("Đoạn chat mới");
  });
});

describe("firstExchange", () => {
  it("returns null before the first reply arrives", () => {
    expect(firstExchange([])).toBeNull();
    expect(firstExchange([{ kind: "user", text: "hi" }])).toBeNull();
  });

  it("joins streamed tokens of the first turn only", () => {
    const lines: ChatLine[] = [
      { kind: "user", text: " sửa so_a thành 70 " },
      { kind: "narrate", verb: "Read" },
      { kind: "token", text: "Đã " },
      { kind: "token", text: "sửa." },
      { kind: "user", text: "cảm ơn" },
      { kind: "token", text: "Không có gì" },
    ];
    expect(firstExchange(lines)).toEqual({ user: "sửa so_a thành 70", reply: "Đã sửa." });
  });

  it("skips a first turn that failed without any reply", () => {
    const lines: ChatLine[] = [
      { kind: "user", text: "lần 1" },
      { kind: "error", message: "timeout" },
      { kind: "user", text: "lần 2" },
      { kind: "token", text: "ok" },
    ];
    expect(firstExchange(lines)).toEqual({ user: "lần 2", reply: "ok" });
  });
});

describe("titleLocked", () => {
  it("locks AI, user and fork titles", () => {
    expect(titleLocked({})).toBe(false);
    expect(titleLocked({ titleSource: "auto" })).toBe(false);
    expect(titleLocked({ titleSource: "ai" })).toBe(true);
    expect(titleLocked({ titleSource: "user" })).toBe(true);
    expect(titleLocked({ forkedFromId: "x" })).toBe(true);
  });
});
