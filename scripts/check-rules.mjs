#!/usr/bin/env node
// Kiểm tra rule theo đường dẫn trong .claude/rules/*.md:
// (1) có frontmatter với danh sách `paths:` không rỗng, (2) thân rule không rỗng,
// (3) phần cố định (trước ký tự glob đầu tiên) của mỗi path tồn tại trong repo — bắt path chết sau khi đổi tên/xoá thư mục.
// Chạy: node scripts/check-rules.mjs   (exit 1 nếu có lỗi)
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitFrontmatter } from "./frontmatter.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rulesDir = path.join(root, ".claude", "rules");

/** Đọc danh sách `paths:` dạng YAML list trong frontmatter. */
export function rulePaths(front) {
  const out = [];
  let inPaths = false;
  for (const line of front.split("\n")) {
    if (/^paths:\s*$/.test(line)) {
      inPaths = true;
      continue;
    }
    if (inPaths) {
      const m = line.match(/^\s+-\s*["']?([^"']+?)["']?\s*$/);
      if (m) out.push(m[1]);
      else if (/^\S/.test(line)) inPaths = false;
    }
  }
  return out;
}

/** Thư mục/file cố định trước ký tự glob đầu tiên (`*`, `{`, `?`, `[`); "" nếu glob bắt đầu ngay ở gốc. */
export function fixedPrefix(glob) {
  const i = glob.search(/[*{?[]/);
  if (i === -1) return glob.replace(/\/$/, "");
  const head = glob.slice(0, i);
  const slash = head.lastIndexOf("/");
  return slash === -1 ? "" : head.slice(0, slash);
}

export function check() {
  const errors = [];
  const files = existsSync(rulesDir) ? readdirSync(rulesDir).filter((f) => f.endsWith(".md")) : [];
  for (const f of files.sort()) {
    const { front, body } = splitFrontmatter(readFileSync(path.join(rulesDir, f), "utf8"));
    const paths = rulePaths(front);
    if (!front) errors.push(`${f}: thiếu frontmatter`);
    else if (!paths.length) errors.push(`${f}: frontmatter thiếu danh sách \`paths:\``);
    if (!body.trim()) errors.push(`${f}: thân rule rỗng`);
    for (const p of paths) {
      const prefix = fixedPrefix(p);
      if (prefix && !existsSync(path.join(root, prefix))) errors.push(`${f}: path \`${p}\` trỏ tới \`${prefix}\` không tồn tại`);
    }
  }
  return { errors, count: files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors, count } = check();
  if (errors.length) {
    console.error(`Rule lỗi (${errors.length}):\n- ` + errors.join("\n- "));
    process.exit(1);
  }
  console.log(`OK: ${count} rule trong .claude/rules hợp lệ.`);
}
