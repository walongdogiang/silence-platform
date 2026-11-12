import { describe, expect, it } from "vitest";
import {
  arrowHead,
  editPrompt,
  editReducer,
  emptyHistory,
  marksToSvg,
  pinsOf,
  simplify,
  toImagePoint,
  type Mark,
} from "./imageEdit";

const pin = (id: string, x: number, y: number, note = ""): Mark => ({ id, kind: "pin", color: "#f00", size: 10, at: { x, y }, note });

describe("lịch sử chỉnh sửa", () => {
  it("add / undo / redo; thao tác mới xoá nhánh redo", () => {
    let h = editReducer(emptyHistory(), { type: "add", mark: pin("a", 1, 1) });
    h = editReducer(h, { type: "add", mark: pin("b", 2, 2) });
    expect(h.present.map((m) => m.id)).toEqual(["a", "b"]);
    h = editReducer(h, { type: "undo" });
    expect(h.present.map((m) => m.id)).toEqual(["a"]);
    h = editReducer(h, { type: "redo" });
    expect(h.present.map((m) => m.id)).toEqual(["a", "b"]);
    h = editReducer(h, { type: "undo" });
    h = editReducer(h, { type: "add", mark: pin("c", 3, 3) });
    expect(h.future).toEqual([]);
    expect(editReducer(h, { type: "redo" })).toBe(h);
  });

  it("gõ chữ liên tục (coalesce) chỉ là một bước undo", () => {
    let h = editReducer(emptyHistory(), { type: "add", mark: pin("a", 1, 1) });
    for (const note of ["c", "cây", "cây hoa"]) h = editReducer(h, { type: "update", id: "a", patch: { note }, coalesce: true });
    expect((h.present[0] as Extract<Mark, { kind: "pin" }>).note).toBe("cây hoa");
    h = editReducer(h, { type: "undo" });
    expect((h.present[0] as Extract<Mark, { kind: "pin" }>).note).toBe("");
  });

  it("remove / clear; undo ở đầu lịch sử thì không đổi", () => {
    let h = editReducer(emptyHistory(), { type: "add", mark: pin("a", 1, 1) });
    h = editReducer(h, { type: "remove", id: "a" });
    expect(h.present).toEqual([]);
    h = editReducer(h, { type: "undo" });
    h = editReducer(h, { type: "clear" });
    expect(h.present).toEqual([]);
    const start = emptyHistory();
    expect(editReducer(start, { type: "undo" })).toBe(start);
  });
});

describe("toạ độ và xuất", () => {
  it("điểm màn hình → toạ độ ảnh gốc, kẹp trong ảnh", () => {
    const box = { left: 100, top: 50, width: 360, height: 240 };
    expect(toImagePoint(280, 170, box, { w: 720, h: 480 })).toEqual({ x: 360, y: 240 });
    expect(toImagePoint(0, 9999, box, { w: 720, h: 480 })).toEqual({ x: 0, y: 480 });
  });

  it("simplify bỏ điểm sát nhau nhưng giữ điểm cuối", () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 5, y: 0 }, { x: 5.2, y: 0 }];
    expect(simplify(pts, 2)).toEqual([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5.2, y: 0 }]);
  });

  it("đầu mũi tên nằm ở điểm cuối và hướng về điểm đầu", () => {
    const [tip, l, r] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
    expect(tip).toEqual({ x: 100, y: 0 });
    expect(l.x).toBeLessThan(100);
    expect(r.x).toBeLessThan(100);
  });

  it("marksToSvg đánh số ghim theo thứ tự, escape chữ", () => {
    const svg = marksToSvg(
      [pin("a", 10, 10), { id: "t", kind: "text", color: "#fff", size: 20, at: { x: 5, y: 5 }, text: "a<b" }, pin("b", 20, 20)],
      720,
      480,
    );
    expect(svg).toContain('viewBox="0 0 720 480"');
    expect(svg).toContain(">1</text>");
    expect(svg).toContain(">2</text>");
    expect(svg).toContain("a&lt;b");
    expect(svg).not.toContain("a<b");
    expect(pinsOf([pin("a", 1, 1), { id: "r", kind: "rect", color: "#f00", width: 2, a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }])).toHaveLength(1);
  });
});

describe("prompt điền sẵn", () => {
  it("hình SVG có ghim: tiêu đề + toạ độ theo viewBox", () => {
    expect(editPrompt({ title: "Mèo", isSvg: true, pins: [{ at: { x: 320.4, y: 210.6 }, note: " đổi cây " }, { at: { x: 1, y: 2 }, note: "" }] })).toBe(
      'Sửa hình "Mèo" theo chỗ đánh dấu trong ảnh đính kèm:\n1. (x=320, y=211 theo viewBox): đổi cây\n2. (x=1, y=2 theo viewBox): …\n',
    );
  });

  it("ảnh workspace / ảnh dán, không ghim", () => {
    expect(editPrompt({ path: "out/cat.png", isSvg: false, pins: [] })).toBe("Sửa ảnh `out/cat.png` theo chỗ đánh dấu trong ảnh đính kèm: ");
    expect(editPrompt({ isSvg: false, pins: [] })).toBe("Sửa ảnh này theo chỗ đánh dấu trong ảnh đính kèm: ");
  });
});
