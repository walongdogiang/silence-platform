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
// Sổ sự kiện chung (scripts/todo-events.mjs, ADR 0006):
//   node scripts/todo-claims.mjs claim T-xxx --session <id> --areas "packages/protocol/**,scripts/x.mjs"
//   node scripts/todo-claims.mjs event <kind> [T-xxx] --session <id> [--pr n] [--areas a,b] [--to T-xxx|all|master] [--text "…"]
//   node scripts/todo-claims.mjs feed [--hours 24] [--limit 20]
//   node scripts/todo-claims.mjs master [--session <id> | --clear]
//   node scripts/todo-claims.mjs reserve-id --session <id>   giữ chỗ mã T-xxx mới (không trùng với phiên khác)
//   node scripts/todo-claims.mjs worktree <T-xxx|tên> --branch <nhánh> --session <id>   tạo worktree ở <repo>-worktrees/<tên> (T-020)
// Hook cũng quét origin/main (ref đã fetch, không gọi mạng): PR merge bằng đường nào cũng thành sự kiện `merged`.
// Hook (đọc JSON của Claude Code ở stdin):
//   node scripts/todo-claims.mjs heartbeat          UserPromptSubmit: cập nhật lastSeen, cảnh báo nếu việc đã chuyển đi,
//                                                   in ≤3 sự kiện mới liên quan tới phiên này
import { readFileSync, writeFileSync, existsSync, renameSync, readdirSync } from "node:fs";
import {
  eventsPathFor,
  makeEvent,
  appendEvent,
  readEvents,
  relevantFor,
  pushLines,
  firstLook,
  formatEvent,
  areasOverlap,
  list,
  mergeEventsFromCommits,
  nextTaskId,
} from "./todo-events.mjs";
import { chatOf, isIdle, toplevelOf, mainRootOf, setOwner, ensureChat, wtKey, worktreesHome, normPath } from "./todo-owner.mjs";
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
  return { claims: {}, sessions: {}, moved: {}, master: null, worktrees: {} };
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
  book.sessions[session] = { ...prev, transcript: transcript ?? prev.transcript ?? null, cwd: cwd ?? prev.cwd ?? null, lastSeen: now.toISOString() };
  for (const c of Object.values(book.claims)) if (c.session === session) c.lastSeen = now.toISOString();
  // Bỏ phiên im quá SESSION_TTL_DAYS mà không giữ việc nào, để sổ không phình.
  const held = new Set([
    ...Object.values(book.claims).map((c) => c.session),
    ...Object.values(book.worktrees ?? {}).map((o) => o.session),
    book.master?.session,
  ]);
  for (const [id, s] of Object.entries(book.sessions))
    if (!held.has(id) && (now - new Date(s.lastSeen)) / 864e5 > SESSION_TTL_DAYS) delete book.sessions[id];
  return book;
}

export function heldBy(book, session) {
  return Object.entries(book.claims).find(([, c]) => c.session === session)?.[0] ?? null;
}

/** Dòng nhắc mỗi tin nhắn (T-072): phiên đang giữ việc nào, tên lấy từ mục lục; không giữ việc → null. */
export function holdingLine(book, session, readme = "") {
  const task = heldBy(book, session);
  if (!task) return null;
  const row = readme.split(/\r?\n/).find((l) => l.startsWith(`- ${task} `));
  const name = row ? row.slice(task.length + 3).split(" · ")[0].trim() : "";
  return `[todo] Phiên này đang giữ ${task}${name ? `: ${name}` : ""}. Cuối lượt: dòng 🏁/⏳/⛔ (CLAUDE.md → Kết thúc lượt).`;
}

/**
 * Nhận việc. Trả { ok, msg }. Từ chối khi: việc do phiên khác giữ (trừ takeover), phiên này đang giữ việc khác,
 * hoặc đã đủ MAX_NOW việc.
 */
