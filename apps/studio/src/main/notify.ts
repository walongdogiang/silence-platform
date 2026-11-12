/**
 * Nội dung thông báo desktop khi agent chờ duyệt. Chỉ nhận **lý do** (tiêu đề tầng rủi ro), không bao giờ
 * nhận lệnh hay đường dẫn: thông báo hiện cả trên màn hình khoá và có thể bị chụp lại.
 */
export type Notice = { title: string; body: string };

const MAX_BODY = 90;

export function permissionNotice(reason: unknown): Notice {
  const text = typeof reason === "string" ? reason.replace(/\s+/g, " ").trim() : "";
  const body = text.length > MAX_BODY ? `${text.slice(0, MAX_BODY - 1)}…` : text;
  return { title: "5ilence cần bạn duyệt", body: body || "Agent đang chờ quyết định của bạn." };
}

/** Chỉ báo khi người dùng không nhìn thấy cửa sổ (đang ở app khác, thu nhỏ hoặc ẩn). */
export function shouldNotify(win: { isFocused(): boolean; isMinimized(): boolean; isVisible(): boolean } | null): boolean {
  if (!win) return false;
  return !win.isVisible() || win.isMinimized() || !win.isFocused();
}
