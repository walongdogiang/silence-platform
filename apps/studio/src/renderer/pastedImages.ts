import type { T } from "./i18n";
import type { ChatThread } from "./models";

/** Giới hạn khớp Engine (`crates/runtime/src/images.rs`). */
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
/** Cạnh dài tối đa trước khi gửi: lớn hơn thì thu nhỏ (model cũng tự thu, chỉ tốn token). */
export const MAX_IMAGE_SIDE = 2048;

export type PasteResult = { images: string[]; error?: string };

/** Protocol đầu tiên Engine nhận `images` trên `session.prompt`; Engine cũ bỏ qua trường này im lặng. */
export const IMAGES_MIN_PROTOCOL = "0.1.7";

/** `version` (từ `ping`) có nhận ảnh không. So từng số `a.b.c`; thiếu / lạ → không. */
export function supportsImages(version: unknown): boolean {
  if (typeof version !== "string" || !/^\d+(\.\d+)*$/.test(version)) return false;
  const a = version.split(".").map(Number);
  const b = IMAGES_MIN_PROTOCOL.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

async function readAsDataUrl(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  // Từng khúc 32K để không vượt giới hạn tham số của String.fromCharCode.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${file.type};base64,${btoa(bin)}`;
}

/** Kích thước mới giữ tỉ lệ, cạnh dài ≤ `max`; nhỏ hơn thì giữ nguyên. */
export function fitSize(w: number, h: number, max = MAX_IMAGE_SIDE): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= max || long <= 0) return { w, h };
  const k = max / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

async function encode(bitmap: ImageBitmap, w: number, h: number, type: string, quality?: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  return canvas.convertToBlob({ type, quality });
}

/**
 * Thu nhỏ ảnh quá cạnh `MAX_IMAGE_SIDE` hoặc quá `MAX_IMAGE_BYTES`: ra PNG, vẫn quá nặng thì
 * WebP 0.85. GIF giữ nguyên (giữ animation). Không có canvas (test/Node) → trả file gốc.
 */
export async function prepareImage(file: File): Promise<Blob> {
  if (file.type === "image/gif" || typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }
  try {
    const { w, h } = fitSize(bitmap.width, bitmap.height);
    if (w === bitmap.width && file.size <= MAX_IMAGE_BYTES) return file;
    const png = await encode(bitmap, w, h, "image/png");
    if (png.size <= MAX_IMAGE_BYTES) return png;
    return await encode(bitmap, w, h, "image/webp", 0.85);
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}

/**
 * Ảnh (dán / kéo-thả / chọn file) → data URL: thu nhỏ ảnh lớn, bỏ ảnh sai loại / vẫn quá lớn /
 * vượt số lượng. `have` = số ảnh đang đính kèm. Trả `error` (ngôn ngữ UI, qua `t`) nếu có ảnh bị bỏ.
 */
export async function imagesFromFiles(files: File[], have: number, t: T): Promise<PasteResult> {
  const images: string[] = [];
  let error: string | undefined;
  for (const f of files) {
    if (!IMAGE_TYPES.includes(f.type)) {
      error = f.type ? t("img.badType", { type: f.type }) : t("img.badTypeUnknown");
      continue;
    }
    if (have + images.length >= MAX_IMAGES) {
      error = t("img.tooMany", { n: MAX_IMAGES });
      break;
    }
    const blob = await prepareImage(f);
    if (blob.size > MAX_IMAGE_BYTES) {
      error = t(f.type === "image/gif" ? "img.tooBigGif" : "img.tooBig", { mb: MAX_IMAGE_BYTES / 1024 / 1024 });
      continue;
    }
    images.push(await readAsDataUrl(blob.type ? blob : new Blob([blob], { type: f.type })));
  }
  return { images, error };
}

/** File ảnh trong clipboard hoặc kéo-thả (bỏ qua chữ). */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromItems = Array.from(data.items ?? [])
    .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
    .map((it) => it.getAsFile())
    .filter((f): f is File => f !== null);
  if (fromItems.length) return fromItems;
  return Array.from(data.files ?? []).filter((f) => f.type.startsWith("image/"));
}

/** Kéo vào có mang file ảnh không (lúc dragover chưa đọc được file, chỉ thấy kiểu). */
export function dragHasImage(data: DataTransfer | null): boolean {
  return Array.from(data?.items ?? []).some((it) => it.kind === "file" && it.type.startsWith("image/"));
}

/** `viewBox` của SVG (đọc được cả khi SVG còn đang stream dở, miễn thuộc tính đã đủ). */
export function svgViewBox(svg: string): { w: number; h: number } | null {
  const m = /<svg\b[^>]*?\bviewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)\s*["']/i.exec(svg);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h) ? { w, h } : null;
}