export function claim(book, task, session, { takeover = false, force = false, worktree = null, branch = null, areas = null, now = new Date() } = {}) {
  if (!/^T-\d+$/.test(task)) return { ok: false, msg: `Mã việc không hợp lệ: ${task}` };
  if (!session) return { ok: false, msg: "Thiếu --session (dòng \"[todo] Phiên này:\" ở đầu phiên)." };
  const cur = book.claims[task];
  if (cur && cur.session === session) {
    if (areas?.length) cur.areas = list(areas);
    return { ok: true, msg: `Phiên này đã giữ ${task}.` };
  }
  const mine = heldBy(book, session);
  if (mine) return { ok: false, msg: `Phiên này đang giữ ${mine}. Mỗi phiên một việc: đóng hoặc release ${mine} trước.` };
  // Cùng một chat được app mở lại với mã phiên mới (T-020): nhận lại việc, không cần hỏi.
  const me = chatOf(book, session);
  const sameChat = !!cur && !!me && chatOf(book, cur.session) === me;
  if (cur && !takeover && !sameChat)
    return { ok: false, msg: `${task} đang do phiên ${short(cur.session)} giữ (${cur.worktree ?? "?"}, hoạt động ${ago(cur.lastSeen, now)}). Hỏi user rồi dùng /todo resume ${task}.` };
  if (cur && takeover && !sameChat && !force && !isIdle(cur, now))
    return {
      ok: false,
      msg: `${task}: chat giữ việc (phiên ${short(cur.session)}) còn hoạt động ${ago(cur.lastSeen, now)}. Nhờ user đóng chat đó; user xác nhận đã đóng thì chạy lại với --takeover --force.`,
    };
  if (!cur && Object.keys(book.claims).length >= MAX_NOW)
    return { ok: false, msg: `Đã có ${MAX_NOW} việc đang làm (${Object.keys(book.claims).join(", ")}). Làm xong hoặc release một việc trước.` };
  const sess = book.sessions[session] ?? {};
  if (cur && !sameChat) book.moved[cur.session] = { task, to: session, at: now.toISOString() };
  book.claims[task] = {
    session,
    transcript: sess.transcript ?? null,
    worktree: worktree ?? cur?.worktree ?? sess.cwd ?? null,
    branch: branch ?? cur?.branch ?? null,
    areas: areas?.length ? list(areas) : cur?.areas ?? [],
    started: cur?.started ?? now.toISOString(),
    lastSeen: now.toISOString(),
    ...(cur ? { from: cur.session } : {}),
  };
  if (sameChat) return { ok: true, msg: `Nhận lại ${task}: cùng chat mở lại (phiên cũ ${short(cur.session)}).` };
  return { ok: true, msg: cur ? `Đã chuyển ${task} từ phiên ${short(cur.session)} sang phiên này.` : `Đã nhận ${task}.` };
}

/** Việc khác đang giữ có vùng chồng với `areas` → danh sách cảnh báo (không chặn; user quyết). */
export function overlaps(book, task, areas) {
  const out = [];
  if (!list(areas).length) return out;
  for (const [t, c] of Object.entries(book.claims))
    if (t !== task && c.areas?.length && areasOverlap(areas, c.areas))
      out.push(`Cảnh báo: vùng chồng với ${t} (phiên ${short(c.session)}: ${c.areas.join(", ")}). Báo user; dễ xung đột merge.`);
  return out;
}

/** Ngữ cảnh "tôi là ai" của một phiên để lọc sự kiện. */
export function whoAmI(book, session) {
  const task = heldBy(book, session);
  return { session, task, areas: task ? book.claims[task].areas ?? [] : [], isMaster: book.master?.session === session };
}

/** Sự kiện mới liên quan tới phiên + dời con trỏ. Trả các dòng để in. */
export function pullEvents(book, events, session, now = new Date()) {
  const s = book.sessions[session];
  if (!s) return [];
  const r = relevantFor(events, whoAmI(book, session), s.lastEvent ?? firstLook(now));
  if (r.last) s.lastEvent = r.last;
  return pushLines(r);
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

/** Số commit tối đa xét mỗi lần quét origin/main. */
export const SYNC_MAX_COMMITS = 30;

/**
 * Quét commit mới trên `origin/main` (ref đã fetch, dùng chung mọi worktree) → sự kiện `merged`.
 * Lần đầu chỉ ghi mốc, không sinh sự kiện. Mốc không còn là tổ tiên (force-push) → đặt lại mốc.
 * Trả số sự kiện đã ghi.
 */
export function syncMain(book, evFile, cwd = root, now = new Date()) {
  const head = git(cwd, ["rev-parse", "--verify", "-q", "refs/remotes/origin/main"]);
  if (!head || head === book.mainSeen) return 0;
  const prev = book.mainSeen;
  book.mainSeen = head;
  if (!prev) return 0;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", prev, head], { cwd, stdio: "ignore" });
  } catch {
    return 0;
  }
  const log = git(cwd, ["log", "--first-parent", "--reverse", `-${SYNC_MAX_COMMITS}`, "--format=%H%x09%s", `${prev}..${head}`]);
  const commits = log
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, ...s] = l.split("\t");
      return { sha, subject: s.join("\t"), files: git(cwd, ["diff-tree", "--no-commit-id", "--name-only", "-r", sha]).split("\n").filter(Boolean) };
    });
  const evs = mergeEventsFromCommits(commits, readEvents(evFile), now);
  for (const e of evs) appendEvent(evFile, e);
  return evs.length;
}

