import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangContext } from "../i18n";
import { ChapterNav, chapterTitle, chaptersFrom } from "./ChapterNav";

describe("ChapterNav", () => {
  it("chapterTitle: dòng đầu có chữ, gọn, ≤ 60 ký tự", () => {
    expect(chapterTitle("\n  Icon   Fork menu chuột phải \nthêm nữa")).toBe("Icon Fork menu chuột phải");
    const t = chapterTitle("a".repeat(100));
    expect(t.length).toBe(60);
    expect(t.endsWith("…")).toBe(true);
    expect(chapterTitle("")).toBe("");
  });

  it("chaptersFrom: chưa ghim → rỗng; có ghim → thêm Bắt đầu phiên nếu lượt 0 chưa ghim", () => {
    expect(chaptersFrom([{}, {}], "Start")).toEqual([]);
    expect(chaptersFrom([{}, { chapter: "B" }], "Start")).toEqual([
      { turn: 0, title: "Start" },
      { turn: 1, title: "B" },
    ]);
    expect(chaptersFrom([{ chapter: "A" }, {}], "Start")).toEqual([{ turn: 0, title: "A" }]);
  });

  it("vẽ gạch + danh sách tên; không có chương thì không vẽ gì", () => {
    const ref = { current: null };
    const html = renderToStaticMarkup(
      <LangContext.Provider value="vi">
        <ChapterNav chapters={[{ turn: 0, title: "Bắt đầu phiên" }, { turn: 3, title: "Icon Fork" }]} viewport={ref} />
      </LangContext.Provider>,
    );
    expect(html).toContain('aria-label="Mục lục chương"');
    expect(html).toContain("Icon Fork");
    expect(html.match(/<span class="on"><\/span>|<span><\/span>/g)?.length).toBe(2);
    expect(renderToStaticMarkup(<ChapterNav chapters={[]} viewport={ref} />)).toBe("");
  });
});
