#!/usr/bin/env node
// Sổ giữ việc của todo/: chat (phiên Claude Code) nào đang giữ việc T-xxx nào.
// Một phiên giữ tối đa 1 việc; tối đa MAX_NOW việc được giữ cùng lúc. Không bao giờ tự lấy việc của phiên khác.
// Sổ nằm ở thư mục git chung (`git rev-parse --git-common-dir`) nên mọi worktree thấy cùng một sổ; không commit.
//
// Lệnh (agent chạy bằng Bash; skill todo):
//   node scripts/todo-claims.mjs claim T-xxx --session <id> [--takeover]
//   node scripts/todo-claims.mjs release T-xxx [--session <id>]
//   node scripts/todo-claims.mjs list
//   node scripts/todo-claims.mjs handoff T-xxx      gom ngữ cảnh để làm tiếp ở chat mới
//   node scripts/todo-claims.mjs doctor             so mục lục, file task, sổ giữ việc
// Hook (đọc JSON của Claude Code ở stdin):
//   node scripts/todo-claims.mjs heartbeat          UserPromptSubmit: cập nhật lastSeen, cảnh báo nếu việc đã chuyển đi
import { readFileSync, writeFileSync, existsSync, renameSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_NOW = 2;
/** Im hơn số giờ này thì coi là có thể đã bỏ dở (chỉ để báo; không tự lấy). */
export const STALE_HOURS = 48;
export const SESSION_TTL_DAYS = 14;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function claimsPath(cwd = root) {
  try {
    const dir = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf8" }).trim();
    return path.join(path.resolve(cwd, dir), "todo-claims.json");
  } catch {
    return null;
  }
}

export function emptyBook() {
  return { claims: {}, sessions: {}, moved: {} };
}

export function load(file) {
  if (!file || !existsSync(file)) return emptyBook();
  try {
    return { ...emptyBook(), ...JSON.parse(readFileSync(file, "utf8")) };
  } catch {
    return emptyBook();
  }
}

export function save(file, book) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(book, null, 2));
  renameSync(tmp, file);
}

/** Ghi nhận một phiên (SessionStart / heartbeat). */
export function touchSession(book, { session, transcript, cwd }, now = new Date()) {
  if (!session) return book;
  const prev = book.sessions[session] ?? {};
  book.sessions[session] = { transcript: transcript ?? prev.transcript ?? null, cwd: cwd ?? prev.cwd ?? null, lastSeen: now.toISOString() };
  for (const c of Object.values(book.claims)) if (c.session === session) c.lastSeen = now.toISOString();
  // Bỏ phiên im quá SESSION_TTL_DAYS mà không giữ việc nào, để sổ không phình.
  const held = new Set(Object.values(book.claims).map((c) => c.session));
  for (const [id, s] of Object.entries(book.sessions))
    if (!held.has(id) && (now - new Date(s.lastSeen)) / 864e5 > SESSION_TTL_DAYS) delete book.sessions[id];
  return book;
}

export function heldBy(book, session) {
  return Object.entries(book.claims).find(([, c]) => c.session === session)?.[0] ?? null;
}

/**
 * Nhận việc. Trả { ok, msg }. Từ chối khi: việc do phiên khác giữ (trừ takeover), phiên này đang giữ việc khác,
 * hoặc đã đủ MAX_NOW việc.
 */
export function claim(book, task, session, { takeover = false, worktree = null, branch = null, now = new Date() } = {}) {
  if (!/^T-\d+$/.test(task)) return { ok: false, msg: `Mã việc không hợp lệ: ${task}` };
  if (!session) return { ok: false, msg: "Thiếu --session (dòng \"[todo] Phiên này:\" ở đầu phiên)." };
  const cur = book.claims[task];
  if (cur && cur.session === session) return { ok: true, msg: `Phiên này đã giữ ${task}.` };
  const mine = heldBy(book, session);
  if (mine) return { ok: false, msg: `Phiên này đang giữ ${mine}. Mỗi phiên một việc: đóng hoặc release ${mine} trước.` };
  if (cur && !takeover)
    return { ok: false, msg: `${task} đang do phiên ${short(cur.session)} giữ (${cur.worktree ?? "?"}, hoạt động ${ago(cur.lastSeen, now)}). Hỏi user rồi dùng /todo resume ${task}.` };
  if (!cur && Object.keys(book.claims).length >= MAX_NOW)
    return { ok: false, msg: `Đã có ${MAX_NOW} việc đang làm (${Object.keys(book.claims).join(", ")}). Làm xong hoặc release một việc trước.` };
  const sess = book.sessions[session] ?? {};
  if (cur && takeover) book.moved[cur.session] = { task, to: session, at: now.toISOString() };
  book.claims[task] = {
    session,
    transcript: sess.transcript ?? null,
    worktree: worktree ?? cur?.worktree ?? sess.cwd ?? null,
    branch: branch ?? cur?.branch ?? null,
    started: cur?.started ?? now.toISOString(),
    lastSeen: now.toISOString(),
    ...(cur && takeover ? { from: cur.session } : {}),
  };
  return { ok: true, msg: cur ? `Đã chuyển ${task} từ phiên ${short(cur.session)} sang phiên này.` : `Đã nhận ${task}.` };
}

