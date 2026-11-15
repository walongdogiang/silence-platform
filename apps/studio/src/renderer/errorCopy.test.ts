import { describe, expect, it } from "vitest";
import { errorCopy, errorDetail, errorReason, resetTime } from "./errorCopy";
import { translator } from "./i18n";

const vi = translator("vi");
const en = translator("en");

describe("errorCopy", () => {
  it("hết credit → tiếng Việt, không có nút thử lại", () => {
    const c = errorCopy({ code: "PROVIDER_CREDITS", status: 402, retryable: false, detail: "Insufficient credits" }, vi);
    expect(c.title).toBe("Hết credit hoặc hạn mức");
    expect(c.canRetry).toBe(false);
  });

  it("key sai → không retry", () => {
    const c = errorCopy({ code: "PROVIDER_AUTH", status: 401, retryable: false, detail: "" }, vi);
    expect(c.title).toBe("API key không hợp lệ");
    expect(c.canRetry).toBe(false);
  });

  it.each([
    ["PROVIDER_RATE", "Đang bị giới hạn tạm thời"],
    ["PROVIDER_UNAVAILABLE", "Máy chủ model đang lỗi"],
    ["NETWORK", "Mất kết nối mạng"],
    ["TIMEOUT", "Model phản hồi quá lâu"],
  ])("%s → retry khi Engine báo retryable", (code, title) => {
    const c = errorCopy({ code, retryable: true, detail: "" }, vi);
    expect(c.title).toBe(title);
    expect(c.canRetry).toBe(true);
  });

  it("hết hạn mức gói Claude → nêu giờ reset, không retry, có nút đổi model", () => {
    const info = { code: "CLI_LIMIT", retryable: false, detail: "You've hit your 5-hour limit · resets 12pm (Asia/Bangkok)" };
    const c = errorCopy(info, vi);
    expect(c.title).toBe("Đã hết hạn mức gói Claude");
    expect(c.body).toBe("Gói Claude của bạn đã hết lượt dùng. Sẽ reset 12pm (Asia/Bangkok).");
    expect(c.canRetry).toBe(false);
    expect(c.canSwitchModel).toBe(true);
    expect(errorCopy({ ...info, detail: "usage limit reached" }, vi).body).toContain("không còn lượt dùng");
    expect(resetTime(info.detail)).toBe("12pm (Asia/Bangkok)");
  });

  it("UNKNOWN từ Engine: không tự cho thử lại; bỏ dòng mã thừa trong chi tiết", () => {
    const info = { code: "UNKNOWN", retryable: false, detail: "something odd" };
    expect(errorCopy(info, vi).canRetry).toBe(false);
    expect(errorDetail(info, "x")).toBe("something odd");
    expect(errorCopy({ ...info, retryable: true }, vi).canRetry).toBe(true);
  });

  it("thiếu info hoặc mã lạ → tiêu đề chung, nêu lý do thật; lỗi phía Studio vẫn thử lại được", () => {
    const c = errorCopy(undefined, vi, "Error: unknown session abc\n  at foo");
    expect(c.title).toBe("Không chạy được lượt này");
    expect(c.body).toBe("unknown session abc");
    expect(c.canRetry).toBe(true);
    expect(errorCopy(undefined, vi).body).toBe("Đã có lỗi khi xử lý yêu cầu.");
    const odd = errorCopy({ code: "WHATEVER", retryable: false, detail: "model not found: x" }, vi);
    expect(odd.title).toBe("Không chạy được lượt này");
    expect(odd.body).toBe("model not found: x");
    expect(odd.canRetry).toBe(false);
  });

  it("lý do quá dài được cắt gọn", () => {
    expect(errorReason(undefined, "x".repeat(500)).length).toBe(220);
  });

  it("follows the UI language", () => {
    expect(errorCopy({ code: "NETWORK", retryable: true, detail: "" }, en).title).toBe("Network connection lost");
  });

  it("chi tiết kỹ thuật gồm mã + HTTP + detail, không JSON", () => {
    const d = errorDetail({ code: "PROVIDER_CREDITS", status: 402, retryable: false, detail: "Insufficient credits" }, "x");
    expect(d).toBe("PROVIDER_CREDITS · HTTP 402\nInsufficient credits");
    expect(errorDetail(undefined, "Sidecar: boom")).toBe("Sidecar: boom");
  });
});
