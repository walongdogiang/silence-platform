import { describe, expect, it } from "vitest";
import { asPreviewState, normalizeInput, overlaps, readUrls, rememberUrl } from "./previewState";
import { clampPaneWidth, loadPaneWidth, PANE_DEFAULT, PANE_MIN } from "./paneLayout";

describe("normalizeInput", () => {
  it("thêm http:// khi thiếu scheme", () => {
    expect(normalizeInput("localhost:5173")).toBe("http://localhost:5173/");
    expect(normalizeInput(" https://127.0.0.1:3000/a ")).toBe("https://127.0.0.1:3000/a");
    expect(normalizeInput("")).toBeNull();
    expect(normalizeInput("http://")).toBeNull();
  });
});

describe("URL theo workspace", () => {
  it("chỉ giữ URL loopback, bỏ JSON hỏng", () => {
    expect(readUrls("not json")).toEqual({});
    expect(readUrls('{"a":"http://localhost:1/","b":"https://evil.com/","c":3}')).toEqual({ a: "http://localhost:1/" });
  });

  it("ghi đè URL của workspace, giữ tối đa 30", () => {
    let all: Record<string, string> = {};
    for (let i = 0; i < 35; i++) all = rememberUrl(all, `w${i}`, `http://localhost:${3000 + i}/`);
    expect(Object.keys(all)).toHaveLength(30);
    expect(all.w0).toBeUndefined();
    all = rememberUrl(all, "w34", "http://localhost:9/");
    expect(all.w34).toBe("http://localhost:9/");
    expect(rememberUrl(all, "w34", "https://evil.com/")).toBe(all);
  });
});

describe("asPreviewState", () => {
  it("dữ liệu lạ thành trạng thái trống", () => {
    expect(asPreviewState(null).url).toBe("");
    expect(asPreviewState({ url: "http://localhost/", loading: true, canGoBack: "yes" })).toMatchObject({
      url: "http://localhost/",
      loading: true,
      canGoBack: false,
    });
  });
});

describe("overlaps", () => {
  const page = { left: 1000, top: 60, right: 1500, bottom: 900 };
  it("lớp phủ chạm vùng trang thì true", () => {
    expect(overlaps({ left: 300, top: 100, right: 1200, bottom: 700 }, page)).toBe(true);
    expect(overlaps({ left: 100, top: 100, right: 900, bottom: 700 }, page)).toBe(false);
    expect(overlaps({ left: 1000, top: 0, right: 1100, bottom: 60 }, page)).toBe(false);
  });
});

describe("bề rộng cột pane", () => {
  it("kẹp trong [min, 70% cửa sổ]", () => {
    expect(clampPaneWidth(100, 1500)).toBe(PANE_MIN);
    expect(clampPaneWidth(5000, 1500)).toBe(1050);
    expect(clampPaneWidth(600.4, 1500)).toBe(600);
    expect(loadPaneWidth(null, 1500)).toBe(PANE_DEFAULT);
    expect(loadPaneWidth("abc", 1500)).toBe(PANE_DEFAULT);
    expect(loadPaneWidth("800", 1500)).toBe(800);
  });
});