export function release(book, task, session = null) {
  const cur = book.claims[task];
  if (!cur) return { ok: true, msg: `${task} không có ai giữ.` };
  if (session && cur.session !== session) return { ok: false, msg: `${task} do phiên ${short(cur.session)} giữ, không phải phiên này.` };
  delete book.claims[task];
  return { ok: true, msg: `Đã trả ${task}.` };
}

export function short(id) {
  return id ? String(id).slice(0, 8) : "?";
}

export function ago(iso, now = new Date()) {
  if (!iso) return "chưa rõ";
  const h = (now - new Date(iso)) / 36e5;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} phút trước`;
  if (h < 48) return `${Math.round(h)} giờ trước`;
  return `${Math.round(h / 24)} ngày trước`;
}

export function isStale(c, now = new Date()) {
  return !c.lastSeen || (now - new Date(c.lastSeen)) / 36e5 > STALE_HOURS;
}

/** Khoảng N lượt nói chuyện cuối (chỉ chữ, bỏ tool) của transcript JSONL. */
export function transcriptTail(jsonl, turns = 10, maxChars = 600) {
  const out = [];
  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type !== "user" && e.type !== "assistant") continue;
    if (e.isMeta || e.isCompactSummary) continue;
    const c = e.message?.content;
    const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((p) => p.type === "text").map((p) => p.text).join("\n") : "";
    const t = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
    if (!t) continue;
    out.push(`${e.type === "user" ? "USER" : "AGENT"}: ${t.length > maxChars ? `${t.slice(0, maxChars)}…` : t}`);
  }
  return out.slice(-turns);
}

function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trimEnd();
  } catch {
    return "";
  }
}

/** Ngữ cảnh chuyển giao: file task, trạng thái git của worktree cũ, đuôi transcript cũ. */
export function handoff(book, task, todoDir = path.join(root, "todo")) {
  const c = book.claims[task];
  const lines = [`# Chuyển giao ${task}`];
  const file = findTaskFile(todoDir, task);
  lines.push(`File task: ${file ? path.relative(root, file).replaceAll("\\", "/") : "(chưa có)"} — đọc Nhật ký, Kế hoạch, Tiêu chí xong trước.`);
  if (!c) {
    lines.push("Không có phiên nào đang giữ việc này.");
    return lines.join("\n");
  }
  lines.push(`Phiên cũ: ${c.session} · hoạt động ${ago(c.lastSeen)} · worktree ${c.worktree ?? "?"} · nhánh ${c.branch ?? "?"}`);
  const wt = c.worktree && existsSync(c.worktree) ? c.worktree : null;
  if (wt) {
    const branch = git(wt, ["branch", "--show-current"]);
    lines.push("", `## Git (${wt}, nhánh ${branch || "?"})`);
    const log = git(wt, ["log", "--oneline", "origin/main..HEAD"]);
    lines.push("Commit chưa có trên main:", log || "(không có)");
    const status = git(wt, ["status", "--short"]);
    lines.push("Thay đổi chưa commit:", status || "(không có)");
    const stat = git(wt, ["diff", "--stat", "origin/main"]);
    if (stat) lines.push("So với origin/main:", stat.split("\n").slice(-15).join("\n"));
  } else lines.push("", "Worktree cũ không còn; làm tiếp từ nhánh nếu có.");
  if (c.transcript && existsSync(c.transcript)) {
    const tail = transcriptTail(readFileSync(c.transcript, "utf8"));
    if (tail.length) lines.push("", "## Cuối chat cũ (dự phòng — tin file task trước)", ...tail);
  }
  return lines.join("\n");
}

export function findTaskFile(todoDir, task) {
  for (const dir of [path.join(todoDir, "tasks"), path.join(todoDir, "tasks", "archive")]) {
    if (!existsSync(dir)) continue;
    const f = readdirSync(dir).find((n) => n.startsWith(`${task}-`) && n.endsWith(".md"));
    if (f) return path.join(dir, f);
  }
  return null;
}

