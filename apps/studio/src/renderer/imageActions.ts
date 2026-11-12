import { svgDataUrl } from "./components/DiffCard";
import {
  MAX_IMAGE_SIDE,
  copyImageToClipboard,
  fitSize,
  svgFromDataUrl,
  svgToPng,
  svgViewBox,
  writePngToClipboard,
} from "./pastedImages";

/** Ảnh cần chỉnh sửa: data URL + thông tin để điền prompt (tiêu đề hình SVG, đường dẫn workspace). */
export type EditTarget = { src: string; title?: string; path?: string };

export const isSvgDataUrl = (src: string) => /^data:image\/svg\+xml[;,]/i.test(src);

/** Tải một href (data URL / blob URL) về máy qua hộp thoại lưu. */
export function downloadHref(href: string, name: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
}

/** Độ dài tối đa phần tên (không tính đuôi). */
const MAX_NAME_LEN = 60;

/**
 * Chuẩn hoá tên file ảnh: chữ thường, bỏ dấu tiếng Việt (đ → d), từ nối bằng `-`, không dấu cách
 * hay ký tự đặc biệt, bỏ đuôi có sẵn (đuôi thật do định dạng ảnh quyết định), tối đa 60 ký tự
 * (cắt ở ranh giới từ). Rỗng sau khi lọc → `""`.
 */
export function slugFileName(raw: string): string {
  const s = raw
    .trim()
    .replace(/\.(png|jpe?g|gif|webp|svg)$/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length <= MAX_NAME_LEN) return s;
  const cut = s.slice(0, MAX_NAME_LEN + 1);
  const at = cut.lastIndexOf("-");
  return (at > 20 ? cut.slice(0, at) : s.slice(0, MAX_NAME_LEN)).replace(/-+$/, "");
}

/** Tên file model đặt trong SVG (`<svg data-filename="orange-cat-walking-in-park">`). */
export function svgFileNameHint(svg: string): string | null {
  return /<svg\b[^>]*?\bdata-filename\s*=\s*["']([^"']+)["']/i.exec(svg)?.[1] ?? null;
}

/** Đuôi theo định dạng thật của data URL (jpeg → jpg, svg+xml → svg). */
function extOf(src: string): string {
  const mime = /^data:image\/([a-z0-9.+-]+)[;,]/i.exec(src)?.[1]?.toLowerCase() ?? "png";
  return mime === "jpeg" ? "jpg" : mime.replace(/\+.*$/, "");
}

/**
 * Tên file khi tải ảnh, theo thứ tự: tên file workspace (`path`, giữ nguyên vì là file thật) →
 * tên model đặt trong SVG (`data-filename`) → `name` (vd. `<title>`) đã chuẩn hoá → `image-<n>`.
 * Đuôi = `ext` (khi xuất sang định dạng khác, vd. SVG → PNG) hoặc định dạng thật của ảnh.
 */
export function fileNameFor(src: string, opts?: { path?: string; name?: string; n?: number; ext?: string }): string {
  const file = opts?.path?.split(/[\\/]/).pop();
  if (file) return opts?.ext ? file.replace(/\.[a-z0-9]+$/i, "") + `.${opts.ext}` : file;
  const svg = svgFromDataUrl(src);
  const hint = svg ? svgFileNameHint(svg) : null;
  const base = (hint && slugFileName(hint)) || (opts?.name && slugFileName(opts.name)) || `image-${opts?.n ?? 1}`;
  return `${base}.${opts?.ext ?? extOf(src)}`;
}

/** Tải ảnh gốc (SVG giữ là SVG). */
export function downloadImage(src: string, name: string): void {
  downloadHref(src, name);
}

/** Tải PNG: SVG vẽ lại 2x theo `viewBox`, ảnh khác giữ nguyên dữ liệu. */
export async function downloadPng(src: string, name: string): Promise<void> {
  if (!isSvgDataUrl(src)) {
    downloadHref(src, name);
    return;
  }
  downloadBlob(await svgToPng(src, 2), name.replace(/\.svg$/i, ".png"));
}

export { copyImageToClipboard };

async function loadImg(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

/** Kích thước gốc của ảnh: SVG = `viewBox`, ảnh khác = `naturalWidth/Height`. */
export async function imageSize(src: string): Promise<{ w: number; h: number }> {
  const svg = svgFromDataUrl(src);
  const vb = svg ? svgViewBox(svg) : null;
  if (vb) return vb;
  const img = await loadImg(src);
  return { w: img.naturalWidth || 800, h: img.naturalHeight || 600 };
}

/**
 * Ghép ảnh gốc + lớp dấu (SVG, cùng hệ toạ độ `size`) thành PNG. SVG vẽ gấp đôi cho nét;
 * cạnh dài ≤ `MAX_IMAGE_SIDE` (giới hạn gửi model).
 */
export async function flattenImage(src: string, overlaySvg: string, size: { w: number; h: number }): Promise<Blob> {
  const k = isSvgDataUrl(src) ? 2 : 1;
  const out = fitSize(Math.round(size.w * k), Math.round(size.h * k), MAX_IMAGE_SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = out.w;
  canvas.height = out.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");
  ctx.drawImage(await loadImg(src), 0, 0, out.w, out.h);
  ctx.drawImage(await loadImg(svgDataUrl(overlaySvg)), 0, 0, out.w, out.h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
}

export const copyBlob = writePngToClipboard;

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  downloadHref(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
