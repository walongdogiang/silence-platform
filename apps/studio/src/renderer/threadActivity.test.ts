import { describe, expect, it } from "vitest";
import type { ChatLine } from "./models";
import { activityAt, lastActivityAt } from "./threadActivity";

const base: ChatLine[] = [
  { kind: "user", text: "vẽ mèo", at: 100 },
  { kind: "token", text: "ok" },
  { kind: "worked", ms: 10, at: 200 },
];

describe("thời gian hoạt động của chat", () => {
  it("lấy mốc tin nhắn cuối: tin user gửi hoặc lượt trả lời xong", () => {
    expect(lastActivityAt(base)).toBe(200);
    expect(lastActivityAt([...base, { kind: "user", text: "nữa", at: 300 }])).toBe(300);
  });

  it("thay đổi không phải tin nhắn không đổi thời gian", () => {
    const pinned = base.map((l) => (l.kind === "user" ? { ...l, chapter: "Vẽ mèo" } : l));
    const hydrated = base.map((l) => (l.kind === "user" ? { ...l, images: ["data:image/png;base64,AA"] } : l));
    const sys: ChatLine[] = [...base, { kind: "sys", text: "Engine restarted" }];
    for (const lines of [pinned, hydrated, sys]) expect(activityAt(lines, 999)).toBe(200);
  });

  it("chat không có mốc nào (rỗng / rất cũ) giữ thời gian đang lưu", () => {
    expect(activityAt([], 42)).toBe(42);
    expect(activityAt([{ kind: "user", text: "cũ" }, { kind: "token", text: "x" }], 42)).toBe(42);
  });
});
