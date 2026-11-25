// Sổ sự kiện chung giữa các phiên (T-022, ADR 0006): ai vừa làm gì có ảnh hưởng tới phiên khác.
// File `todo-events.jsonl` nằm cạnh `todo-claims.json` trong thư mục git chung: mọi worktree thấy cùng một sổ, không commit.
// Chỉ ghi qua `makeEvent` (kiểm schema) + `appendEvent`; không ai sửa file bằng tay.
// Ghi gì / không ghi gì: ADR 0006. Tiến độ từng bước, diff, nội dung chat KHÔNG vào đây.
import { appendFileSync, existsSync, readFileSync, writeFileSync, renameSync, statSync } from "node:fs";
import path from "node:path";

export const EVENT_VERSION = 1;
export const TEXT_MAX = 200;
/** Quá số dòng này thì gọn lại còn KEEP_LINES dòng mới nhất. */
export const MAX_LINES = 5000;
export const KEEP_LINES = 2000;
/** Phiên chưa có con trỏ: xem sự kiện trong chừng này giờ. */
export const FIRST_LOOK_HOURS = 24;
/** Số dòng sự kiện tối đa hook in ra mỗi lượt. */
export const PUSH_LIMIT = 3;

/** Trường bắt buộc / được phép theo kind. */
export const KINDS = {
  claim: { required: ["task"], optional: ["areas"] },
  release: { required: ["task"], optional: [] },
  handoff: { required: ["task"], optional: ["to"] },
  pr_opened: { required: ["pr"], optional: ["task", "areas", "text"] },
  ci_red: { required: ["pr"], optional: ["task", "text"] },
  merged: { required: ["pr"], optional: ["task", "files", "text"] },
  contract_changed: { required: ["areas", "text"], optional: ["task", "pr"] },
  blocked: { required: ["task", "text"], optional: ["to"] },
  note: { required: ["to", "text"], optional: ["task"] },
};

const TASK = /^T-\d+$/;
const TO = /^(T-\d+|all|master)$/;

export function eventsPathFor(claimsFile) {
  return claimsFile ? path.join(path.dirname(claimsFile), "todo-events.jsonl") : null;
}

/** Tách "a,b" hoặc mảng thành danh sách chuỗi đã gọn, dùng `/`. */
export function list(v) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : String(v).split(",");
  return arr.map((s) => String(s).trim().replaceAll("\\", "/")).filter(Boolean);
}

/**
 * Dựng một sự kiện đã kiểm. Trả { ok: true, event } hoặc { ok: false, msg }.
 * input: { kind, session, task?, pr?, areas?, files?, to?, text? } — trường khác → từ chối.
 */
