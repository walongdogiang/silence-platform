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
