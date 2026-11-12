/**
 * Nhận `src/calc.py`, `calc.py:4`, `src/a/b.rs:10-20`. Từ chối đường dẫn tuyệt đối, có ổ đĩa
 * hoặc `..` (giống `rel_path` ở Engine) để chip chỉ mở file trong workspace.
 */
export function parsePathRef(text: string): { path: string; line?: number } | null {
  const m = /^([\w.\-]+(?:\/[\w.\-]+)*\.[A-Za-z0-9]{1,8})(?::(\d+)(?:-\d+)?)?$/.exec(text.trim());
  if (!m) return null;
  if (m[1].split("/").some((s) => s === "..")) return null;
  return { path: m[1], line: m[2] ? Number(m[2]) : undefined };
}
