import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangContext } from "../i18n";
import { MarkdownMessage, parsePathRef } from "./MarkdownMessage";

// These tests assert Vietnamese UI strings, so they render in "vi" explicitly (the default is English).
const inVi = (node: ReactNode) =>
  renderToStaticMarkup(<LangContext.Provider value="vi">{node}</LangContext.Provider>);
const html =(text: string, onOpenFile?: (p: string) => void) =>
  renderToStaticMarkup(
    <LangContext.Provider value="vi">
      <MarkdownMessage text={text} onOpenFile={onOpenFile} />
    </LangContext.Provider>,
  );

describe("MarkdownMessage render", () => {
  it("render GFM: đậm, code, danh sách, bảng", () => {
    const out = html("**đậm** và `code`\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |");
    expect(out).toContain("<strong>đậm</strong>");
    expect(out).toContain('<code class="md-inline">code</code>');
    expect(out).toContain("<li>a</li>");
    expect(out).toContain("<table>");
    expect(out).not.toContain("**");
  });

  it("code fence chưa đóng (đang stream) vẫn ra khối code, không vỡ", () => {
    const out = html("Đây là diff:\n\n```diff\n- so_a = 35\n+ so_a = 25");
    expect(out).toContain('class="code-card diff-block"');
    expect(out).toContain('so_a = <mark class="chg">25</mark>');
    expect(out).not.toContain("```");
  });

  it("khối diff: header đường dẫn, +/−, số dòng; không hiện ---/+++/@@", () => {
    const out = html(
      "```diff\n--- a/calculator.py\n+++ b/calculator.py\n@@ -5 +5 @@\n-b = 10\n+b = 120\n```",
      () => {},
    );
    expect(out).toContain('class="code-path-btn"');
    expect(out).toContain('<span class="name">calculator.py</span>');
    expect(out).toContain("+1");
    expect(out).toContain('<td class="ln">5</td>');
    expect(out).toContain('<mark class="chg">120</mark>');
    expect(out).not.toContain("@@");
    expect(out).not.toContain("+++");
  });

  it("code block thường: card có tên ngôn ngữ, nút Copy, không lồng <pre>", () => {
    const out = html("```python\nprint(1)\n```");
    expect(out).toContain('<span class="code-lang">python</span>');
    expect(out).toContain('aria-label="Chép code"');
    expect(out).toContain("print(1)");
    expect(out.match(/<pre/g)?.length).toBe(1);
  });

  it("HTML thô không được render thành phần tử", () => {
    const out = html('<script>alert(1)</script> <img src=x onerror=alert(1)> <b>x</b>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<b>");
  });

  it("link javascript:/data:/file: không thành thẻ <a>", () => {
    for (const href of ["javascript:alert(1)", "data:text/html,x", "file:///C:/secret.txt", "vbscript:x"]) {
      const out = html(`[bấm](${href})`);
      expect(out, href).not.toContain("<a ");
      expect(out, href).not.toContain(href);
      expect(out, href).toContain("bấm");
    }
  });

  it("link https thành <a> có rel an toàn", () => {
    const out = html("[repo](https://github.com/walongdogiang/silence-platform)");
    expect(out).toContain('<a href="https://github.com/walongdogiang/silence-platform"');
    expect(out).toContain('rel="noreferrer noopener"');
  });

  it("ảnh từ xa bị chặn (không tạo <img> để không rò rỉ dữ liệu)", () => {
    const out = html("![logo](https://evil.example/p.png?d=SECRET)");
    expect(out).not.toContain("<img");
    expect(out).not.toContain("evil.example");
    expect(out).toContain("[ảnh: logo]");
  });

  it("ảnh trỏ vào workspace hiện qua Engine; ảnh từ xa vẫn chặn khi có workspace", () => {
    const ws = (text: string) =>
      inVi(<MarkdownMessage text={text} workspace="D:/ws" onOpenImage={() => {}} />);
    // SSR không chạy effect: thấy placeholder đang tải, chưa có <img>, không lộ URL lạ.
    expect(ws("![mèo](out/cat.png)")).toContain("đang tải ảnh out/cat.png");
    expect(ws("![x](../secret.png)")).toContain("[ảnh: x]");
    const remote = ws("![logo](https://evil.example/p.png)");
    expect(remote).not.toContain("<img");
    expect(remote).toContain("[ảnh: logo]");
  });

  it("khối ```svg đủ thành hình (img data URL), đang stream thì còn là mã", () => {
    const done = html(
      '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>\n```',
    );
    expect(done).toContain('class="visual-card"');
    expect(done).toContain('src="data:image/svg+xml;charset=utf-8,%3Csvg');
    // SVG của model chỉ nằm trong data URL của <img>, không chèn thẳng vào DOM.
    expect(done).not.toContain('<rect width="5"');
    // Đã xong mà SVG cụt: hiện mã.
    const cut = html('```svg\n<svg viewBox="0 0 10 10"><rect');
    expect(cut).not.toContain("visual-card");
    expect(cut).toContain("code-card");
  });

  it("khối ```svg đang stream hiện ô chờ Đang vẽ, không đổ mã", () => {
    const live = inVi(<MarkdownMessage text={'```svg\n<svg viewBox="0 0 10 10"><rect'} streaming />);
    expect(live).toContain("visual-pending");
    expect(live).toContain("Đang vẽ…");
    expect(live).not.toContain("&lt;rect");
  });

  it("ô chờ đúng tỉ lệ viewBox; tranh nền kín tràn mép, sơ đồ giữ lề; nút Chỉnh khi có onEditVisual", () => {
    const live = renderToStaticMarkup(
      <MarkdownMessage text={'```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect'} streaming />,
    );
    expect(live).toContain("aspect-ratio:800 / 600");
    expect(live).toContain("width:min(100%, 533px)");

    const scene =
      '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><title>Mèo</title><defs><linearGradient id="g"/></defs><rect width="800" height="600" rx="12" fill="url(#g)"/><circle r="5"/></svg>\n```';
    const diagram =
      '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect x="20" y="20" width="120" height="40" rx="8" fill="#456"/></svg>\n```';
    expect(html(scene)).toContain('class="visual-card bleed"');
    expect(html(diagram)).not.toContain("bleed");

    // Hover: Tải + Copy luôn có; Chỉnh sửa chỉ khi có onEditImage. Header không còn nút "Chỉnh".
    const edit = inVi(<MarkdownMessage text={scene} onEditImage={() => {}} />);
    expect(edit).toContain('aria-label="Tải ảnh"');
    expect(edit).toContain('aria-label="Copy dạng ảnh"');
    // Nút Copy chỉ icon: hai icon (Copy, ✓) xếp chồng để chuyển mượt khi copy xong.
    expect(edit).toContain("img-frame-swap");
    expect(edit).not.toContain("Đã copy</span>");
    expect(edit).toContain('aria-label="Chỉnh sửa hình ảnh"');
    expect(edit.split('class="code-card-head"')[1].split("visual-body")[0]).not.toContain("Chỉnh");
    const plain = html(scene);
    expect(plain).toContain('aria-label="Tải ảnh"');
    expect(plain).not.toContain("Chỉnh sửa");
  });

  it("follows the UI language from LangContext", () => {
    const en = renderToStaticMarkup(
      <LangContext.Provider value="en">
        <MarkdownMessage text={"```py\nx = 1\n```\n\n![logo](https://x.test/a.png)"} onEditImage={() => {}} />
      </LangContext.Provider>,
    );
    expect(en).toContain('aria-label="Copy code"');
    expect(en).toContain("[image: logo]");
    expect(en).not.toContain("Chép");
  });

  it("<title> của SVG làm alt và tiêu đề card", () => {
    const done = html(
      '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>Mèo &amp; công viên</title><rect/></svg>\n```',
    );
    expect(done).toContain('alt="Mèo &amp; công viên"');
    const plain = html('```svg\n<svg viewBox="0 0 10 10"><rect/></svg>\n```');
    expect(plain).toContain('alt="Hình minh hoạ"');
  });

  it("link tương đối tới file workspace thành chip mở file", () => {
    expect(html("[cat_in_park.png](cat_in_park.png)", () => {})).toContain("md-link-file");
    expect(html("[x](../etc/passwd.txt)", () => {})).not.toContain("md-link-file");
    expect(html("[cat_in_park.png](cat_in_park.png)")).not.toContain("md-link-file");
  });

  it("inline `path:line` thành chip chỉ khi có onOpenFile", () => {
    expect(html("xem `calculator.py:4`", () => {})).toContain('class="md-path"');
    expect(html("xem `calculator.py:4`")).toContain('<code class="md-inline">calculator.py:4</code>');
    expect(html("chạy `npm run studio`", () => {})).not.toContain("md-path");
  });
});

describe("parsePathRef", () => {
  it("nhận path, path:line, path:a-b", () => {
    expect(parsePathRef("calculator.py")).toEqual({ path: "calculator.py", line: undefined });
    expect(parsePathRef("calculator.py:4")).toEqual({ path: "calculator.py", line: 4 });
    expect(parsePathRef("src/a/b.rs:10-20")).toEqual({ path: "src/a/b.rs", line: 10 });
  });

  it("từ chối tuyệt đối, ổ đĩa, .., URL và lệnh", () => {
    for (const s of ["/etc/passwd", "C:/Windows/x.dll", "../secret.txt", "src/../x.py", "https://a.b/c.d", "npm run studio", "foo", ""]) {
      expect(parsePathRef(s), s).toBeNull();
    }
  });
});
