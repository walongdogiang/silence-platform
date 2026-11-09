#!/usr/bin/env node
// Kiểm tra rule đôi .claude/rules/X.md ↔ .cursor/rules/X.mdc không lệch nhau.
// So: (1) thân rule sau frontmatter, (2) tập path: `paths:` (Claude) ↔ `globs:` (Cursor), đã bung `{a,b}`.
// Chạy: node scripts/check-rules-sync.mjs   (exit 1 nếu lệch)
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const claudeDir = path.join(root, ".claude", "rules");
const cursorDir = path.join(root, ".cursor", "rules");

// Rule chỉ có ở Cursor, có chủ đích (GSD chỉ chạy trong Cursor).
const CURSOR_ONLY = new Set(["gsd-commit"]);

/** Tách frontmatter `---` đầu file; trả về { front, body } đã chuẩn hoá xuống dòng. */
export function splitFrontmatter(text) {
  const t = text.replace(/\r\n/g, "\n");
  const m = t.match(/^---\n([\s\S]*?)\n---\n?/);
  return m ? { front: m[1], body: t.slice(m[0].length) } : { front: "", body: t };
}

/** Bỏ khoảng trắng cuối dòng và dòng trống đầu/cuối. */
export function normalizeBody(body) {
  return body
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();
}

/** Bung brace `{a,b}` (hỗ trợ lồng nhau) thành danh sách glob. */
export function expandBraces(glob) {
  let depth = 0;
  let start = -1;
  for (let i = 0; i < glob.length; i++) {
    if (glob[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (glob[i] === "}" && depth > 0) {
      depth--;
      if (depth === 0) {
        const inner = glob.slice(start + 1, i);
        const parts = splitTopLevel(inner, ",");
        const pre = glob.slice(0, start);
        const post = glob.slice(i + 1);
        return parts.flatMap((p) => expandBraces(pre + p + post));
      }
    }
  }
  return [glob];
}

function splitTopLevel(s, sep) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const unquote = (s) => s.trim().replace(/^["']|["']$/g, "");

/** Danh sách `paths:` trong frontmatter Claude (YAML list). */
export function claudePaths(front) {
  const lines = front.split("\n");
  const i = lines.findIndex((l) => /^paths:\s*$/.test(l));
  if (i < 0) return [];
  const out = [];
  for (const l of lines.slice(i + 1)) {
    const m = l.match(/^\s+-\s+(.+)$/);
    if (!m) break;
    out.push(unquote(m[1]));
  }
  return out;
}

/** `globs:` trong frontmatter Cursor (chuỗi phân tách dấu phẩy ở mức ngoài brace). */
export function cursorGlobs(front) {
  const m = front.match(/^globs:\s*(.*)$/m);
  if (!m || !m[1].trim()) return [];
  return splitTopLevel(unquote(m[1]), ",").map((g) => g.trim()).filter(Boolean);
}

const pathSet = (globs) => new Set(globs.flatMap(expandBraces));

function diffSets(a, b) {
  return { onlyA: [...a].filter((x) => !b.has(x)), onlyB: [...b].filter((x) => !a.has(x)) };
}

/** Dòng đầu tiên khác nhau giữa hai thân rule (để báo lỗi gọn). */
function firstDiff(a, b) {
  const la = a.split("\n");
  const lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return { line: i + 1, claude: la[i] ?? "<hết file>", cursor: lb[i] ?? "<hết file>" };
  }
  return null;
}

export function check() {
  const errors = [];
  const names = (dir, ext) =>
    existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)) : [];
  const claude = new Set(names(claudeDir, ".md"));
  const cursor = new Set(names(cursorDir, ".mdc"));

  for (const n of cursor) {
    if (!claude.has(n) && !CURSOR_ONLY.has(n)) errors.push(`${n}: có .cursor/rules/${n}.mdc nhưng thiếu .claude/rules/${n}.md`);
  }
  for (const n of [...claude].sort()) {
    if (!cursor.has(n)) {
      errors.push(`${n}: có .claude/rules/${n}.md nhưng thiếu .cursor/rules/${n}.mdc`);
      continue;
    }
    const a = splitFrontmatter(readFileSync(path.join(claudeDir, `${n}.md`), "utf8"));
    const b = splitFrontmatter(readFileSync(path.join(cursorDir, `${n}.mdc`), "utf8"));

    const d = firstDiff(normalizeBody(a.body), normalizeBody(b.body));
    if (d) errors.push(`${n}: thân rule lệch ở dòng ${d.line}\n    claude: ${d.claude}\n    cursor: ${d.cursor}`);

    const pa = pathSet(claudePaths(a.front));
    const pb = pathSet(cursorGlobs(b.front));
    const { onlyA, onlyB } = diffSets(pa, pb);
    if (onlyA.length || onlyB.length) {
      errors.push(
        `${n}: path lệch` +
          (onlyA.length ? `\n    chỉ ở claude paths: ${onlyA.join(", ")}` : "") +
          (onlyB.length ? `\n    chỉ ở cursor globs: ${onlyB.join(", ")}` : ""),
      );
    }
  }
  return { errors, count: claude.size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors, count } = check();
  if (errors.length) {
    console.error(`Rule lệch (${errors.length}) — sửa cả hai bản:\n- ` + errors.join("\n- "));
    process.exit(1);
  }
  console.log(`OK: ${count} cặp rule .claude ↔ .cursor khớp nhau.`);
}
