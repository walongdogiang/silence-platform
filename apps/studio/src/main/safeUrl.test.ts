import { describe, expect, it } from "vitest";
import { isAppNavigation, isSafeExternalUrl } from "./safeUrl";

describe("isSafeExternalUrl", () => {
  it("cho http(s)", () => {
    expect(isSafeExternalUrl("https://github.com/walongdogiang/silence-platform")).toBe(true);
    expect(isSafeExternalUrl("http://example.com/a?b=1#c")).toBe(true);
  });

  it("chặn scheme nguy hiểm", () => {
    for (const u of [
      "javascript:alert(1)",
      "file:///C:/Windows/System32/calc.exe",
      "data:text/html,<script>1</script>",
      "vbscript:msgbox(1)",
      "ms-msdt:/id",
      "steam://run/1",
    ]) {
      expect(isSafeExternalUrl(u), u).toBe(false);
    }
  });

  it("chặn URL kèm user:pass và chuỗi không hợp lệ", () => {
    expect(isSafeExternalUrl("https://user:pass@evil.example/")).toBe(false);
    expect(isSafeExternalUrl("not a url")).toBe(false);
    expect(isSafeExternalUrl("")).toBe(false);
  });
});

describe("isAppNavigation", () => {
  it("dev server cùng origin thì cho qua", () => {
    expect(isAppNavigation("http://localhost:5173/", "http://localhost:5173/", "http://localhost:5173")).toBe(true);
    expect(isAppNavigation("http://localhost:5173/x", "http://localhost:5173/", "http://localhost:5173")).toBe(true);
  });

  it("origin khác bị chặn", () => {
    expect(isAppNavigation("https://evil.example/", "http://localhost:5173/", "http://localhost:5173")).toBe(false);
    expect(isAppNavigation("http://localhost:9999/", "http://localhost:5173/", "http://localhost:5173")).toBe(false);
  });

  it("bản đóng gói (file://): chỉ reload đúng trang", () => {
    const cur = "file:///C:/app/out/renderer/index.html";
    expect(isAppNavigation(cur, cur)).toBe(true);
    expect(isAppNavigation(`${cur}#x`, cur)).toBe(true);
    expect(isAppNavigation("file:///C:/secret.txt", cur)).toBe(false);
    expect(isAppNavigation("https://evil.example/", cur)).toBe(false);
  });
});