export function makeEvent(input, now = new Date()) {
  const { kind, session = null, ...rest } = input ?? {};
  const spec = KINDS[kind];
  if (!spec) return { ok: false, msg: `kind không hợp lệ: ${kind ?? "(trống)"}. Có: ${Object.keys(KINDS).join(", ")}` };
  const allowed = new Set([...spec.required, ...spec.optional]);
  const fields = Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length) && v !== ""));
  for (const k of Object.keys(fields)) if (!allowed.has(k)) return { ok: false, msg: `${kind} không nhận trường ${k}.` };
  for (const k of spec.required) if (fields[k] == null) return { ok: false, msg: `${kind} cần trường ${k}.` };
  const ev = { v: EVENT_VERSION, ts: now.toISOString(), kind, session };
  if (fields.task != null) {
    if (!TASK.test(fields.task)) return { ok: false, msg: `Mã việc không hợp lệ: ${fields.task}` };
    ev.task = fields.task;
  }
  if (fields.pr != null) {
    const n = Number(String(fields.pr).replace(/^#/, ""));
    if (!Number.isInteger(n) || n <= 0) return { ok: false, msg: `Số PR không hợp lệ: ${fields.pr}` };
    ev.pr = n;
  }
  if (fields.to != null) {
    if (!TO.test(fields.to)) return { ok: false, msg: `--to phải là T-xxx, all hoặc master (nhận: ${fields.to})` };
    ev.to = fields.to;
  }
  for (const k of ["areas", "files"]) {
    if (fields[k] == null) continue;
    const l = list(fields[k]);
    if (l.some((p) => p.startsWith("/") || /^[a-z]:/i.test(p) || p.split("/").includes("..")))
      return { ok: false, msg: `${k} phải là đường dẫn tương đối trong repo.` };
    ev[k] = k === "files" ? l.slice(0, 100) : l;
  }
  if (fields.text != null) {
    const t = String(fields.text).replace(/\s+/g, " ").trim();
    if (t.length > TEXT_MAX) return { ok: false, msg: `text dài ${t.length} ký tự (tối đa ${TEXT_MAX}). Chi tiết để trong file task.` };
    ev.text = t;
  }
  return { ok: true, event: ev };
}

export function appendEvent(file, event) {
  if (!file) return;
  appendFileSync(file, `${JSON.stringify(event)}\n`);
  try {
    if (statSync(file).size > MAX_LINES * 200) compact(file);
  } catch {
    // gọn sổ không được làm hỏng lệnh chính
  }
}

function compact(file) {
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  if (lines.length <= MAX_LINES) return;
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${lines.slice(-KEEP_LINES).join("\n")}\n`);
  renameSync(tmp, file);
}

export function readEvents(file) {
  if (!file || !existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && KINDS[e.kind] && e.ts) out.push(e);
    } catch {
      // dòng hỏng: bỏ qua
    }
  }
  return out;
}

/** Phần tĩnh (trước ký tự đại diện đầu tiên) của một glob, bỏ `/` cuối. */
export function staticPrefix(glob) {
  const i = glob.search(/[*?[{]/);
  return (i < 0 ? glob : glob.slice(0, i)).replace(/\/+$/, "");
}

const under = (a, b) => a === b || b === "" || a.startsWith(`${b}/`) || (b.endsWith("/") && a.startsWith(b));

/** Hai vùng có thể chồng nhau không (xấp xỉ theo tiền tố tĩnh — chỉ dùng để cảnh báo). */
export function areasOverlap(a, b) {
  for (const x of list(a))
    for (const y of list(b)) {
      const px = staticPrefix(x);
      const py = staticPrefix(y);
      if (under(px, py) || under(py, px)) return true;
    }
  return false;
}

/** Đường dẫn file có thuộc một trong các vùng không. Không có ký tự đại diện = thư mục hoặc file đó. */
export function matchArea(file, areas) {
  const f = file.replaceAll("\\", "/");
  return list(areas).some((g) => {
    if (!/[*?]/.test(g)) return under(f, g.replace(/\/+$/, ""));
    const re = new RegExp(
      `^${g
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*\/?/g, "\u0000")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(/\u0000/g, ".*")}$`,
    );
    return re.test(f);
  });
}

/**
 * Sự kiện mới đáng báo cho một phiên, xếp theo độ ưu tiên.
 * me: { session, task?, areas?, isMaster? }. since: ISO (loại sự kiện có ts <= since).
 * Trả { items: [{ ev, why }], others: số sự kiện mới khác (không báo chi tiết), last: ts mới nhất đã xét }.
 */
export function relevantFor(events, me, since) {
  const items = [];
  let others = 0;
  let last = since ?? null;
  for (const ev of events) {
    if (since && ev.ts <= since) continue;
    if (!last || ev.ts > last) last = ev.ts;
    if (me.session && ev.session === me.session) continue;
    if (me.task && ev.task === me.task && ev.kind !== "note" && ev.kind !== "blocked") continue;
    const toMe = ev.to && (ev.to === "all" || ev.to === me.task || (ev.to === "master" && me.isMaster));
    let prio = 0;
    let why = "";
    if ((ev.kind === "note" || ev.kind === "blocked" || ev.kind === "handoff") && toMe) [prio, why] = [3, "gửi bạn"];
    else if (ev.kind === "merged" && me.areas?.length && (ev.files ?? []).some((f) => matchArea(f, me.areas))) [prio, why] = [2, "đụng vùng bạn sửa — cần rebase"];
    else if (ev.kind === "contract_changed") [prio, why] = [me.areas?.length && areasOverlap(ev.areas, me.areas) ? 2 : 1, "hợp đồng chung đổi"];
    else if (me.isMaster && ev.kind !== "note") [prio, why] = [1, ""];
    if (prio) items.push({ ev, why, prio });
    else others++;
  }
  items.sort((a, b) => b.prio - a.prio || (a.ev.ts < b.ev.ts ? -1 : 1));
  return { items, others, last };
}

const short = (id) => (id ? String(id).slice(0, 8) : "?");

export function formatEvent(ev) {
  const who = ev.task ? `${ev.task} (${short(ev.session)})` : `phiên ${short(ev.session)}`;
  const parts = [`${ev.ts.slice(0, 16).replace("T", " ")} ${ev.kind}`, who];
  if (ev.pr) parts.push(`PR #${ev.pr}`);
  if (ev.to) parts.push(`→ ${ev.to}`);
  if (ev.areas?.length) parts.push(`vùng ${ev.areas.join(", ")}`);
  if (ev.files?.length) parts.push(`${ev.files.length} file`);
  if (ev.text) parts.push(`"${ev.text}"`);
  return parts.join(" · ");
}

/** Các dòng hook in ra (≤ PUSH_LIMIT + 1 dòng đếm). */
export function pushLines({ items, others }, prefix = "[todo]") {
  const out = items.slice(0, PUSH_LIMIT).map(({ ev, why }) => `${prefix} ${why ? `${why}: ` : ""}${formatEvent(ev)}`);
  const rest = items.length - Math.min(items.length, PUSH_LIMIT) + others;
  if (out.length && rest) out.push(`${prefix} +${rest} sự kiện khác: node scripts/todo-claims.mjs feed`);
  return out;
}

/** Con trỏ ban đầu cho phiên chưa từng đọc: FIRST_LOOK_HOURS trước. */
export function firstLook(now = new Date()) {
  return new Date(now.getTime() - FIRST_LOOK_HOURS * 36e5).toISOString();
}
