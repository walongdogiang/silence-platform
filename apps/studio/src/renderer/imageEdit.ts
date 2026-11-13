/**
 * Logic thuần của trình chỉnh sửa ảnh (`components/ImageEditor.tsx`): các dấu (nét vẽ, chữ,
 * khung, mũi tên, ghim bình luận) theo toạ độ ảnh gốc — SVG thì đơn vị `viewBox`, ảnh raster thì
 * pixel thật — lịch sử undo/redo, xuất dấu thành SVG để ghép lên ảnh, và prompt điền sẵn.
 */

import type { T } from "./i18n";

export type Pt = { x: number; y: number };

export type Mark =
  | { id: string; kind: "stroke"; color: string; width: number; points: Pt[] }
  | { id: string; kind: "rect"; color: string; width: number; a: Pt; b: Pt }
  | { id: string; kind: "arrow"; color: string; width: number; a: Pt; b: Pt }
  | { id: string; kind: "text"; color: string; size: number; at: Pt; text: string }
  | { id: string; kind: "pin"; color: string; size: number; at: Pt; note: string };

export type Tool = "draw" | "text" | "rect" | "arrow" | "pin";

/** Bảng màu như hình tham khảo; đỏ mặc định. */
export const EDIT_COLORS = ["#111111", "#ff4d4f", "#fbbf24", "#22c55e", "#06b6d4", "#d946ef", "#bdbdbd"] as const;
export const DEFAULT_COLOR = EDIT_COLORS[1];

/** Nét, cỡ chữ, cỡ ghim theo kích thước ảnh để nhìn giống nhau dù ảnh to hay nhỏ. */
export function markSizes(w: number, h: number): { stroke: number; text: number; pin: number } {
  const s = Math.min(w, h);
  return {
    stroke: Math.max(2, Math.round(s * 0.007)),
    text: Math.max(14, Math.round(s * 0.045)),
    pin: Math.max(10, Math.round(s * 0.03)),
  };
}

// ---------- Lịch sử ----------

export type History = { past: Mark[][]; present: Mark[]; future: Mark[][]; /** gộp sửa liên tiếp cùng mục */ key?: string };

export const emptyHistory = (): History => ({ past: [], present: [], future: [] });

export type EditAction =
  | { type: "add"; mark: Mark }
  | { type: "update"; id: string; patch: Partial<Mark>; /** gõ chữ liên tục: chỉ một bước undo */ coalesce?: boolean }
  | { type: "remove"; id: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "clear" };

const LIMIT = 100;
const push = (h: History, next: Mark[], key?: string): History => ({
  past: [...h.past, h.present].slice(-LIMIT),
  present: next,
  future: [],
  key,
});

export function editReducer(h: History, a: EditAction): History {
  switch (a.type) {
    case "add":
      return push(h, [...h.present, a.mark]);
    case "update": {
      if (!h.present.some((m) => m.id === a.id)) return h;
      const next = h.present.map((m) => (m.id === a.id ? ({ ...m, ...a.patch, id: m.id, kind: m.kind } as Mark) : m));
      const key = a.coalesce ? `u:${a.id}` : undefined;
      if (key && h.key === key) return { ...h, present: next };
      return push(h, next, key);
    }
    case "remove":
      if (!h.present.some((m) => m.id === a.id)) return h;
      return push(h, h.present.filter((m) => m.id !== a.id));
    case "clear":
      return h.present.length ? push(h, []) : h;
    case "undo": {
      if (!h.past.length) return h;
      return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
    }
    case "redo": {
      if (!h.future.length) return h;
      return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
    }
  }
}

/** Ghim đánh số theo thứ tự tạo (xoá một ghim thì các ghim sau lùi số). */
export function pinsOf(marks: Mark[]): Extract<Mark, { kind: "pin" }>[] {
  return marks.filter((m): m is Extract<Mark, { kind: "pin" }> => m.kind === "pin");
}

// ---------- Toạ độ ----------

/** Điểm trên màn hình → toạ độ ảnh gốc (`box` = khung ảnh đang hiện; kết quả kẹp trong ảnh). */
export function toImagePoint(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }, size: { w: number; h: number }): Pt {
  const x = ((clientX - box.left) / Math.max(1, box.width)) * size.w;
  const y = ((clientY - box.top) / Math.max(1, box.height)) * size.h;
  return { x: Math.min(size.w, Math.max(0, x)), y: Math.min(size.h, Math.max(0, y)) };
}

/** Bỏ điểm sát nhau (< `minDist`) để nét vẽ gọn. */
export function simplify(points: Pt[], minDist: number): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minDist) out.push(p);
  }
  const end = points[points.length - 1];
  if (end && out[out.length - 1] !== end) out.push(end);
  return out;
}

