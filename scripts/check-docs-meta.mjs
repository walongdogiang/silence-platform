#!/usr/bin/env node
// Kiểm tra frontmatter của docs/**/*.md (trừ docs/archive/) và việc file có mặt trong mục lục.
// Schema: description (bắt buộc), type (bắt buộc), status (tuỳ chọn), code (tuỳ chọn, path phải tồn tại).
// Chạy: node scripts/check-docs-meta.mjs   (exit 1 nếu có lỗi)
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { splitFrontmatter } from "./frontmatter.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = path.join(root, "docs");

export const TYPES = ["index", "prd", "adr", "spec", "roadmap", "reference"];
export const STATUSES = ["draft", "superseded"];
const KEYS = new Set(["description", "type", "status", "code"]);
const MAX_DESCRIPTION = 200;
// Mục lục: mỗi file docs phải được link từ một trong các file này.
const INDEXES = ["docs/README.md", "docs/frontend/README.md"];
const SKIP_DIRS = new Set(["archive"]);

const toPosix = (p) => p.split(path.sep).join("/");

/** Mọi file .md dưới docs/, đường dẫn tương đối gốc repo, dạng posix. */
export function listDocs(dir = docsDir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) out.push(...listDocs(path.join(dir, e.name)));
    } else if (e.name.endsWith(".md")) {
      out.push(toPosix(path.relative(root, path.join(dir, e.name))));
    }
  }
  return out.sort();
}

/**
 * Parse frontmatter tối giản: `key: value` và `key:` + các dòng `  - item`.
 * Trả về { data, errors } — lỗi cú pháp mà parser YAML thật cũng sẽ từ chối.
 */
export function parseFrontmatter(front) {
  const data = {};
  const errors = [];
  let listKey = null;
  for (const raw of front.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item) {
      if (!listKey) errors.push(`dòng danh sách không thuộc khoá nào: "${raw.trim()}"`);
      else data[listKey].push(unquote(item[1]));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):(?:\s+(.*))?$/);
    if (!kv) {
      errors.push(`dòng không hợp lệ: "${raw.trim()}"`);
      continue;
    }
    const [, key, value] = kv;
    if (value === undefined || value === "") {
      data[key] = [];
      listKey = key;
    } else {
      listKey = null;
      const quoted = /^(["']).*\1$/.test(value);
      if (!quoted && /: /.test(value)) errors.push(`${key}: chứa ": " mà không đặt trong ngoặc kép (YAML không hợp lệ)`);
      data[key] = unquote(value);
    }
  }
  return { data, errors };
}

const unquote = (s) => s.trim().replace(/^(["'])(.*)\1$/, "$2");

/** Đích của mọi link Markdown tương đối trong các file mục lục, dạng đường dẫn repo. */
function indexedPaths() {
  const set = new Set();
  for (const idx of INDEXES) {
    const file = path.join(root, idx);
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
      if (/^[a-z]+:/i.test(m[1])) continue; // http:, mailto:
      set.add(toPosix(path.normalize(path.join(path.dirname(idx), m[1]))));
    }
  }
  return set;
}

/** Lỗi của một file docs (text = nội dung, rel = đường dẫn repo). */
export function checkDoc(rel, text, { pathExists = (p) => existsSync(path.join(root, p)) } = {}) {
  const errors = [];
  const { front, body } = splitFrontmatter(text);
  if (!front && !text.replace(/\r\n/g, "\n").startsWith("---\n")) {
    return ["thiếu frontmatter (--- description/type --- ở đầu file)"];
  }
  const { data, errors: syntax } = parseFrontmatter(front);
  errors.push(...syntax);

  for (const k of Object.keys(data)) {
    if (!KEYS.has(k)) errors.push(`khoá lạ "${k}" (chỉ dùng: ${[...KEYS].join(", ")})`);
  }
  const d = data.description;
  if (typeof d !== "string" || !d.trim()) errors.push("thiếu description");
  else if (d.length > MAX_DESCRIPTION) errors.push(`description dài ${d.length} ký tự (tối đa ${MAX_DESCRIPTION})`);

  if (typeof data.type !== "string") errors.push(`thiếu type (${TYPES.join(" | ")})`);
  else if (!TYPES.includes(data.type)) errors.push(`type "${data.type}" không hợp lệ (${TYPES.join(" | ")})`);

  if (data.status !== undefined && !STATUSES.includes(data.status)) {
    errors.push(`status "${data.status}" không hợp lệ (${STATUSES.join(" | ")}; bỏ trống = active)`);
  }
  if (data.code !== undefined) {
    if (!Array.isArray(data.code)) errors.push("code phải là danh sách (`code:` rồi các dòng `  - path`)");
    else for (const p of data.code) if (!pathExists(p)) errors.push(`code: path không tồn tại "${p}"`);
  }
  if (!body.trim()) errors.push("không có nội dung sau frontmatter");
  return errors;
}

export function check() {
  const errors = [];
  const indexed = indexedPaths();
  const docs = listDocs();
  for (const rel of docs) {
    const errs = checkDoc(rel, readFileSync(path.join(root, rel), "utf8"));
    if (rel !== INDEXES[0] && !indexed.has(rel)) {
      errs.push(`chưa có trong mục lục (${INDEXES.join(" hoặc ")})`);
    }
    for (const e of errs) errors.push(`${rel}: ${e}`);
  }
  return { errors, count: docs.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors, count } = check();
  if (errors.length) {
    console.error(`Docs metadata lỗi (${errors.length}):\n- ` + errors.join("\n- "));
    process.exit(1);
  }
  console.log(`OK: ${count} file docs có frontmatter hợp lệ và có trong mục lục.`);
}
