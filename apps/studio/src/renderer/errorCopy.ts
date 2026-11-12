import type { ErrorInfo } from "./types";

export type ErrorCopy = {
  title: string;
  body: string;
  hint: string;
  /** Chỉ true khi Engine coi lỗi là tạm thời — nút "Thử lại" mới hiện. */
  canRetry: boolean;
};

const COPY: Record<string, Omit<ErrorCopy, "canRetry">> = {
  PROVIDER_CREDITS: {
    title: "Hết credit hoặc hạn mức",
    body: "Tài khoản provider không đủ credit để chạy model này.",
    hint: "Nạp thêm credit ở trang provider (OpenRouter: Settings → Credits) rồi gửi lại.",
  },
  PROVIDER_AUTH: {
    title: "API key không hợp lệ",
    body: "Provider từ chối API key hiện tại.",
    hint: "Nhập lại key ở Settings → Nguồn model (hoặc biến SILENCE_API_KEY / ANTHROPIC_API_KEY), rồi gửi lại.",
  },
  PROVIDER_REFUSAL: {
    title: "Model từ chối yêu cầu",
    body: "Bộ lọc an toàn của model đã từ chối trả lời yêu cầu này.",
    hint: "Diễn đạt lại yêu cầu, hoặc thử model khác.",
  },
  CLI_NOT_FOUND: {
    title: "Không tìm thấy Claude CLI",
    body: "Model này chạy qua lệnh `claude`, nhưng máy chưa cài hoặc lệnh không có trong PATH.",
    hint: "Cài Claude Code rồi mở lại 5ilence, hoặc chọn model từ nguồn khác.",
  },
  CLI_AUTH: {
    title: "Claude CLI chưa đăng nhập",
    body: "Claude CLI đã cài nhưng chưa có phiên đăng nhập hợp lệ.",
    hint: "Chạy `claude` trong terminal để đăng nhập, rồi gửi lại.",
  },
  PROVIDER_RATE: {
    title: "Đang bị giới hạn tạm thời",
    body: "Provider đang giới hạn số yêu cầu.",
    hint: "Đợi một lúc rồi thử lại.",
  },
  PROVIDER_UNAVAILABLE: {
    title: "Máy chủ model đang lỗi",
    body: "Provider không phản hồi được yêu cầu này.",
    hint: "Thử lại sau ít phút hoặc đổi model khác.",
  },
  NETWORK: {
    title: "Mất kết nối mạng",
    body: "Không kết nối được tới provider.",
    hint: "Kiểm tra mạng/proxy rồi thử lại.",
  },
  TIMEOUT: {
    title: "Model phản hồi quá lâu",
    body: "Yêu cầu đã quá thời gian chờ.",
    hint: "Thử lại, hoặc chia nhỏ yêu cầu.",
  },
};

const GENERIC: Omit<ErrorCopy, "canRetry"> = {
  title: "Không chạy được lượt này",
  body: "Đã có lỗi khi xử lý yêu cầu.",
  hint: "Xem “Chi tiết kỹ thuật” hoặc tab Output, rồi gửi lại.",
};

export function errorCopy(info?: ErrorInfo): ErrorCopy {
  const base = (info && COPY[info.code]) || GENERIC;
  return { ...base, canRetry: info?.retryable === true };
}

/** Dòng chi tiết kỹ thuật (đã lọc secret ở Engine). */
export function errorDetail(info: ErrorInfo | undefined, message: string): string {
  if (!info) return message;
  const head = info.status ? `${info.code} · HTTP ${info.status}` : info.code;
  return info.detail ? `${head}\n${info.detail}` : head;
}
