#!/usr/bin/env node
// Tóm tắt vài dòng việc ở Now / Next trong todo/README.md cho hook SessionStart của Claude Code:
// mã phiên này, ai đang giữ việc nào (scripts/todo-claims.mjs), việc tiếp theo kèm gợi ý model.
// Stdout được nạp vào ngữ cảnh đầu phiên. Không có todo/ hay lỗi đọc thì im lặng, exit 0.
// Chạy: node scripts/todo-brief.mjs   (hook truyền JSON có session_id qua stdin)
import { readFileSync, existsSync } from "node:fs";
import { claimsPath, load, save, touchSession, short, ago, isStale, readHookInput } from "./todo-claims.mjs";
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

/** Giá trị một trường đơn trong frontmatter (bỏ chú thích `# …`); rỗng → null. */
export function field(taskMd, name) {
  const fm = taskMd.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const v = fm.match(new RegExp(`^${name}:[ \\t]*([^#\\r\\n]*)`, "m"))?.[1].trim();
  return v ? v : null;
}

/** Có câu hỏi mở chưa tick trong file task. */
export function hasOpenQuestions(taskMd) {
  const m = taskMd.match(/##\s+Câu hỏi mở\s*\n([\s\S]*?)(\n##\s|$)/);
  return !!m && /^\s*-\s+\[ \]/m.test(m[1]);
}

const MODELS = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };
const modelName = (v) => MODELS[String(v ?? "").toLowerCase()] ?? null;

/**
 * Model tối thiểu cho pha suy nghĩ (design/plan) — skill todo → "Model".
 * Field `model:` trong file task (họ model, không phiên bản) thắng; không có thì suy từ type/size:
 * mặc định Opus; Sonnet cho chore/docs, hoặc fix size S không còn câu hỏi mở. Không đọc được file → Opus.
 */
export function suggestModel(taskMd) {
  const set = modelName(field(taskMd, "model"));
  if (set) return set;
  const type = field(taskMd, "type");
  const size = field(taskMd, "size");
  if (type === "chore" || type === "docs") return "Sonnet";
  if (type === "fix" && size === "S" && !hasOpenQuestions(taskMd)) return "Sonnet";
  return "Opus";
}

/** Model tối thiểu cho một pha: build/verify dùng `model-build:` nếu có, còn lại như suggestModel. */
export function modelFor(taskMd, phase) {
  const build = modelName(field(taskMd, "model-build"));
  if (build && (phase === "build" || phase === "verify")) return build;
  return suggestModel(taskMd);
}

/** Chuỗi gợi ý cho cả việc: "Opus" hoặc "Opus, build Sonnet". */
export function modelHint(taskMd) {
  const think = suggestModel(taskMd);
  const build = modelFor(taskMd, "build");
  return build === think ? think : `${think}, build ${build}`;
}

export function brief(md, readTask = () => null, { session = null, book = null, now = new Date() } = {}) {
  const s = sections(md);
  const open = new Set(Object.values(s).flat().map((l) => parseItem(l).id));
  const claims = book?.claims ?? {};
  const describe = (it, { withModel = false, inNow = false } = {}) => {
    const task = it.link ? readTask(it.link) ?? "" : "";
    const parts = [];
    const phase = field(task, "phase");
    if (phase) parts.push(`pha ${phase}`);
    const c = criteria(task);
    if (c) parts.push(`tiêu chí ${c.done}/${c.total}`);
    const pr = field(task, "pr");
    if (pr) parts.push(`PR #${pr.replace(/^#/, "")}`);
    const cl = claims[it.id];
    if (cl) parts.push(cl.session === session ? "phiên này đang giữ" : `phiên ${short(cl.session)} đang giữ, ${ago(cl.lastSeen, now)}${isStale(cl, now) ? " (im lâu)" : ""}`);
    else if (book && inNow) parts.push("chưa phiên nào giữ");
    if (withModel) parts.push(`model: ${modelHint(task)}`);
    else if (inNow && task) parts.push(`model: ${modelFor(task, phase)}`);
    return parts.length ? `${it.title} (${parts.join(" · ")})` : it.title;
  };
  const lines = [];
  if (session) lines.push(`[todo] Phiên này: ${session}`);
  const now_ = (s.Now ?? []).map(parseItem);
  const next = (s.Next ?? []).map(parseItem);
  if (now_.length) lines.push(`[todo] Đang làm (Now): ${now_.map((it) => describe(it, { inNow: true })).join("; ")}`);
  const ready = next.find((it) => !it.blockedBy.some((b) => open.has(b)));
  if (ready) lines.push(`[todo] ${now_.length ? "Sau đó" : "Now trống. Việc tiếp theo"}: ${describe(ready, { withModel: true })}`);
  if (!now_.length && !ready) lines.push("[todo] Now và Next đều trống.");
  lines.push("[todo] Danh sách: todo/README.md · skill todo (/todo). Khi user hỏi làm gì tiếp / làm tiếp / việc tiếp theo thì dùng skill todo. Việc do phiên khác giữ thì không làm; hỏi user rồi /todo resume.");
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
      const input = readHookInput();
      const file = claimsPath(root);
      const book = file ? load(file) : null;
      if (book && input.session_id) {
        touchSession(book, { session: input.session_id, transcript: input.transcript_path, cwd: input.cwd });
        save(file, book);
      }
      console.log(brief(readFileSync(readme, "utf8"), readTask, { session: input.session_id ?? null, book }));
    }
  } catch {
    // Hook đầu phiên không được làm hỏng phiên.
  }
}
