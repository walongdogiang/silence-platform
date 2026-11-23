#!/usr/bin/env node
// Tóm tắt 2–3 dòng việc ở Now / Next trong todo/README.md cho hook SessionStart của Claude Code.
// Stdout được nạp vào ngữ cảnh đầu phiên. Không có todo/ hay lỗi đọc thì im lặng, exit 0.
// Chạy: node scripts/todo-brief.mjs
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const todoDir = path.join(root, "todo");

/** Tách README thành các nhóm `## Tên` → danh sách dòng việc `- T-xxx …`. */
export function sections(md) {
  const out = {};
  let cur = null;
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^##\s+(\S+)/);
    if (h) {
      cur = h[1];
      out[cur] = [];
    } else if (cur && /^-\s+T-\d+/.test(line)) out[cur].push(line.replace(/^-\s+/, ""));
  }
  return out;
}

/** Mã việc, tên ngắn (bỏ link/ghi chú sau " · "), link file chi tiết, các mã chặn. */
export function parseItem(line) {
  const id = line.match(/^(T-\d+)/)[1];
  const parts = line.split(" · ");
  const link = line.match(/\]\((tasks\/[^)]+)\)/)?.[1] ?? null;
  const blockedBy = [...(line.match(/blocked-by:\s*([T\-\d,\s]+)/)?.[1] ?? "").matchAll(/T-\d+/g)].map((m) => m[0]);
  return { id, title: parts[0], link, blockedBy };
}

/** Đếm tiêu chí đã tick trong mục "## Tiêu chí xong" của file task. */
export function criteria(taskMd) {
  const m = taskMd.match(/##\s+Tiêu chí xong\s*\n([\s\S]*?)(\n##\s|$)/);
  if (!m) return null;
  const done = (m[1].match(/^\s*-\s+\[x\]/gim) ?? []).length;
  const total = (m[1].match(/^\s*-\s+\[[ x]\]/gim) ?? []).length;
  return total ? { done, total } : null;
}

export function brief(md, readTask = () => null) {
  const s = sections(md);
  const open = new Set(Object.values(s).flat().map((l) => parseItem(l).id));
  const withProgress = (it) => {
    const c = it.link ? criteria(readTask(it.link) ?? "") : null;
    return c ? `${it.title} (tiêu chí ${c.done}/${c.total})` : it.title;
  };
  const lines = [];
  const now = (s.Now ?? []).map(parseItem);
  const next = (s.Next ?? []).map(parseItem);
  if (now.length) lines.push(`[todo] Đang làm (Now): ${now.map(withProgress).join("; ")}`);
  const ready = next.find((it) => !it.blockedBy.some((b) => open.has(b)));
  if (ready) lines.push(`[todo] ${now.length ? "Sau đó" : "Now trống. Việc tiếp theo"}: ${withProgress(ready)}`);
  if (!lines.length) lines.push("[todo] Now và Next đều trống.");
  lines.push("[todo] Danh sách: todo/README.md · skill todo (/todo). Khi user hỏi làm gì tiếp / làm tiếp / việc tiếp theo thì dùng skill todo.");
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const readme = path.join(todoDir, "README.md");
    if (existsSync(readme)) {
      const readTask = (rel) => {
        const p = path.join(todoDir, rel);
        return existsSync(p) ? readFileSync(p, "utf8") : null;
      };
      console.log(brief(readFileSync(readme, "utf8"), readTask));
    }
  } catch {
    // Hook đầu phiên không được làm hỏng phiên.
  }
}
