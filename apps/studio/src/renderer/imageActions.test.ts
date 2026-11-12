import { describe, expect, it } from "vitest";
import { svgDataUrl } from "./components/DiffCard";
import { fileNameFor, slugFileName, svgFileNameHint } from "./imageActions";

describe("slugFileName", () => {
  it("chữ thường, gạch ngang, bỏ dấu tiếng Việt và ký tự đặc biệt, bỏ đuôi sẵn có", () => {
    expect(slugFileName("Mèo dạo công viên")).toBe("meo-dao-cong-vien");
    expect(slugFileName("Đường đi & Sơ đồ (v2)!")).toBe("duong-di-so-do-v2");
    expect(slugFileName("Orange_Cat Walking.PNG")).toBe("orange-cat-walking");
    expect(slugFileName("  --- ")).toBe("");
  });

  it("tên quá dài cắt ở ranh giới từ, ≤ 60 ký tự", () => {
    const out = slugFileName("a very long descriptive name for a picture of an orange cat walking in a sunny park");
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith("-")).toBe(false);
    expect(out.startsWith("a-very-long-descriptive-name")).toBe(true);
  });
});

describe("fileNameFor", () => {
  const svg = (attrs: string, title = "") =>
    svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" ${attrs} viewBox="0 0 10 10">${title}<rect/></svg>`);

  it("dùng tên model đặt (data-filename), đuôi theo định dạng thật / định dạng xuất", () => {
    const src = svg('data-filename="Orange-Cat-Walking-In-Park.svg"', "<title>Mèo</title>");
    expect(svgFileNameHint('<svg xmlns="x" data-filename="Orange-Cat"><title>a</title></svg>')).toBe("Orange-Cat");
    expect(fileNameFor(src)).toBe("orange-cat-walking-in-park.svg");
    expect(fileNameFor(src, { ext: "png", name: "Mèo" })).toBe("orange-cat-walking-in-park.png");
  });

  it("không có data-filename → tiêu đề đã chuẩn hoá → image-<n>", () => {
    expect(fileNameFor(svg(""), { name: "Mèo dạo công viên", ext: "png" })).toBe("meo-dao-cong-vien.png");
    expect(fileNameFor("data:image/jpeg;base64,AA", { n: 2 })).toBe("image-2.jpg");
    expect(fileNameFor("data:image/webp;base64,AA")).toBe("image-1.webp");
  });

  it("ảnh workspace giữ tên file thật", () => {
    expect(fileNameFor("data:image/png;base64,AA", { path: "out/Cat Photo.png", name: "x" })).toBe("Cat Photo.png");
    expect(fileNameFor(svg('data-filename="x"'), { path: "assets/logo.svg", ext: "png" })).toBe("logo.png");
  });
});

describe("fileNameFor: đường dẫn Windows", () => {
  it("lấy tên file sau dấu \\", () => {
    expect(fileNameFor("data:image/png;base64,AA", { path: "out\\cat.png" })).toBe("cat.png");
  });
});