/** Kiểm mục lục ↔ file task ↔ sổ giữ việc. Trả danh sách vấn đề (chuỗi). */
export function doctor(readme, book, readTask, now = new Date()) {
  const issues = [];
  const sec = {};
  let cur = null;
  for (const line of readme.split(/\r?\n/)) {
    const h = line.match(/^##\s+(\S+)/);
    if (h) cur = sec[(h[1])] = [];
    else if (cur && /^-\s+T-\d+/.test(line)) cur.push(line);
  }
  const ids = new Map();
  for (const [name, items] of Object.entries(sec))
    for (const l of items) {
      const id = l.match(/T-\d+/)[0];
      if (ids.has(id)) issues.push(`${id} nằm ở cả ${ids.get(id)} và ${name}.`);
      ids.set(id, name);
      const link = l.match(/\]\((tasks\/[^)]+)\)/)?.[1];
      if (link && readTask(link) == null) issues.push(`${id}: link ${link} không tồn tại.`);
      const status = link ? readTask(link)?.match(/^status:\s*(\S+)/m)?.[1] : null;
      if (name === "Now" && status && status !== "in-progress" && status !== "blocked") issues.push(`${id} ở Now nhưng status: ${status}.`);
      if (name !== "Now" && status === "in-progress") issues.push(`${id} status: in-progress nhưng nằm ở ${name}.`);
    }
  const now_ = sec.Now ?? [];
  if (now_.length > MAX_NOW) issues.push(`Now có ${now_.length} việc (tối đa ${MAX_NOW}).`);
  const max = Math.max(0, ...[...ids.keys()].map((i) => Number(i.slice(2))));
  const next = Number(readme.match(/Mã tiếp theo:\s*T-(\d+)/)?.[1] ?? 0);
  if (next && next <= max) issues.push(`Mã tiếp theo T-${String(next).padStart(3, "0")} không lớn hơn mã lớn nhất T-${String(max).padStart(3, "0")}.`);
  for (const [task, c] of Object.entries(book.claims)) {
    if (ids.get(task) !== "Now") issues.push(`${task} đang được phiên ${short(c.session)} giữ nhưng không ở Now.`);
    if (isStale(c, now)) issues.push(`${task}: phiên ${short(c.session)} im ${ago(c.lastSeen, now)} — hỏi user: làm tiếp (/todo resume) hay release.`);
  }
  for (const l of now_) {
    const id = l.match(/T-\d+/)[0];
    if (!book.claims[id]) issues.push(`${id} ở Now nhưng không phiên nào giữ — /todo resume ${id} để nhận.`);
  }
  return issues;
}

/** Đọc JSON hook ở stdin; không có stdin (chạy tay) → {}. */
export function readHookInput() {
  if (process.stdin.isTTY) return {};
  try {
    const raw = readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function arg(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const file = claimsPath();
  if (!file) return 0;
  const book = load(file);
  const task = rest.find((a) => /^T-\d+$/.test(a));
  switch (cmd) {
    case "heartbeat": {
      const input = readHookInput();
      const session = input.session_id;
      if (!session) return 0;
      touchSession(book, { session, transcript: input.transcript_path, cwd: input.cwd });
      const moved = book.moved[session];
      if (moved) {
        console.log(`[todo] ${moved.task} đã chuyển sang phiên ${short(moved.to)} (${ago(moved.at)}). Phiên này không sửa ${moved.task} nữa; báo user.`);
        delete book.moved[session];
      }
      save(file, book);
      return 0;
    }
    case "claim": {
      const session = arg(rest, "--session");
      const cwd = process.cwd();
      const r = claim(book, task, session, {
        takeover: rest.includes("--takeover"),
        worktree: cwd,
        branch: git(cwd, ["branch", "--show-current"]) || null,
      });
      if (r.ok) save(file, book);
      console.log(r.msg);
      return r.ok ? 0 : 1;
    }
    case "release": {
      const r = release(book, task, arg(rest, "--session"));
      if (r.ok) save(file, book);
      console.log(r.msg);
      return r.ok ? 0 : 1;
    }
    case "list": {
      const entries = Object.entries(book.claims);
      if (!entries.length) console.log("Không có việc nào đang được giữ.");
      for (const [t, c] of entries)
        console.log(`${t} · phiên ${short(c.session)} · ${c.worktree ?? "?"} · ${c.branch ?? "?"} · ${ago(c.lastSeen)}${isStale(c) ? " · im lâu" : ""}`);
      return 0;
    }
    case "handoff":
      if (!task) return console.log("Cần mã việc: handoff T-xxx"), 1;
      console.log(handoff(book, task));
      return 0;
    case "doctor": {
      const todoDir = path.join(root, "todo");
      const readTask = (rel) => (existsSync(path.join(todoDir, rel)) ? readFileSync(path.join(todoDir, rel), "utf8") : null);
      const issues = doctor(readFileSync(path.join(todoDir, "README.md"), "utf8"), book, readTask);
      console.log(issues.length ? issues.map((i) => `- ${i}`).join("\n") : "Không thấy gì lệch.");
      return issues.length ? 1 : 0;
    }
    default:
      console.log("Lệnh: claim | release | list | handoff | doctor | heartbeat");
      return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let code = 0;
  try {
    code = main(process.argv.slice(2));
  } catch (e) {
    // Hook không được làm hỏng phiên.
    if (process.argv[2] !== "heartbeat") {
      console.error(String(e?.message ?? e));
      code = 1;
    }
  }
  process.exitCode = code;
}
