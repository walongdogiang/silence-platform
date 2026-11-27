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
  merged: { required: ["pr"], optional: ["task", "files", "text", "sha"] },
  id_reserved: { required: ["task"], optional: [] },
  contract_changed: { required: ["areas", "text"], optional: ["task", "pr"] },
  blocked: { required: ["task", "text"], optional: ["to"] },
  note: { required: ["to", "text"], optional: ["task"] },
};

/**
 * Mã việc (T-039): cha `T-070` hoặc con `T-070.2` — đúng 2 cấp, số con từ 1, không đệm 0.
 * `TASK_ID` để tìm trong chuỗi (nhánh, tiêu đề): không nhận `T-070.0`, `T-070.01`, `T-070.1.1`; dấu chấm cuối câu không sao.
 * `TASK_ID_FULL` để kiểm cả chuỗi (đối số CLI, trường sự kiện).
 */
export const TASK_ID = /T-\d+(?:\.[1-9]\d*)?(?!\.?\d)/;
export const TASK_ID_FULL = /^T-\d+(?:\.[1-9]\d*)?$/;

/** Mã việc đầu tiên trong một chuỗi, không có → undefined. */
export function taskIdIn(text) {
  return String(text ?? "").match(TASK_ID)?.[0];
}

/** Mọi mã việc trong một chuỗi. */
export function taskIdsIn(text) {
  return [...String(text ?? "").matchAll(new RegExp(TASK_ID.source, "g"))].map((m) => m[0]);
}

export const isChildId = (id) => String(id ?? "").includes(".");
/** `T-070.2` → `T-070`; mã cha → chính nó. */
export const parentOf = (id) => String(id ?? "").split(".")[0];

const TASK = TASK_ID_FULL;
const TO = new RegExp(`^(${TASK_ID_FULL.source.slice(1, -1)}|all|master)$`);

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
  if (fields.sha != null) {
    if (!/^[0-9a-f]{7,40}$/.test(fields.sha)) return { ok: false, msg: `sha không hợp lệ: ${fields.sha}` };
    ev.sha = fields.sha;
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
 * Đường dẫn "hợp đồng chung": file nhiều việc cùng đọc. Merge đụng chúng → mọi phiên được báo "hợp đồng chung đổi",
 * không cần agent tự khai `contract_changed`.
 */
export const CONTRACT_PATHS = [
  "packages/protocol/",
  "crates/protocol/",
  "AGENTS.md",
  "CLAUDE.md",
  ".claude/skills/",
  ".claude/rules/",
  ".claude/settings.json",
  ".claude/git-policy.json",
  "scripts/",
  "package.json",
];

export function contractFiles(files) {
  return list(files).filter((f) => CONTRACT_PATHS.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p)));
}

/**
 * Sự kiện `merged` dựng từ commit mới trên origin/main — bắt cả merge không qua pr-merge.mjs (GitHub UI, gh pr merge).
 * commits: [{ sha, subject, files }] (cũ → mới). Bỏ commit đã có sự kiện cùng sha hoặc cùng số PR.
 * Commit không có "(#n)" trong tiêu đề (push thẳng) → bỏ qua: main-guard lo phần đó.
 */
export function mergeEventsFromCommits(commits, events, now = new Date()) {
  const seenPr = new Set(events.filter((e) => e.kind === "merged").map((e) => e.pr));
  const seenSha = new Set(events.filter((e) => e.sha).map((e) => e.sha));
  const out = [];
  for (const c of commits) {
    const pr = Number(c.subject.match(/\(#(\d+)\)\s*$/)?.[1]);
    if (!pr || seenPr.has(pr) || seenSha.has(c.sha)) continue;
    const r = makeEvent(
      { kind: "merged", session: null, pr, sha: c.sha, task: taskIdIn(c.subject), files: c.files, text: c.subject.slice(0, TEXT_MAX) },
      now,
    );
    if (r.ok) {
      out.push(r.event);
      seenPr.add(pr);
    }
  }
  return out;
}

/** Lấy mã T-xxx lớn nhất trong một chuỗi bất kỳ (README, tên nhánh, tiêu đề). */
export function maxTaskNum(...texts) {
  let max = 0;
  for (const t of texts) for (const m of String(t ?? "").matchAll(/T-(\d+)/g)) max = Math.max(max, Number(m[1]));
  return max;
}

/**
 * Mã việc kế tiếp không trùng: lớn hơn mọi mã đã thấy ở bộ đếm README (local và origin/main), tên nhánh remote đã fetch,
 * và mọi mã đã giữ chỗ trong sổ chung (`idHigh`).
 */
export function nextTaskId({ readmeLocal = "", readmeMain = "", refNames = "", idHigh = 0 }) {
  const COUNTER = /Mã tiếp theo:\s*T-(\d+)/;
  const counter = (md) => Number(String(md).match(COUNTER)?.[1] ?? 0);
  const ids = (md) => String(md).replace(COUNTER, "");
  const n = Math.max(counter(readmeLocal), counter(readmeMain), maxTaskNum(ids(readmeLocal), ids(readmeMain), refNames) + 1, idHigh + 1);
  return `T-${String(n).padStart(3, "0")}`;
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
  const mergedSeen = new Set();
  for (const ev of events) {
    if (since && ev.ts <= since) continue;
    if (!last || ev.ts > last) last = ev.ts;
    if (ev.kind === "merged") {
      // pr-merge.mjs và quét origin/main có thể cùng ghi một PR: chỉ xét lần đầu.
      if (mergedSeen.has(ev.pr)) continue;
      mergedSeen.add(ev.pr);
    }
    if (me.session && ev.session === me.session) continue;
    if (me.task && ev.task === me.task && ev.kind !== "note" && ev.kind !== "blocked") continue;
    // `--to T-070` tới cả phiên giữ việc con T-070.k (T-039).
    const toMe = ev.to && (ev.to === "all" || ev.to === me.task || (me.task && isChildId(me.task) && ev.to === parentOf(me.task)) || (ev.to === "master" && me.isMaster));
    let prio = 0;
    let why = "";
    if ((ev.kind === "note" || ev.kind === "blocked" || ev.kind === "handoff") && toMe) [prio, why] = [3, "gửi bạn"];
    else if (ev.kind === "merged" && me.areas?.length && (ev.files ?? []).some((f) => matchArea(f, me.areas))) [prio, why] = [2, "đụng vùng bạn sửa — cần rebase"];
    else if (ev.kind === "contract_changed") [prio, why] = [me.areas?.length && areasOverlap(ev.areas, me.areas) ? 2 : 1, "hợp đồng chung đổi"];
    else if (ev.kind === "merged" && contractFiles(ev.files).length) [prio, why] = [1, `hợp đồng chung đổi (${contractFiles(ev.files).slice(0, 3).join(", ")})`];
    else if (me.isMaster && ev.kind !== "note") [prio, why] = [1, ""];
    if (prio) items.push({ ev, why, prio });
    else others++;
  }
  items.sort((a, b) => b.prio - a.prio || (a.ev.ts < b.ev.ts ? -1 : 1));
  return { items, others, last };
}

const short = (id) => (id ? String(id).slice(0, 8) : "?");

export function formatEvent(ev) {
  const src = ev.session ? short(ev.session) : "từ origin/main";
  const who = ev.task ? `${ev.task} (${src})` : ev.session ? `phiên ${src}` : src;
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
