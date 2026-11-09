import { describe, expect, it } from "vitest";
import { inlineChanges, looksLikeDiff, parseUnifiedDiff } from "./unifiedDiff";

const CALC = "--- a/calculator.py\n+++ b/calculator.py\n@@ -5 +5 @@\n-b = 10\n+b = 120\n";

describe("looksLikeDiff", () => {
  it("nhận fence diff/patch hoặc nội dung có @@ / ---+++", () => {
    expect(looksLikeDiff("diff", "x")).toBe(true);
    expect(looksLikeDiff(undefined, CALC)).toBe(true);
    expect(looksLikeDiff("python", "a = 1\nb = 2")).toBe(false);
  });
});

describe("parseUnifiedDiff", () => {
  it("diff calculator.py: path, số dòng, đếm +/−", () => {
    const d = parseUnifiedDiff(CALC)!;
    expect(d.path).toBe("calculator.py");
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.hunks).toHaveLength(1);
    expect(d.hunks[0].skippedBefore).toBe(4);
    expect(d.hunks[0].rows).toEqual([
      { kind: "del", text: "b = 10", oldNo: 5 },
      { kind: "add", text: "b = 120", newNo: 5 },
    ]);
  });

  it("nhiều hunk có skippedBefore và ngữ cảnh đánh số", () => {
    const d = parseUnifiedDiff(
      "@@ -1,2 +1,2 @@\n a\n-b\n+B\n@@ -10,2 +10,2 @@\n x\n-y\n+Y\n",
    )!;
    expect(d.hunks).toHaveLength(2);
    expect(d.hunks[0].rows[0]).toEqual({ kind: "ctx", text: "a", oldNo: 1, newNo: 1 });
    expect(d.hunks[1].skippedBefore).toBe(7);
    expect(d.hunks[1].rows[2]).toEqual({ kind: "add", text: "Y", newNo: 11 });
  });

  it("không có @@ vẫn ra hàng nhưng không số dòng", () => {
    const d = parseUnifiedDiff("-old\n+new\n")!;
    expect(d.hunks[0].rows).toEqual([
      { kind: "del", text: "old" },
      { kind: "add", text: "new" },
    ]);
  });

  it("file mới lấy path từ +++ khi --- là /dev/null", () => {
    expect(parseUnifiedDiff("--- /dev/null\n+++ b/src/x.ts\n@@ -0,0 +1 @@\n+a\n")!.path).toBe("src/x.ts");
  });

  it("không có dòng +/− thì null", () => {
    expect(parseUnifiedDiff("@@ -1 +1 @@\n a\n")).toBeNull();
  });
});

describe("inlineChanges", () => {
  it("tô đúng phần đổi 10 → 120", () => {
    const d = parseUnifiedDiff(CALC)!;
    const m = inlineChanges(d.hunks[0].rows);
    expect(m.get(0)).toEqual([4, 6]); // "10"
    expect(m.get(1)).toEqual([4, 7]); // "120"
  });

  it("dòng khác hẳn nhau thì không tô", () => {
    const m = inlineChanges([
      { kind: "del", text: "alpha" },
      { kind: "add", text: "zzzzz" },
    ]);
    expect(m.size).toBe(0);
  });
});