// ---------- Xuất SVG ----------

const r1 = (n: number) => Math.round(n * 10) / 10;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function strokePath(points: Pt[]): string {
  if (!points.length) return "";
  const [p0, ...rest] = points;
  if (!rest.length) return `M${r1(p0.x)} ${r1(p0.y)}l0.01 0`;
  return `M${r1(p0.x)} ${r1(p0.y)}` + rest.map((p) => `L${r1(p.x)} ${r1(p.y)}`).join("");
}

/** Ba đỉnh đầu mũi tên tại `b`, hướng từ `a`. */
export function arrowHead(a: Pt, b: Pt, width: number): Pt[] {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const len = Math.max(10, width * 4.5);
  const spread = Math.PI / 7;
  return [
    b,
    { x: b.x - len * Math.cos(ang - spread), y: b.y - len * Math.sin(ang - spread) },
    { x: b.x - len * Math.cos(ang + spread), y: b.y - len * Math.sin(ang + spread) },
  ];
}

const FONT = "Segoe UI, Arial, sans-serif";

/** Một dấu thành phần tử SVG (chuỗi). `n` = số ghim. Dùng cho cả ảnh xuất và test. */
export function markSvg(m: Mark, n = 0): string {
  switch (m.kind) {
    case "stroke":
      return `<path d="${strokePath(m.points)}" fill="none" stroke="${m.color}" stroke-width="${m.width}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "rect": {
      const x = Math.min(m.a.x, m.b.x);
      const y = Math.min(m.a.y, m.b.y);
      return `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(Math.abs(m.b.x - m.a.x))}" height="${r1(Math.abs(m.b.y - m.a.y))}" rx="${m.width * 1.5}" fill="none" stroke="${m.color}" stroke-width="${m.width}"/>`;
    }
    case "arrow": {
      const head = arrowHead(m.a, m.b, m.width);
      return (
        `<line x1="${r1(m.a.x)}" y1="${r1(m.a.y)}" x2="${r1(m.b.x)}" y2="${r1(m.b.y)}" stroke="${m.color}" stroke-width="${m.width}" stroke-linecap="round"/>` +
        `<polygon points="${head.map((p) => `${r1(p.x)},${r1(p.y)}`).join(" ")}" fill="${m.color}"/>`
      );
    }
    case "text": {
      const lines = m.text.split("\n");
      const tspans = lines.map((l, i) => `<tspan x="${r1(m.at.x)}" dy="${i === 0 ? 0 : m.size * 1.2}">${esc(l) || " "}</tspan>`).join("");
      return `<text x="${r1(m.at.x)}" y="${r1(m.at.y)}" fill="${m.color}" font-family="${FONT}" font-size="${m.size}" font-weight="600" dominant-baseline="hanging" paint-order="stroke" stroke="rgba(0,0,0,0.55)" stroke-width="${Math.max(2, m.size / 8)}">${tspans}</text>`;
    }
    case "pin":
      return (
        `<circle cx="${r1(m.at.x)}" cy="${r1(m.at.y)}" r="${m.size}" fill="${m.color}" stroke="#fff" stroke-width="${Math.max(1.5, m.size / 6)}"/>` +
        `<text x="${r1(m.at.x)}" y="${r1(m.at.y)}" fill="#fff" font-family="${FONT}" font-size="${r1(m.size * 1.1)}" font-weight="700" text-anchor="middle" dominant-baseline="central">${n}</text>`
      );
  }
}

/** Toàn bộ dấu thành một SVG cùng kích thước ảnh gốc (nền trong suốt) để ghép lên ảnh. */
export function marksToSvg(marks: Mark[], w: number, h: number): string {
  let n = 0;
  const body = marks.map((m) => markSvg(m, m.kind === "pin" ? ++n : 0)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
}

// ---------- Prompt ----------

/** Chuỗi điền sẵn composer khi "Gửi cho agent". Ghim có toạ độ để agent sửa đúng chỗ. */
export function editPrompt(
  opts: { title?: string; path?: string; isSvg: boolean; pins: { at: Pt; note: string }[] },
  t: T,
): string {
  const head = opts.title
    ? t("edit.promptTitle", { title: opts.title })
    : opts.path
      ? t("edit.promptPath", { path: opts.path })
      : t("edit.promptThis");
  if (!opts.pins.length) return `${head}: `;
  const unit = opts.isSvg ? t("edit.unitViewBox") : " px";
  const lines = opts.pins.map(
    (p, i) => `${i + 1}. (x=${Math.round(p.at.x)}, y=${Math.round(p.at.y)}${unit}): ${p.note.trim() || "…"}`,
  );
  return `${head}:\n${lines.join("\n")}\n`;
}
