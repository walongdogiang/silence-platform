import { describe, expect, it } from "vitest";
import { isReadOnlyMode, looksLikeEditRequest, routeText } from "./modes";

describe("looksLikeEditRequest", () => {
  it("nhận yêu cầu sửa tiếng Việt, kể cả chữ có dấu", () => {
    expect(looksLikeEditRequest("sửa lại biến so_a thành 25 giúp tôi")).toBe(true);
    expect(looksLikeEditRequest("Thêm hàm pow_int vào calc.py")).toBe(true);
    expect(looksLikeEditRequest("đổi tên hàm này")).toBe(true);
    expect(looksLikeEditRequest("cập nhật README")).toBe(true);
  });

  it("nhận yêu cầu sửa tiếng Anh", () => {
    expect(looksLikeEditRequest("Fix the failing test")).toBe(true);
    expect(looksLikeEditRequest("please add a docstring")).toBe(true);
  });

  it("không nhận câu hỏi thuần đọc", () => {
    expect(looksLikeEditRequest("giải thích cấu trúc project này")).toBe(false);
    expect(looksLikeEditRequest("hàm mul làm gì?")).toBe(false);
    expect(looksLikeEditRequest("")).toBe(false);
  });

  it("không khớp một phần của từ khác", () => {
    expect(looksLikeEditRequest("address the prefix")).toBe(false); // 'add' trong 'address'
    expect(looksLikeEditRequest("thêmnữa")).toBe(false);
  });
});

describe("modes", () => {
  it("chỉ đọc: ask, review, plan", () => {
    expect(isReadOnlyMode("ask")).toBe(true);
    expect(isReadOnlyMode("review")).toBe(true);
    expect(isReadOnlyMode("plan")).toBe(true);
    expect(isReadOnlyMode("agent")).toBe(false);
    expect(isReadOnlyMode("debug")).toBe(false);
  });

  it("routeText có nhãn mode", () => {
    expect(routeText("ask", "chat", "claude-haiku")).toBe("Ask · chat → claude-haiku");
  });
});
