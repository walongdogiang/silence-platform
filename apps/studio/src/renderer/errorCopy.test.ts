import { describe, expect, it } from "vitest";
import { errorCopy, errorDetail } from "./errorCopy";

describe("errorCopy", () => {
  it("hết credit → tiếng Việt, không có nút thử lại", () => {
    const c = errorCopy({ code: "PROVIDER_CREDITS", status: 402, retryable: false, detail: "Insufficient credits" });
    expect(c.title).toBe("Hết credit hoặc hạn mức");
    expect(c.canRetry).toBe(false);
  });

  it("key sai → không retry", () => {
    const c = errorCopy({ code: "PROVIDER_AUTH", status: 401, retryable: false, detail: "" });
    expect(c.title).toBe("API key không hợp lệ");
    expect(c.canRetry).toBe(false);
  });

  it.each([
    ["PROVIDER_RATE", "Đang bị giới hạn tạm thời"],
    ["PROVIDER_UNAVAILABLE", "Máy chủ model đang lỗi"],
    ["NETWORK", "Mất kết nối mạng"],
    ["TIMEOUT", "Model phản hồi quá lâu"],
  ])("%s → retry khi Engine báo retryable", (code, title) => {
    const c = errorCopy({ code, retryable: true, detail: "" });
    expect(c.title).toBe(title);
    expect(c.canRetry).toBe(true);
  });

  it("thiếu info hoặc mã lạ → thông báo chung, không retry", () => {
    expect(errorCopy(undefined).title).toBe("Không chạy được lượt này");
    expect(errorCopy(undefined).canRetry).toBe(false);
    expect(errorCopy({ code: "WHATEVER", retryable: false, detail: "" }).title).toBe("Không chạy được lượt này");
  });

  it("chi tiết kỹ thuật gồm mã + HTTP + detail, không JSON", () => {
    const d = errorDetail({ code: "PROVIDER_CREDITS", status: 402, retryable: false, detail: "Insufficient credits" }, "x");
    expect(d).toBe("PROVIDER_CREDITS · HTTP 402\nInsufficient credits");
    expect(errorDetail(undefined, "Sidecar: boom")).toBe("Sidecar: boom");
  });
});
