// Tách frontmatter `---` đầu file Markdown. Dùng chung cho check-docs-meta và check-rules.

/** Trả về { front, body } đã chuẩn hoá xuống dòng; không có frontmatter thì front = "". */
export function splitFrontmatter(text) {
  const t = text.replace(/\r\n/g, "\n");
  const m = t.match(/^---\n([\s\S]*?)\n---\n?/);
  return m ? { front: m[1], body: t.slice(m[0].length) } : { front: "", body: t };
}
