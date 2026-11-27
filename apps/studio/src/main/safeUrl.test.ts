import { describe, expect, it } from "vitest";
import { isAppNavigation, isLoopbackUrl, isSafeExternalUrl, normalizePreviewInput, previewNavDecision } from "./safeUrl";

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

describe("isLoopbackUrl", () => {
  it("cho localhost, 127.0.0.1, [::1] qua http(s), mọi cổng", () => {
    for (const u of [
      "http://localhost:5173/",
      "https://localhost/",
      "http://LOCALHOST:3000/a?b=1",
      "http://127.0.0.1:8080/x",
      "http://[::1]:4000/",
    ]) {
      expect(isLoopbackUrl(u), u).toBe(true);
    }
  });

  it("chặn host giả, host khác, scheme khác, user:pass", () => {
    for (const u of [
      "http://localhost.evil.com/",
      "http://127.0.0.1.nip.io/",
      "http://evil.com/?localhost",
      "http://evil.com#127.0.0.1",
      "http://0.0.0.0:3000/",
      "http://192.168.1.10:3000/",
      "http://user:pass@localhost:3000/",
      "file:///C:/Windows/win.ini",
      "javascript:alert(1)",
      "ws://localhost:3000/",
      "not a url",
    ]) {
      expect(isLoopbackUrl(u), u).toBe(false);
    }
  });
});

describe("previewNavDecision", () => {
  it("loopback ở lại, http(s) khác ra ngoài, còn lại bỏ", () => {
    expect(previewNavDecision("http://localhost:5173/login")).toBe("allow");
    expect(previewNavDecision("https://github.com/")).toBe("external");
    expect(previewNavDecision("http://localhost.evil.com/")).toBe("external");
    expect(previewNavDecision("file:///C:/x")).toBe("deny");
    expect(previewNavDecision("javascript:alert(1)")).toBe("deny");
    expect(previewNavDecision("https://u:p@evil.example/")).toBe("deny");
  });
});

describe("normalizePreviewInput", () => {
  it("thêm http:// khi thiếu scheme", () => {
    expect(normalizePreviewInput("localhost:5173")).toBe("http://localhost:5173/");
    expect(normalizePreviewInput("  127.0.0.1:3000/a ")).toBe("http://127.0.0.1:3000/a");
    expect(normalizePreviewInput("https://localhost/")).toBe("https://localhost/");
  });

  it("chuỗi rỗng hoặc hỏng thì null", () => {
    expect(normalizePreviewInput("")).toBeNull();
    expect(normalizePreviewInput("   ")).toBeNull();
    expect(normalizePreviewInput("http://")).toBeNull();
  });
});
