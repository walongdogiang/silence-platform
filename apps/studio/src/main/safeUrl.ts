/** Chỉ cho mở ra trình duyệt ngoài các URL http(s) không kèm thông tin đăng nhập. */
export function isSafeExternalUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  return true;
}

/**
 * Điều hướng của chính app (reload, HMR dev server) thì cho qua; mọi thứ khác phải bị chặn
 * để một link trong câu trả lời không thay cả giao diện app.
 */
export function isAppNavigation(target: string, current: string, devRendererUrl?: string): boolean {
  try {
    const t = new URL(target);
    if (devRendererUrl && t.origin === new URL(devRendererUrl).origin) return true;
    const c = new URL(current);
    return t.protocol === c.protocol && t.host === c.host && t.pathname === c.pathname;
  } catch {
    return false;
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** http(s) tới đúng máy này (localhost / 127.0.0.1 / [::1]), không kèm thông tin đăng nhập. */
export function isLoopbackUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  return LOOPBACK_HOSTS.has(u.hostname.toLowerCase());
}

/**
 * Pane Xem trước gặp một điều hướng: loopback thì ở lại trong pane, http(s) khác ra trình duyệt
 * ngoài, còn lại (file:, javascript:, chrome:, …) thì bỏ.
 */
export function previewNavDecision(raw: string): "allow" | "external" | "deny" {
  if (isLoopbackUrl(raw)) return "allow";
  if (isSafeExternalUrl(raw)) return "external";
  return "deny";
}

/** Chuỗi user gõ vào ô URL → URL đầy đủ (`localhost:5173` → `http://localhost:5173/`), hoặc null. */
export function normalizePreviewInput(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}