/** Chữ SVG trong data URL `data:image/svg+xml…` (utf-8 hoặc base64); không phải SVG → null. */
export function svgFromDataUrl(dataUrl: string): string | null {
  const m = /^data:image\/svg\+xml(;[^,]*)?,(.*)$/is.exec(dataUrl);
  if (!m) return null;
  try {
    return /;base64/i.test(m[1] ?? "") ? new TextDecoder().decode(Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0))) : decodeURIComponent(m[2]);
  } catch {
    return null;
  }
}

/**
 * Vẽ ảnh qua thẻ `<img>` (đọc được cả SVG, thứ `createImageBitmap(blob)` không nhận).
 * `size`: kích thước muốn ra (SVG chỉ có `viewBox` thì `naturalWidth` không đáng tin).
 */
async function rasterizeViaImg(dataUrl: string, size?: { w: number; h: number }): Promise<Blob> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const { w, h } = fitSize(size?.w ?? (img.naturalWidth || 800), size?.h ?? (img.naturalHeight || 600), 4096);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"),
  );
}

/**
 * Ghi PNG vào clipboard. Trong app: qua main process (`window.silence.copyImage`, không cần quyền
 * của trang). Không có (trình duyệt/test): Clipboard API của trang. Lỗi → ném để UI báo.
 */
export async function writePngToClipboard(png: Blob): Promise<void> {
  const bridge = typeof window !== "undefined" ? window.silence?.copyImage : undefined;
  if (bridge) {
    if (await bridge(new Uint8Array(await png.arrayBuffer()))) return;
    throw new Error("copy image refused");
  }
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

/**
 * Data URL → Blob, giải mã tại chỗ. Không dùng `fetch(dataUrl)`: CSP của Studio (`connect-src`)
 * không cho `data:` nên fetch hỏng trong app (ngoài app thì chạy, dễ tưởng là ổn).
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]*)((?:;[^;,]*)*),(.*)$/is.exec(dataUrl);
  if (!m) throw new Error("not a data URL");
  const type = (m[1] || "text/plain").toLowerCase();
  if (/;base64/i.test(m[2])) {
    return new Blob([Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0))], { type });
  }
  return new Blob([decodeURIComponent(m[3])], { type });
}

/** PNG đã vẽ lại (SVG / ảnh không phải PNG), theo data URL: copy lại không phải vẽ lại. Giữ vài ảnh gần nhất. */
const PNG_CACHE_MAX = 8;
const pngCache = new Map<string, Blob>();
/** Lần copy đang chạy theo data URL: bấm dồn thì dùng chung, không vẽ / ghi clipboard thêm lần nữa. */
const copying = new Map<string, Promise<void>>();

async function pngFor(dataUrl: string): Promise<Blob> {
  const hit = pngCache.get(dataUrl);
  if (hit) {
    pngCache.delete(dataUrl);
    pngCache.set(dataUrl, hit); // mới dùng → cuối hàng
    return hit;
  }
  const blob = dataUrlToBlob(dataUrl);
  if (blob.type === "image/png") return blob;
  const png = blob.type === "image/svg+xml" ? await svgToPng(dataUrl) : await rasterizeViaImg(dataUrl);
  pngCache.set(dataUrl, png);
  if (pngCache.size > PNG_CACHE_MAX) pngCache.delete(pngCache.keys().next().value as string);
  return png;
}

/**
 * Copy ảnh (data URL) như "Copy as image": ra PNG (SVG vẽ lại 2x, ảnh khác giữ nếu đã là PNG).
 * Bấm lại khi lần trước chưa xong → trả đúng lần đang chạy (không chạy song song, không giật trạng thái).
 */
export function copyImageToClipboard(dataUrl: string): Promise<void> {
  const running = copying.get(dataUrl);
  if (running) return running;
  const job = (async () => writePngToClipboard(await pngFor(dataUrl)))().finally(() => copying.delete(dataUrl));
  copying.set(dataUrl, job);
  return job;
}

/** SVG (data URL) → PNG nét gấp `scale` lần `viewBox` (mặc định 2x, tối đa 4096 px mỗi cạnh). */
export async function svgToPng(dataUrl: string, scale = 2): Promise<Blob> {
  const svg = svgFromDataUrl(dataUrl);
  const vb = svg ? svgViewBox(svg) : null;
  return rasterizeViaImg(dataUrl, vb ? { w: Math.round(vb.w * scale), h: Math.round(vb.h * scale) } : undefined);
}

/**
 * Lịch sử chat lưu localStorage (~5 MB): bỏ base64 ảnh. Giữ `imageIds` (ảnh nằm trong
 * IndexedDB, `imageStore.ts`) và số ảnh để còn hiện "N ảnh" khi IndexedDB mất ảnh.
 */
export function threadsForStorage(threads: ChatThread[]): ChatThread[] {
  return threads.map((t) =>
    t.lines.some((l) => l.kind === "user" && l.images?.length)
      ? {
          ...t,
          lines: t.lines.map((l) => {
            if (l.kind !== "user" || !l.images?.length) return l;
            const { images, ...rest } = l;
            return { ...rest, imageCount: Math.max(l.imageCount ?? 0, images.length) };
          }),
        }
      : t,
  );
}
