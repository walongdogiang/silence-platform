/** Ảnh gửi từ renderer để ghi vào clipboard: chỉ nhận PNG, tối đa 32 MB. */
export const MAX_CLIPBOARD_IMAGE_BYTES = 32 * 1024 * 1024;

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** `data` có phải PNG hợp lệ về chữ ký và kích thước không (renderer không đáng tin). */
export function isPngBytes(data: unknown): data is Uint8Array {
  if (!(data instanceof Uint8Array)) return false;
  if (data.byteLength < PNG_MAGIC.length || data.byteLength > MAX_CLIPBOARD_IMAGE_BYTES) return false;
  return PNG_MAGIC.every((b, i) => data[i] === b);
}
