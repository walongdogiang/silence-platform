import type { ChatLine } from "./models";

/**
 * Thời điểm hoạt động cuối của một chat (như Claude / Cursor: lịch sử xếp theo **tin nhắn cuối**),
 * **suy ra từ nội dung**, không phải "lần cuối state `lines` bị đổi":
 * - tin user: lúc gửi (`user.at`);
 * - câu trả lời: lúc lượt xong (`worked.at`), checkpoint của lượt (`checkpoint.at`).
 *
 * Vì vậy mọi thay đổi không phải tin nhắn — ghim chương, nạp lại ảnh từ IndexedDB, đổi session id
 * khi Engine khởi động lại, mở / chuyển chat, đổi ngôn ngữ — tự nhiên **không** đổi thời gian.
 * Không có mốc nào (chat rỗng, chat rất cũ) → `undefined`: giữ `updatedAt` đang lưu.
 */
export function lastActivityAt(lines: ChatLine[]): number | undefined {
  let max: number | undefined;
  for (const l of lines) {
    const at = l.kind === "user" || l.kind === "worked" || l.kind === "checkpoint" ? l.at : undefined;
    if (typeof at === "number" && at > 0 && (max === undefined || at > max)) max = at;
  }
  return max;
}

/** `updatedAt` mới của thread sau khi `lines` đổi: theo tin nhắn cuối, không có thì giữ nguyên. */
export const activityAt = (lines: ChatLine[], previous: number) => lastActivityAt(lines) ?? previous;
