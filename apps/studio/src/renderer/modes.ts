/** Work modes. Debug and Review are listed in the composer as "coming soon" and have no mode yet. */
export type SessionMode = "agent" | "plan" | "ask";

/** Nhãn hiển thị (khớp menu Composer). */
export const MODE_LABEL: Record<SessionMode, string> = {
  agent: "Agent",
  plan: "Plan",
  ask: "Ask",
};

/** Mode chỉ đọc ở phía UI (Engine mới là nơi thực thi: `SessionMode::read_only`). */
export function isReadOnlyMode(mode: SessionMode): boolean {
  return mode === "ask" || mode === "plan";
}

// Động từ chỉ việc sửa/tạo/xoá (VI + EN). `\p{L}` thay `\b` vì `\b` không hiểu chữ có dấu.
const EDIT_VERBS =
  "sửa|thêm|đổi|xóa|xoá|tạo|viết|cài|thay|cập nhật|fix|add|change|edit|rename|delete|remove|create|implement|refactor|update|write|replace";
const EDIT_RE = new RegExp(`(^|[^\\p{L}])(${EDIT_VERBS})($|[^\\p{L}])`, "iu");

/**
 * Heuristic nhẹ ở UI: câu có vẻ yêu cầu thay đổi code. Chỉ dùng để gợi ý "Gửi bằng Agent"
 * khi đang ở mode chỉ đọc; không chặn gửi và không gọi model.
 */
export function looksLikeEditRequest(text: string): boolean {
  return EDIT_RE.test(text.trim());
}

/** Dòng route hiển thị trong meta của lượt: `Ask · chat → model`. */
export function routeText(mode: SessionMode, taskClass: string, modelId: string): string {
  return `${MODE_LABEL[mode]} · ${taskClass} → ${modelId}`;
}
