import { describe, expect, it } from "vitest";
import { diffHunks, summarizeDiff } from "./diffSummary";

describe("summarizeDiff", () => {
  it("đếm một dòng đổi là +1 −1", () => {
    const s = summarizeDiff("a = 70\nb = 2\n", "a = 30\nb = 2\n");
    expect(s.added).toBe(1);
    expect(s.removed).toBe(1);
    expect(s.lines).toEqual([
      { kind: "del", text: "a = 70" },
      { kind: "add", text: "a = 30" },
    ]);
  });

  it("file mới chỉ có dòng thêm", () => {
    const s = summarizeDiff("", "x\ny\n");
    expect(s).toMatchObject({ added: 2, removed: 0 });
  });

  it("không đổi thì rỗng", () => {
    expect(summarizeDiff("x\n", "x\n")).toEqual({ added: 0, removed: 0, lines: [] });
  });

  it("chèn giữa file không đánh dấu dòng khác", () => {
    const s = summarizeDiff("a\nc\n", "a\nb\nc\n");
    expect(s.lines).toEqual([{ kind: "add", text: "b" }]);
  });
});

describe("diffHunks", () => {
  const before = Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join("\n") + "\n";

  it("một dòng đổi giữa file có 3 dòng ngữ cảnh mỗi bên và số dòng đúng", () => {
    const after = before.replace("l10\n", "L10\n");
    const hs = diffHunks(before, after);
    expect(hs).toHaveLength(1);
    expect(hs[0].skippedBefore).toBe(6);
    expect(hs[0].rows.map((r) => r.kind)).toEqual(["ctx", "ctx", "ctx", "del", "add", "ctx", "ctx", "ctx"]);
    expect(hs[0].rows[3]).toEqual({ kind: "del", text: "l10", oldNo: 10 });
    expect(hs[0].rows[4]).toEqual({ kind: "add", text: "L10", newNo: 10 });
    expect(hs[0].rows[7]).toMatchObject({ text: "l13", oldNo: 13, newNo: 13 });
  });

  it("hai thay đổi xa nhau tách thành 2 hunk", () => {
    const after = before.replace("l2\n", "X\n").replace("l18\n", "Y\n");
    const hs = diffHunks(before, after);
    expect(hs).toHaveLength(2);
    expect(hs[0].skippedBefore).toBe(0);
    expect(hs[1].skippedBefore).toBe(9); // l7..l15
  });

  it("file mới chỉ có dòng thêm, đánh số từ 1", () => {
    const hs = diffHunks("", "a\nb\n");
    expect(hs[0].rows).toEqual([
      { kind: "add", text: "a", newNo: 1 },
      { kind: "add", text: "b", newNo: 2 },
    ]);
  });

  it("không đổi thì không có hunk", () => {
    expect(diffHunks("x\n", "x\n")).toEqual([]);
  });
});
