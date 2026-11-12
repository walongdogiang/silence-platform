import { describe, expect, it } from "vitest";
import { isSvgPath, svgDataUrl } from "./components/DiffCard";
import { imageRefsIn, isImagePath, workspaceImageSrc } from "./workspaceImages";

describe("workspaceImageSrc", () => {
  it("chỉ nhận đường dẫn ảnh tương đối trong workspace", () => {
    expect(workspaceImageSrc("out/cat.png")).toBe("out/cat.png");
    expect(workspaceImageSrc("./cat.JPG")).toBe("cat.JPG");
    expect(workspaceImageSrc("https://x.y/a.png")).toBeNull();
    expect(workspaceImageSrc("../a.png")).toBeNull();
    expect(workspaceImageSrc("C:/a.png")).toBeNull();
    expect(workspaceImageSrc("notes.txt")).toBeNull();
    expect(workspaceImageSrc(undefined)).toBeNull();
  });
});

describe("imageRefsIn", () => {
  it("lấy ảnh được nhắc (chip, link, chữ), bỏ trùng và ảnh đã nhúng", () => {
    const text = [
      "Đã xuất `cat_in_park.png` và [cat_in_park.jpg](cat_in_park.jpg).",
      "Xem lại cat_in_park.png, hoặc out/a.webp.",
      "![nhúng](out/b.gif) — https://evil.example/x.png — ../up.png — file.txt",
    ].join("\n");
    expect(imageRefsIn(text)).toEqual(["cat_in_park.png", "cat_in_park.jpg", "out/a.webp"]);
  });

  it("giới hạn số ảnh", () => {
    expect(imageRefsIn("a.png b.png c.png d.png e.png", 2)).toEqual(["a.png", "b.png"]);
  });

  it("isImagePath theo đuôi", () => {
    expect(isImagePath("x/y.SVG")).toBe(true);
    expect(isImagePath("x/y.bmp")).toBe(false);
  });
});

describe("SVG trong thẻ diff", () => {
  it("nhận .svg và mã hoá thành data URL", () => {
    expect(isSvgPath("art/cat.svg")).toBe(true);
    expect(isSvgPath("cat.png")).toBe(false);
    const url = svgDataUrl('<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>');
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,%3Csvg")).toBe(true);
    expect(url).not.toContain("<");
  });
});

describe("khối ```svg", () => {
  it("chỉ vẽ khi SVG đã đủ (không vẽ nửa chừng lúc stream)", async () => {
    const { isCompleteSvg } = await import("./components/VisualBlock");
    expect(isCompleteSvg('<svg viewBox="0 0 10 10"><rect/></svg>\n')).toBe(true);
    expect(isCompleteSvg('<?xml version="1.0"?>\n<svg><g/></svg>')).toBe(true);
    expect(isCompleteSvg('<svg viewBox="0 0 10 10"><rect')).toBe(false);
    expect(isCompleteSvg("<div></div>")).toBe(false);
  });

  it("đọc viewBox (cả khi đang stream) và SVG trong data URL", async () => {
    const { svgViewBox, svgFromDataUrl } = await import("./pastedImages");
    expect(svgViewBox('<svg xmlns="x" viewBox="0 0 800 600"><rect')).toEqual({ w: 800, h: 600 });
    expect(svgViewBox("<svg viewBox='0,0,640,480'>")).toEqual({ w: 640, h: 480 });
    expect(svgViewBox('<svg viewBox="0 0 800')).toBeNull();
    expect(svgViewBox('<svg viewBox="0 0 0 10">')).toBeNull();
    const svg = '<svg viewBox="0 0 10 10"><title>Mèo</title></svg>';
    expect(svgFromDataUrl(svgDataUrl(svg))).toBe(svg);
    expect(svgFromDataUrl("data:image/png;base64,AAAA")).toBeNull();
  });
});
