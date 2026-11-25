// Chủ worktree theo chat (T-020, ADR 0006): worktree nào đang thuộc chat nào, và có cho một lệnh git đổi trạng thái chạy không.
// "Chat" ≠ "phiên": app mở lại chat thì tạo mã phiên mới nhưng chép lịch sử giữ nguyên `uuid` tin nhắn →
// mã chat = uuid của dòng đầu có uuid trong transcript. Đọc không được → không biết (hỏi user, không đoán).
// Sổ: `book.worktrees[<khoá>] = { path, chat, session, branch, lastSeen, state }` trong todo-claims.json. Thư mục chính không có chủ.
import { existsSync, openSync, readSync, closeSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Chủ im quá chừng này giờ thì không chặn nữa mà hỏi user. */
export const IDLE_HOURS = 2;

/** Lệnh git đổi trạng thái worktree/nhánh. Mọi lệnh khác (status, log, diff, fetch, show…) không bao giờ bị chặn. */
export const MUTATING = new Set(["commit", "push", "switch", "checkout", "reset", "rebase", "merge", "cherry-pick", "stash", "pull", "revert", "am"]);
const WORKTREE_MUTATING = new Set(["remove", "move"]);

/** Mã chat từ nội dung (đầu) transcript JSONL: uuid của dòng đầu tiên có uuid. */
export function chatIdFromTranscript(text) {
  for (const line of String(text ?? "").split(/\r?\n/)) {
    if (!line.includes('"uuid"')) continue;
    try {
      const e = JSON.parse(line);
      if (typeof e.uuid === "string" && e.uuid) return e.uuid;
    } catch {
      // dòng cắt dở ở cuối đoạn đọc: bỏ qua
    }
  }
  return null;
}

/** Đọc tối đa `bytes` đầu file (transcript có thể vài MB). */
export function readHead(file, bytes = 65536) {
  if (!file || !existsSync(file)) return "";
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/**
 * Gắn mã chat cho phiên (một lần). `source: fork` → chat mới (= mã phiên) dù chung lịch sử.
 * readTranscript: (path) => text, để test.
 */
export function ensureChat(book, { session, transcript, source }, readTranscript = readHead) {
  if (!session) return null;
  const s = (book.sessions[session] ??= {});
  if (source === "fork") s.chat = session;
  if (!s.chat) s.chat = chatIdFromTranscript(readTranscript(transcript ?? s.transcript)) ?? null;
  return s.chat;
}

export const chatOf = (book, session) => book.sessions?.[session]?.chat ?? null;

/** Đường dẫn chuẩn: `/`, ổ đĩa hoa, `/d/x` (git bash) → `D:/x`, bỏ `/` cuối. */
export function normPath(p) {
  if (!p) return null;
  let s = String(p).trim().replace(/^["']|["']$/g, "").replaceAll("\\", "/");
  const m = s.match(/^\/([a-zA-Z])(\/|$)/);
  if (m) s = `${m[1]}:/${s.slice(3)}`;
  s = s.replace(/^([a-z]):/, (_, d) => `${d.toUpperCase()}:`);
  return s.length > 3 ? s.replace(/\/+$/, "") : s;
}

/** Khoá so sánh (Windows không phân biệt hoa thường). */
export const wtKey = (p) => normPath(p)?.toLowerCase() ?? null;

/** Tách lệnh shell thành các đoạn (&&, ||, ;, |, xuống dòng), mỗi đoạn là danh sách từ (giữ nháy). */
export function splitCommand(command) {
  const segs = [];
  let cur = [];
  let word = "";
  let quote = null;
  let has = false;
  const push = () => {
    if (has) cur.push(word);
    word = "";
    has = false;
  };
  const end = () => {
    push();
    if (cur.length) segs.push(cur);
    cur = [];
  };
  const s = String(command ?? "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else word += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === " " || c === "\t") push();
    else if (c === "\n" || c === ";" || c === "|" || (c === "&" && s[i + 1] === "&")) {
      if (c === "&" || (c === "|" && s[i + 1] === "|")) i++;
      end();
    } else {
      word += c;
      has = true;
    }
  }
  end();
  return segs;
}

const resolveDir = (dir, base) => {
  const d = normPath(dir);
  if (!d) return base;
  if (/^[A-Z]:/.test(d)) return d;
  return base ? normPath(path.posix.join(base, d)) : d;
};

/**
 * Các lệnh git đổi trạng thái trong một lệnh shell (bash hoặc PowerShell) và thư mục chúng chạy.
 * Thư mục: `git -C <dir>` → `cd`/`Set-Location`/`pushd` gần nhất trước đó → cwd của hook.
 * Trả [{ op, dir }]; lệnh chỉ đọc không có trong danh sách.
 */
export function parseGitCommand(command, cwd) {
  let dir = normPath(cwd);
  const out = [];
  for (const seg of splitCommand(command)) {
    let i = 0;
    while (i < seg.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(seg[i])) i++; // VAR=x cmd
    const cmd = (seg[i] ?? "").toLowerCase();
    if (cmd === "cd" || cmd === "set-location" || cmd === "pushd" || cmd === "sl") {
      let args = seg.slice(i + 1).filter((a) => !/^-(path|literalpath)$/i.test(a));
      if (args[0]?.toLowerCase() === "/d" && args.length > 1) args = args.slice(1); // cmd.exe `cd /d X`
      if (args[0]) dir = resolveDir(args[0], dir);
      continue;
    }
    if (cmd !== "git" && cmd !== "git.exe") continue;
    let gdir = dir;
    let j = i + 1;
    for (; j < seg.length; j++) {
      const a = seg[j];
      if (a === "-C") gdir = resolveDir(seg[++j], gdir);
      else if (a === "-c" || a === "--git-dir" || a === "--work-tree") j++;
      else if (!a.startsWith("-")) break;
    }
    const sub = seg[j];
    if (MUTATING.has(sub)) out.push({ op: sub, dir: gdir });
    else if (sub === "worktree" && WORKTREE_MUTATING.has(seg[j + 1])) {
      // Đích là worktree bị xoá/chuyển, không phải thư mục chạy lệnh.
      const target = seg.slice(j + 2).find((a) => !a.startsWith("-"));
      out.push({ op: `worktree ${seg[j + 1]}`, dir: target ? resolveDir(target, gdir) : gdir });
    }
  }
  return out;
}

/**
 * Tìm repo git chứa `dir` bằng cách đọc `.git` trên đĩa — không chạy `git` (mỗi lần ~100 ms trên Windows, hook chạy mỗi lệnh).
 * Trả { toplevel, gitdir, commonDir } hoặc null. Worktree phụ: `.git` là file "gitdir: …", trong gitdir có file `commondir`.
 */
export function findGit(dir) {
  let d = normPath(dir);
  for (let i = 0; d && i < 64; i++) {
    const dotgit = `${d}/.git`;
    if (existsSync(dotgit)) {
      try {
        if (statSync(dotgit).isDirectory()) return { toplevel: d, gitdir: dotgit, commonDir: dotgit };
        const gitdir = normPath(path.resolve(d, readFileSync(dotgit, "utf8").match(/^gitdir:\s*(.+)$/m)[1].trim()));
        const cd = existsSync(`${gitdir}/commondir`) ? readFileSync(`${gitdir}/commondir`, "utf8").trim() : ".";
        return { toplevel: d, gitdir, commonDir: normPath(path.resolve(gitdir, cd)) };
      } catch {
        return null;
      }
    }
    const up = normPath(path.posix.dirname(d));
    if (!up || up === d) break;
    d = up;
  }
  return null;
}

/** Thư mục gốc worktree chứa `dir`, hoặc null. */
export function toplevelOf(dir) {
  return dir ? findGit(dir)?.toplevel ?? null : null;
}

/** Thư mục chính của repo (cha của git common dir) — của user, không bao giờ có chủ. */
export function mainRootOf(dir) {
  const g = dir ? findGit(dir) : null;
  return g ? normPath(path.posix.dirname(g.commonDir)) : null;
}

/** Nhánh hiện tại của worktree (đọc HEAD), null khi tách nhánh. */
export function branchOf(wt) {
  try {
    const head = readFileSync(`${findGit(wt).gitdir}/HEAD`, "utf8");
    return head.match(/^ref:\s*refs\/heads\/(.+)$/m)?.[1].trim() ?? null;
  } catch {
    return null;
  }
}

const hoursSince = (iso, now) => (iso ? (now - new Date(iso)) / 36e5 : Infinity);
const mins = (iso, now) => Math.max(1, Math.round(hoursSince(iso, now) * 60));
const short = (id) => (id ? String(id).slice(0, 8) : "?");

/** Chủ có phải chính chat này không (cùng chat, hoặc cùng phiên khi chưa biết chat). */
export function sameOwner(book, owner, session) {
  if (!owner) return true;
  if (owner.session === session) return true;
  const me = chatOf(book, session);
  return !!me && owner.chat === me;
}

export function isIdle(owner, now = new Date()) {
  return hoursSince(owner?.lastSeen, now) >= IDLE_HOURS;
}

const RANK = { allow: 0, ask: 1, deny: 2 };

/**
 * Quyết định cho các lệnh git đổi trạng thái. targets: [{ op, wt }] với wt = gốc worktree đã chuẩn (null/thư mục chính → bỏ qua).
 * Trả { decision: allow|ask|deny, reason }.
 */
export function guardGit(book, { session, targets }, now = new Date()) {
  let res = { decision: "allow", reason: "" };
  for (const { op, wt } of targets ?? []) {
    const owner = wt ? book.worktrees?.[wtKey(wt)] : null;
    if (sameOwner(book, owner, session)) continue;
    const who = `chat ${short(owner.chat ?? owner.session)}${owner.branch ? ` (nhánh ${owner.branch})` : ""}`;
    let r;
    if (!chatOf(book, session))
      r = { decision: "ask", reason: `git ${op} trong ${wt}: worktree đang thuộc ${who}, mà không đọc được mã chat của phiên này để biết có phải cùng một chat mở lại không. Cho phép = chuyển worktree sang chat này.` };
    else if (!isIdle(owner, now))
      r = {
        decision: "deny",
        reason: `git ${op} bị chặn: ${wt} đang thuộc ${who}, hoạt động ${mins(owner.lastSeen, now)} phút trước. Không làm trong worktree của chat khác — tạo worktree riêng: node scripts/todo-claims.mjs worktree <T-xxx|tên> --branch <nhánh> --session <id>. Nếu user xác nhận chat kia đã đóng, báo user (không tự lách).`,
      };
    else
      r = { decision: "ask", reason: `git ${op} trong ${wt}: worktree thuộc ${who}, im từ ${Math.round(hoursSince(owner.lastSeen, now))} giờ trước. Xem lại rồi cho phép = chuyển worktree sang chat này (chat kia sẽ được báo).` };
    if (RANK[r.decision] > RANK[res.decision]) res = r;
  }
  return res;
}

/** Cập nhật hoạt động: mọi worktree do chat này giữ → lastSeen, state. */
export function touchChat(book, session, state = "running", now = new Date()) {
  for (const o of Object.values(book.worktrees ?? {}))
    if (sameOwner(book, o, session)) {
      o.lastSeen = now.toISOString();
      o.state = state;
      o.session = session;
    }
}

/**
 * Ghi chat này làm chủ worktree `wt` (sau lệnh git đã được phép, hoặc khi sửa file). Không cướp chủ của chat khác
 * trừ khi `transfer` (lệnh đã qua hỏi/được phép). Trả { took, from } — from: chủ cũ nếu vừa chuyển.
 */
export function setOwner(book, { session, wt, branch = null, transfer = false }, now = new Date()) {
  if (!wt) return { took: false };
  book.worktrees ??= {};
  const key = wtKey(wt);
  const cur = book.worktrees[key];
  if (cur && !sameOwner(book, cur, session) && !transfer) return { took: false };
  const from = cur && !sameOwner(book, cur, session) ? cur : null;
  book.worktrees[key] = {
    path: normPath(wt),
    chat: chatOf(book, session),
    session,
    branch: branch ?? cur?.branch ?? null,
    lastSeen: now.toISOString(),
    state: "running",
  };
  if (from) {
    book.moved[from.session] = { task: `worktree ${normPath(wt)}`, to: session, at: now.toISOString() };
    for (const c of Object.values(book.claims ?? {}))
      if (c.session === from.session && wtKey(c.worktree) === key) {
        c.session = session;
        c.lastSeen = now.toISOString();
      }
  }
  return { took: true, from };
}

/** Thư mục chứa mọi worktree: `<cha của thư mục chính>/<tên thư mục chính>-worktrees`. */
export function worktreesHome(mainRoot) {
  const m = normPath(mainRoot);
  return m ? `${path.posix.dirname(m)}/${path.posix.basename(m)}-worktrees` : null;
}

/**
 * Thư mục nên hỏi user có dọn không. dirs: thư mục con của worktreesHome (đường dẫn); listed: gốc worktree git biết.
 * Trả [{ path, why }].
 */
export function strayWorktrees({ dirs = [], listed = [], book, now = new Date() }) {
  const known = new Set(listed.map(wtKey));
  const out = [];
  for (const d of dirs) if (!known.has(wtKey(d))) out.push({ path: normPath(d), why: "không còn là worktree" });
  const claimed = new Set(Object.values(book.claims ?? {}).map((c) => wtKey(c.worktree)));
  for (const [key, o] of Object.entries(book.worktrees ?? {}))
    if (known.has(key) && isIdle(o, now) && !claimed.has(key))
      out.push({ path: o.path, why: `chat ${short(o.chat ?? o.session)} im ${Math.round(hoursSince(o.lastSeen, now))} giờ, không giữ việc` });
  return out;
}
