import type { MsgKey, T } from "./i18n";
import type { ErrorInfo } from "./types";

export type ErrorCopy = {
  title: string;
  body: string;
  hint: string;
  /** Chỉ true khi Engine coi lỗi là tạm thời — nút "Thử lại" mới hiện. */
  canRetry: boolean;
};

/** Error codes with their own copy (`err.<CODE>.title|body|hint` in `i18n.ts`); others → `err.GENERIC`. */
const CODES = [
  "PROVIDER_CREDITS",
  "PROVIDER_AUTH",
  "PROVIDER_REFUSAL",
  "CLI_NOT_FOUND",
  "CLI_AUTH",
  "PROVIDER_RATE",
  "PROVIDER_UNAVAILABLE",
  "NETWORK",
  "TIMEOUT",
] as const;

export function errorCopy(info: ErrorInfo | undefined, t: T): ErrorCopy {
  const code = info && (CODES as readonly string[]).includes(info.code) ? info.code : "GENERIC";
  const k = (part: string) => `err.${code}.${part}` as MsgKey;
  return { title: t(k("title")), body: t(k("body")), hint: t(k("hint")), canRetry: info?.retryable === true };
}

/** Dòng chi tiết kỹ thuật (đã lọc secret ở Engine). */
export function errorDetail(info: ErrorInfo | undefined, message: string): string {
  if (!info) return message;
  const head = info.status ? `${info.code} · HTTP ${info.status}` : info.code;
  return info.detail ? `${head}\n${info.detail}` : head;
}
