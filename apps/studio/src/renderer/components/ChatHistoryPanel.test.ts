import { describe, expect, it } from "vitest";
import type { ChatLine } from "../models";
import { translator } from "../i18n";
import { firstExchange, groupThreads, shownTitle, threadMarkdown, titleFrom, titleLocked } from "./ChatHistoryPanel";
import type { ChatThread } from "../models";

describe("titleFrom", () => {
  it("capitalizes the first letter, including Vietnamese diacritics", () => {
    expect(titleFrom([{ kind: "user", text: "sửa lại biến so_a" }], "Đoạn chat mới")).toBe("Sửa lại biến so_a");
    expect(titleFrom([{ kind: "user", text: "đổi tên file" }], "Đoạn chat mới")).toBe("Đổi tên file");
  });

  it("keeps the rest of the text as typed and still truncates", () => {
    expect(titleFrom([{ kind: "user", text: "fix getUserID bug" }], "Đoạn chat mới")).toBe("Fix getUserID bug");
    const t = titleFrom([{ kind: "user", text: "a".repeat(80) }], "Đoạn chat mới");
    expect(t.length).toBe(48);
    expect(t.endsWith("…")).toBe(true);
  });

  it("falls back when there is no user text", () => {
    expect(titleFrom([], "Đoạn chat mới")).toBe("Đoạn chat mới");
  });

  it("shows a default title in the UI language, keeps real titles", () => {
    const en = translator("en");
    expect(shownTitle("Đoạn chat mới", en)).toBe("New chat");
    expect(shownTitle("Fork · Đoạn chat mới", en)).toBe("Fork · New chat");
    expect(shownTitle("New chat", translator("vi"))).toBe("Đoạn chat mới");
    expect(shownTitle("Sửa lại biến so_a", en)).toBe("Sửa lại biến so_a");
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

describe("groupThreads", () => {
  const now = Date.now();
  const mk = (id: string, extra: Partial<ChatThread> = {}): ChatThread => ({
    id,
    sessionId: "s",
    workspace: "w",
    title: `chat ${id}`,
    preview: "",
    updatedAt: now,
    lines: [{ kind: "user", text: "hi" }],
    ...extra,
  });

  it("puts pinned first and splits archived out of the day groups", () => {
    const r = groupThreads([mk("a"), mk("b", { pinned: true }), mk("c", { archived: true })], "w", "");
    expect(r.groups.map((g) => g.id)).toEqual(["pinned", "today"]);
    expect(r.groups[0].items.map((t) => t.id)).toEqual(["b"]);
    expect(r.groups[1].items.map((t) => t.id)).toEqual(["a"]);
    expect(r.archived.map((t) => t.id)).toEqual(["c"]);
  });

  it("filters archived chats by search too, and skips empty chats and other workspaces", () => {
    const r = groupThreads(
      [mk("a"), mk("x", { archived: true, title: "needle" }), mk("e", { lines: [] }), mk("o", { workspace: "o" })],
      "w",
      "NEED",
    );
    expect(r.groups).toEqual([]);
    expect(r.archived.map((t) => t.id)).toEqual(["x"]);
  });
});

describe("threadMarkdown", () => {
  it("renders user/assistant sections and merges tokens", () => {
    const md = threadMarkdown({
      title: "T",
      lines: [
        { kind: "user", text: "hello" },
        { kind: "route", text: "r" },
        { kind: "token", text: "Hi " },
        { kind: "token", text: "there" },
        { kind: "tool", name: "read", output: "x" },
        { kind: "token", text: "done" },
      ],
    });
    expect(md).toBe("# T\n\n## User\n\nhello\n\n## Assistant\n\nHi there\n\n`read`\n\n```\nx\n```\n\ndone\n");
  });
});
