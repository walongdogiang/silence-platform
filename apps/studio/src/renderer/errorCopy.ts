import type { MsgKey, T } from "./i18n";
import type { ErrorInfo } from "./types";

export type ErrorCopy = {
  title: string;
  body: string;
  hint: string;
  /** Chỉ true khi Engine báo lỗi tạm thời (`retryable`). Lỗi chưa phân loại không tự cho thử lại. */
  canRetry: boolean;
  /** Thử lại không giúp được nhưng đổi model/nguồn thì có: thẻ hiện nút "Chọn model khác". */
  canSwitchModel: boolean;
};

/** Error codes with their own copy (`err.<CODE>.title|body|hint` in `i18n.ts`); others → `err.GENERIC`. */
const CODES = [
  "PROVIDER_CREDITS",
  "PROVIDER_AUTH",
  "PROVIDER_REFUSAL",
  "CLI_NOT_FOUND",
  "CLI_AUTH",
  "CLI_LIMIT",
  "PROVIDER_RATE",
  "PROVIDER_UNAVAILABLE",
  "NETWORK",
  "TIMEOUT",
] as const;

/** Mã mà đổi sang model/nguồn khác là cách thoát hợp lý. */
const SWITCHABLE = new Set(["PROVIDER_CREDITS", "PROVIDER_AUTH", "CLI_NOT_FOUND", "CLI_AUTH", "CLI_LIMIT", "PROVIDER_REFUSAL"]);

const REASON_MAX = 220;

/** Lý do ngắn, đọc được, cho thẻ lỗi chung: dòng có chữ đầu tiên, cắt gọn. Message đã lọc secret ở Engine. */
export function errorReason(info: ErrorInfo | undefined, message: string): string {
  const raw = (info?.detail || message || "").replace(/^\s*(error|lỗi)\s*:\s*/i, "");
  const line = raw.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? "";
  return line.length > REASON_MAX ? `${line.slice(0, REASON_MAX - 1).trimEnd()}…` : line;
}

/** "You've hit your 5-hour limit · resets 12pm (Asia/Bangkok)" → "12pm (Asia/Bangkok)". */
export function resetTime(detail: string): string {
  const m = detail.match(/resets?\s+(?:at\s+|on\s+)?([^·\n]+)/i);
  return m ? m[1].trim().replace(/[.\s]+$/, "") : "";
}

export function errorCopy(info: ErrorInfo | undefined, t: T, message = ""): ErrorCopy {
  const known = Boolean(info && (CODES as readonly string[]).includes(info.code));
  const code = known && info ? info.code : "GENERIC";
  const k = (part: string) => `err.${code}.${part}` as MsgKey;
  if (known) {
    let body = t(k("body"));
    if (code === "CLI_LIMIT") {
      const reset = resetTime(info?.detail || message);
      if (reset) body = t("err.CLI_LIMIT.bodyReset" as MsgKey, { reset });
    }
    return {
      title: t(k("title")),
      body,
      hint: t(k("hint")),
      canRetry: info?.retryable === true,
      canSwitchModel: SWITCHABLE.has(code),
    };
  }
  // Lỗi chưa phân loại: nói thẳng lý do thay vì "Đã có lỗi". Không đẩy người dùng thử lại mù quáng.
  const reason = errorReason(info, message);
  return {
    title: t(k("title")),
    body: reason || t(k("body")),
    hint: t(k("hint")),
    // Không có `info` = lỗi phía Studio/Sidecar (Engine chưa sẵn sàng…), thường tạm thời → cho thử lại.
    // Engine đã gửi `info` mà vẫn UNKNOWN: chưa biết nguyên nhân, chỉ thử lại khi Engine nói `retryable`.
    canRetry: info ? info.retryable === true : true,
    canSwitchModel: false,
  };
}

/** Dòng chi tiết kỹ thuật (đã lọc secret ở Engine). Mã không có ý nghĩa (UNKNOWN) thì bỏ, tránh lặp lại thân thẻ. */
export function errorDetail(info: ErrorInfo | undefined, message: string): string {
  if (!info) return message;
  if (info.code === "UNKNOWN" && !info.status && info.detail) return info.detail;
  const head = info.status ? `${info.code} · HTTP ${info.status}` : info.code;
  return info.detail ? `${head}\n${info.detail}` : head;
}