/** Giữ chỗ mã việc mới trong sổ chung. Trả mã. */
export function reserveId(book, session, sources, now = new Date()) {
  const id = nextTaskId({ ...sources, idHigh: book.idHigh ?? 0 });
  book.idHigh = Number(id.slice(2));
  book.reserved = Object.fromEntries(
    Object.entries(book.reserved ?? {}).filter(([, r]) => (now - new Date(r.at)) / 864e5 <= SESSION_TTL_DAYS),
  );
  book.reserved[id] = { session, at: now.toISOString() };
  return id;
}

/** Ghi một sự kiện vào sổ chung; lỗi schema → trả msg. Dùng chung cho CLI và script khác (pr-merge). */
export function recordEvent(input, claimsFile = claimsPath()) {
  const r = makeEvent(input);
  if (!r.ok) return r;
  appendEvent(eventsPathFor(claimsFile), r.event);
  return r;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const file = claimsPath();
  if (!file) return 0;
  const book = load(file);
  const task = rest.find((a) => /^T-\d+$/.test(a));
  const evFile = eventsPathFor(file);
  switch (cmd) {
    case "heartbeat": {
      const input = readHookInput();
      const session = input.session_id;
      if (!session) return 0;
      touchSession(book, { session, transcript: input.transcript_path, cwd: input.cwd });
      ensureChat(book, { session, transcript: input.transcript_path });
      const moved = book.moved[session];
      if (moved) {
        console.log(`[todo] ${moved.task} đã chuyển sang phiên ${short(moved.to)} (${ago(moved.at)}). Phiên này không sửa ${moved.task} nữa; báo user.`);
        delete book.moved[session];
      }
      syncMain(book, evFile);
      const readmeAt = path.join(input.cwd || root, "todo", "README.md");
      const hold = holdingLine(book, session, existsSync(readmeAt) ? readFileSync(readmeAt, "utf8") : "");
      if (hold) console.log(hold);
      for (const l of pullEvents(book, readEvents(evFile), session)) console.log(l);
      save(file, book);
      return 0;
    }
    case "worktree": {
      // Tạo worktree cho một việc ở thư mục chung `<repo chính>-worktrees/<tên>` (T-020), từ origin/main mới nhất.
      const session = arg(rest, "--session");
      const branchName = arg(rest, "--branch");
      const name = rest.find((a, i) => i > 0 ? !rest[i - 1].startsWith("--") && !a.startsWith("--") : !a.startsWith("--"));
      if (!session || !branchName || !name || !/^[\w.-]+$/.test(name))
        return console.log("Dùng: worktree <T-xxx|tên> --branch <type>/<T-xxx-slug> --session <id>"), 1;
      const home = worktreesHome(mainRootOf(process.cwd()));
      if (!home) return console.log("Không tìm thấy repo git."), 1;
      const dest = `${home}/${name}`;
      if (existsSync(dest)) return console.log(`${dest} đã có. Không dùng lại worktree có sẵn; hỏi user hoặc đặt tên khác.`), 1;
      try {
        execFileSync("git", ["fetch", "-q", "origin", "main"], { stdio: "ignore", timeout: 15000 });
      } catch {
        console.log("(không fetch được origin/main; dùng bản đã có)");
      }
      try {
        execFileSync("git", ["worktree", "add", "-q", "--no-track", "-b", branchName, dest, "origin/main"], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
      } catch (e) {
        return console.log(`Không tạo được worktree: ${String(e.stderr ?? e.message).trim()}`), 1;
      }
      ensureChat(book, { session });
      setOwner(book, { session, wt: dest, branch: branchName });
      save(file, book);
      console.log(`Đã tạo ${normPath(dest)} (nhánh ${branchName} từ origin/main), chat này là chủ. Chạy lệnh trong thư mục đó; cần thì npm install.`);
      return 0;
    }
    case "reserve-id": {
      const session = arg(rest, "--session");
      if (!session) return console.log('Thiếu --session (dòng "[todo] Phiên này:" ở đầu phiên).'), 1;
      const cwd = process.cwd();
      try {
        // Lệnh tay, không phải hook: được gọi mạng để thấy bộ đếm mới nhất trên main. Lỗi (mất mạng, khoá ref) → dùng ref đang có.
        execFileSync("git", ["fetch", "-q", "origin", "main"], { cwd, stdio: "ignore", timeout: 15000 });
      } catch {
        console.log("(không fetch được origin/main; dùng bản đã có)");
      }
      const readmeAt = path.join(cwd, "todo", "README.md");
      const id = reserveId(book, session, {
        readmeLocal: existsSync(readmeAt) ? readFileSync(readmeAt, "utf8") : "",
        readmeMain: git(cwd, ["show", "refs/remotes/origin/main:todo/README.md"]),
        refNames: git(cwd, ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin", "refs/heads"]),
      });
      save(file, book);
      recordEvent({ kind: "id_reserved", session, task: id }, file);
      console.log(`${id} — đã giữ chỗ. Ghi "Mã tiếp theo: T-${String(Number(id.slice(2)) + 1).padStart(3, "0")}" vào todo/README.md của nhánh.`);
      return 0;
    }
    case "claim": {
      const session = arg(rest, "--session");
      const cwd = process.cwd();
      const areas = list(arg(rest, "--areas"));
      const prev = book.claims[task];
      ensureChat(book, { session });
      // Worktree thật (T-020): gốc git của thư mục đang chạy lệnh; thư mục chính là của user, không ghi làm worktree của việc.
      const wt = toplevelOf(cwd);
      const inMain = !wt || wtKey(wt) === wtKey(mainRootOf(cwd));
      const branch = git(cwd, ["branch", "--show-current"]) || null;
      const r = claim(book, task, session, {
        takeover: rest.includes("--takeover"),
        force: rest.includes("--force"),
        worktree: inMain ? null : wt,
        branch: inMain ? null : branch,
        areas,
      });
      console.log(r.msg);
      if (!r.ok) return 1;
      if (inMain) console.log(`Lưu ý: đang ở thư mục chính, chưa ghi worktree. Tạo worktree cho việc: node scripts/todo-claims.mjs worktree ${task} --branch <type>/${task}-slug --session <id>, rồi chạy lại claim trong đó.`);
      else if (!setOwner(book, { session, wt, branch }).took) console.log(`Cảnh báo: ${wt} đang thuộc một chat khác (node scripts/todo-claims.mjs list). Báo user.`);
      for (const w of overlaps(book, task, book.claims[task].areas)) console.log(w);
      save(file, book);
      if (prev && prev.session !== session) recordEvent({ kind: "handoff", session, task }, file);
      else if (!prev || areas.length) recordEvent({ kind: "claim", session, task, areas: book.claims[task].areas }, file);
      return 0;
    }
    case "release": {
      const session = arg(rest, "--session");
      const had = book.claims[task];
      const r = release(book, task, session);
      if (r.ok) save(file, book);
      if (r.ok && had) recordEvent({ kind: "release", session: session ?? had.session, task }, file);
      console.log(r.msg);
      return r.ok ? 0 : 1;
    }
    case "event": {
      const [kind] = rest;
      const session = arg(rest, "--session");
      if (!session) return console.log('Thiếu --session (dòng "[todo] Phiên này:" ở đầu phiên).'), 1;
      const r = recordEvent(
        { kind, session, task: task ?? heldBy(book, session) ?? undefined, pr: arg(rest, "--pr"), areas: arg(rest, "--areas"), to: arg(rest, "--to"), text: arg(rest, "--text") },
        file,
      );
      console.log(r.ok ? `Đã ghi: ${formatEvent(r.event)}` : r.msg);
      return r.ok ? 0 : 1;
    }
    case "feed": {
      const hours = Number(arg(rest, "--hours") ?? 24);
      const limit = Number(arg(rest, "--limit") ?? 20);
      const since = new Date(Date.now() - hours * 36e5).toISOString();
      const evs = readEvents(evFile).filter((e) => e.ts > since).slice(-limit);
      console.log(evs.length ? evs.map(formatEvent).join("\n") : `Không có sự kiện trong ${hours} giờ qua.`);
      return 0;
    }
    case "master": {
      const session = arg(rest, "--session");
      if (rest.includes("--clear")) {
        book.master = null;
        save(file, book);
        console.log("Đã bỏ master.");
      } else if (session) {
        book.master = { session, since: new Date().toISOString() };
        save(file, book);
        console.log(`Phiên ${short(session)} là master: nhận mọi sự kiện và note --to master.`);
      } else console.log(book.master ? `Master: phiên ${short(book.master.session)} (từ ${ago(book.master.since)}).` : "Chưa có master.");
      return 0;
    }
    case "list": {
      const entries = Object.entries(book.claims);
      if (!entries.length) console.log("Không có việc nào đang được giữ.");
      for (const [t, c] of entries)
        console.log(`${t} · phiên ${short(c.session)} · ${c.worktree ?? "?"} · ${c.branch ?? "?"} · ${ago(c.lastSeen)}${isStale(c) ? " · im lâu" : ""}${c.areas?.length ? ` · vùng ${c.areas.join(", ")}` : ""}`);
      if (book.master) console.log(`Master: phiên ${short(book.master.session)}`);
      const owners = Object.values(book.worktrees ?? {});
      if (owners.length) console.log("Chủ worktree:");
      for (const o of owners)
        console.log(`  ${o.path} · chat ${short(o.chat ?? o.session)} · ${o.branch ?? "?"} · ${isIdle(o) ? "⚪ im" : o.state === "waiting" ? "🟡 chờ user" : "🟢 đang chạy"} · ${ago(o.lastSeen)}`);
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
      console.log("Lệnh: claim | release | list | handoff | doctor | event | feed | master | reserve-id | worktree | heartbeat");
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
