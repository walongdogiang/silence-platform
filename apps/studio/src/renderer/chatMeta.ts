/** Helpers meta lượt chat kiểu Cursor — narration, thought brief, checkpoint. */

import type { MsgKey, T } from "./i18n";

export type CheckpointFile = { path: string; before: string; after: string };

/** Khoảng dòng 1-based, `end = null` = tới hết file (chỉ có `offset`). */
export type LineRange = [start: number, end: number | null];

export type NarrateStep = {
  verb: string;
  detail?: string;
  /** Bước đọc file: đường dẫn đầy đủ để gộp các lần Read liên tiếp cùng file. */
  file?: string;
  /** Khoảng dòng đã đọc; bỏ trống khi có `file` = đọc cả file. */
  ranges?: LineRange[];
  /** Lệnh shell chạy trong sandbox (Tự chủ): hiện badge "sandbox". */
  sandboxed?: boolean;
  /** Lúc bước bắt đầu (ms) — bước đang chạy hiện thời gian đã chạy (RunIndicator, status.md). */
  at?: number;
};

const READ_RE = /read|outline|cat|open|fs\.read|list|tree/;
const READ_VERB = /^(Reading|Read)$/;

/** Dòng `narrate` đã lưu → bước, giữ `file`/`ranges` để gộp Read. */
export function narrateFromLine(l: {
  verb: string;
  detail?: string;
  file?: string;
  ranges?: LineRange[];
  sandboxed?: boolean;
  at?: number;
}): NarrateStep {
  const s: NarrateStep = { verb: l.verb, detail: l.detail };
  if (l.file) s.file = l.file;
  if (l.ranges) s.ranges = l.ranges;
  if (l.sandboxed) s.sandboxed = true;
  if (typeof l.at === "number") s.at = l.at;
  return s;
}

/** `read{path, offset?, limit?}` → khoảng dòng; không offset/limit = cả file (undefined). */
export function readRange(input: unknown): LineRange[] | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined);
  const offset = num(o.offset);
  const limit = num(o.limit);
  if (offset == null && limit == null) return undefined;
  const start = offset ?? 1;
  return [[start, limit != null ? start + limit - 1 : null]];
}

/** Hợp các khoảng: sắp xếp, nối khoảng chồng hoặc liền kề. `undefined` (cả file) thắng tất cả. */
export function mergeRanges(a: LineRange[] | undefined, b: LineRange[] | undefined): LineRange[] | undefined {
  if (!a || !b) return undefined;
  const all = [...a, ...b].sort((x, y) => x[0] - y[0]);
  const out: LineRange[] = [];
  for (const [s, e] of all) {
    const last = out[out.length - 1];
    if (last && (last[1] == null || s <= last[1] + 1)) {
      last[1] = last[1] == null || e == null ? null : Math.max(last[1], e);
    } else {
      out.push([s, e]);
    }
  }
  return out;
}

/** `1–40, 615–629, 990+`; quá 4 khoảng thì rút gọn `… +N`. */
export function formatRanges(ranges: LineRange[]): string {
  const parts = ranges.map(([s, e]) => (e == null ? `${s}+` : s === e ? `${s}` : `${s}–${e}`));
  return parts.length > 4 ? `${parts.slice(0, 4).join(", ")}, … +${parts.length - 4}` : parts.join(", ");
}

function readDetail(file: string, ranges: LineRange[] | undefined): string {
  const name = basenamePath(file);
  return ranges?.length ? `${name} (${formatRanges(ranges)})` : name;
}

/**
 * Gộp các bước Read liên tiếp cùng file thành một dòng (kiểu Claude Code):
 * `Read App.tsx (1–40, 615–629)`. Chỉ gộp khi liền nhau; bước khác file/khác loại cắt nhóm.
 * Bước live (Reading) gộp với Read trước đó và giữ động từ của bước sau cùng.
 */
export function mergeReadSteps(steps: NarrateStep[]): NarrateStep[] {
  const out: NarrateStep[] = [];
  for (const s of steps) {
    const prev = out[out.length - 1];
    if (prev?.file && s.file && prev.file === s.file && READ_VERB.test(prev.verb) && READ_VERB.test(s.verb)) {
      const ranges = mergeRanges(prev.ranges, s.ranges);
      out[out.length - 1] = { verb: s.verb, file: s.file, ranges, detail: readDetail(s.file, ranges) };
      if (typeof s.at === "number") out[out.length - 1].at = s.at;
    } else {
      out.push(s);
    }
  }
  return out;
}

export function basenamePath(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

function pickPath(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  for (const k of ["path", "file", "filepath", "target", "glob", "pattern"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  if (typeof o.query === "string" && o.query.trim()) return o.query.trim();
  return undefined;
}

function pickQuery(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  for (const k of ["pattern", "query", "regex", "needle"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickCommand(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  for (const k of ["command", "cmd", "script", "code"]) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function isTestCommand(cmd: string): boolean {
  return /\b(pytest|jest|vitest|mocha|phpunit|cargo\s+test|npm\s+test|npm\s+run\s+test|pnpm\s+test|yarn\s+test|go\s+test|dotnet\s+test|pytest)\b/i.test(
    cmd,
  ) || /\btest[s]?\b/i.test(cmd);
}

function mcpLabel(name: string): string {
  if (name.startsWith("mcp__")) {
    return name
      .slice(5)
      .split("__")
      .filter(Boolean)
      .join(" · ");
  }
  return name;
}

/** Placeholder idle — bị thay khi có tool; không tạo bản ghi past. */
export function isPlanningVerb(verb: string | undefined): boolean {
  return Boolean(verb && /^Planning\b/i.test(verb));
}

/** Bước live từ tool_start — động từ hiện tại (+ing). */
export function narrateToolLive(name: string, input: unknown): NarrateStep {
  const n = name.toLowerCase();
  const path = pickPath(input);
  const short = path ? basenamePath(path) : undefined;
  const query = pickQuery(input);
  const command = pickCommand(input);

  // Background processes (`proc_*`): checked first, `proc_list` would otherwise look like a read.
  if (n === "proc_start") return { verb: "Starting", detail: clip(command ?? "command", 48) };
  if (n === "proc_logs") return { verb: "Reading logs", detail: pickId(input) ?? "process" };
  if (n === "proc_stop") return { verb: "Stopping", detail: pickId(input) ?? "process" };
  if (n === "proc_list") return { verb: "Checking processes" };
  if (n === "http_check") return { verb: "Checking", detail: httpDetail(input) };
  if (n.startsWith("browser_")) return browserStep(n, input);
  if (/grep|search|rg|glob|find/.test(n)) {
    if (query && short) return { verb: "Searching", detail: `\`${clip(query, 40)}\` in ${short}` };
    if (query) return { verb: "Searching", detail: `\`${clip(query, 48)}\`` };
    return { verb: "Searching", detail: short ?? "codebase" };
  }
  if (READ_RE.test(n)) {
    if (!path) return { verb: "Reading", detail: "file" };
    const ranges = readRange(input);
    return { verb: "Reading", detail: readDetail(path, ranges), file: path, ...(ranges ? { ranges } : {}) };
  }
  if (/write|edit|apply|patch|str_replace|create/.test(n)) {
    return { verb: "Editing", detail: short ?? "file" };
  }
  if (/shell|bash|cmd|exec|terminal/.test(n)) {
    const cmd = command ?? short ?? "command";
    if (isTestCommand(cmd)) return { verb: "Testing", detail: clip(cmd, 48) };
    return { verb: "Running", detail: clip(cmd, 48) };
  }
  if (n === "submit_plan") return { verb: "Writing plan" };
  /* task = khảo sát/giao việc rộng — chưa đủ tín hiệu Delegating riêng */
  if (n === "task") return { verb: "Exploring", detail: "codebase" };
  /* MCP / tool lẻ → Using tool, không gọi Exploring */
  if (n.startsWith("mcp__") || /\bmcp\b/.test(n)) {
    return { verb: "Using tool", detail: mcpLabel(name) };
  }
  if (short) return { verb: "Using tool", detail: `${name} · ${short}` };
  return { verb: "Using tool", detail: name };
}

/**
 * Động từ quá khứ khi bước đã xong.
 * Planning không map past — caller phải drop.
 * Thought giữ nguyên (bản ghi informational).
 */
export function narrateToPast(step: NarrateStep): NarrateStep {
  if (isPlanningVerb(step.verb)) return step;
  if (/^Thought$/i.test(step.verb)) return { verb: "Thought", detail: step.detail };
  const map: Record<string, string> = {
    Reading: "Read",
    Searching: "Searched",
    Searched: "Searched",
    Grepped: "Searched",
    Editing: "Edited",
    Running: "Ran",
    Testing: "Tested",
    Exploring: "Explored",
    "Writing plan": "Wrote plan",
    Starting: "Started",
    "Reading logs": "Read logs",
    Stopping: "Stopped",
    "Checking processes": "Checked processes",
    Checking: "Checked",
    "Opening": "Opened",
    "Reading page": "Read page",
    "Clicking": "Clicked",
    "Typing": "Typed",
    "Selecting": "Selected",
    "Pressing": "Pressed",
    "Hovering": "Hovered",
    "Reading console": "Read console",
    "Reading network": "Read network",
    "Closing browser": "Closed browser",
    "Taking screenshot": "Took screenshot",
    "Writing test": "Wrote test",
    Blocked: "Blocked",
    "Using tool": "Used tool",
    Using: "Used tool",
    Used: "Used tool",
  };
  return { ...step, verb: map[step.verb] ?? step.verb };
}

export function planningStep(): NarrateStep {
  return { verb: "Planning next moves" };
}

/** Bản ghi informational — không phải cặp live/past đối xứng. */
export function thoughtStep(ms?: number): NarrateStep {
  if (ms != null && ms > 0) {
    const sec = Math.max(1, Math.round(ms / 1000));
    return { verb: "Thought", detail: `${sec}s` };
  }
  return { verb: "Thought", detail: "briefly" };
}

export function thinkingLiveStep(): NarrateStep {
  return { verb: "Thinking" };
}

/** Brief một dòng từ full thinking (không cắt mất ý đầu). */
export function briefFromThinkingBody(body: string): string {
  const line = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return "";
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Thought brief — câu trạng thái dưới Worked for (Cursor). */
export function briefFromNarrations(steps: NarrateStep[]): string {
  const labels = steps
    .filter((s) => !isPlanningVerb(s.verb) && !/^Thought$/i.test(s.verb))
    .map((s) => (s.detail ? `${s.verb} ${s.detail}` : s.verb));
  const uniq: string[] = [];
  for (const t of labels) {
    if (!t || uniq.includes(t)) continue;
    uniq.push(t);
    if (uniq.length >= 4) break;
  }
  return uniq.join(" · ");
}

/** Known step verbs (stored in English in chat history), shown in the UI language. */
const VERBS = new Set([
  "Reading", "Read", "Searching", "Searched", "Editing", "Edited", "Running", "Ran", "Testing", "Tested",
  "Exploring", "Explored", "Writing plan", "Wrote plan", "Using tool", "Used tool", "Blocked", "Thinking",
  "Thought", "Planning next moves", "Starting", "Started", "Reading logs", "Read logs", "Stopping", "Stopped",
  "Checking processes", "Checked processes", "Checking", "Checked",
  "Opening", "Opened", "Reading page", "Read page", "Clicking", "Clicked", "Typing", "Typed", "Selecting", "Selected", "Pressing", "Pressed", "Hovering", "Hovered", "Reading console", "Read console", "Reading network", "Read network", "Closing browser", "Closed browser", "Taking screenshot", "Took screenshot", "Writing test", "Wrote test",
]);

const BROWSER_ACT_VERB: Record<string, string> = {
  click: "Clicking",
  fill: "Typing",
  select: "Selecting",
  press: "Pressing",
  hover: "Hovering",
};

/** Steps of the headless browser (`browser_*`). Checked before READ_RE: `browser_open` has "open". */
function browserStep(n: string, input: unknown): NarrateStep {
  const i = (input ?? {}) as { url?: unknown; ref?: unknown; action?: unknown; value?: unknown };
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  if (n === "browser_open") return { verb: "Opening", detail: clip(str(i.url).replace(/^https?:\/\//, ""), 48) };
  if (n === "browser_snapshot") return { verb: "Reading page" };
  if (n === "browser_console") return { verb: "Reading console" };
  if (n === "browser_network") return { verb: "Reading network" };
  if (n === "browser_close") return { verb: "Closing browser" };
  if (n === "browser_export_test") return { verb: "Writing test", ...(str((input as { title?: unknown } | null)?.title) ? { detail: clip(str((input as { title?: unknown }).title), 48) } : {}) };
  if (n === "browser_screenshot") {
    const full = (input as { full_page?: unknown } | null)?.full_page === true;
    return { verb: "Taking screenshot", ...(str(i.ref) ? { detail: str(i.ref) } : full ? { detail: "full page" } : {}) };
  }
  const action = str(i.action).toLowerCase();
  const verb = BROWSER_ACT_VERB[action] ?? "Using tool";
  const value = str(i.value);
  const detail = action === "press" ? value : [str(i.ref), action === "fill" || action === "select" ? `"${value}"` : ""].filter(Boolean).join(" ");
  return { verb, detail: clip(detail || n, 48) };
}

/** `GET localhost:5173/api` for an `http_check` step. */
function httpDetail(input: unknown): string {
  const i = (input ?? {}) as { url?: unknown; method?: unknown };
  const method = typeof i.method === "string" && i.method ? i.method.toUpperCase() : "GET";
  const url = typeof i.url === "string" ? i.url.replace(/^https?:\/\//, "") : "";
  return clip(`${method} ${url}`.trim(), 48);
}

function pickId(input: unknown): string | undefined {
  const id = (input as { id?: unknown } | null | undefined)?.id;
  return typeof id === "string" && id ? id : undefined;
}

/** Step verb in the UI language; unknown verbs pass through. */
export function verbText(verb: string, t: T): string {
  return VERBS.has(verb) ? t(`verb.${verb}` as MsgKey) : verb;
}

/** Step detail in the UI language: only the fixed words this file writes (`file`, `in`…). */
export function detailText(detail: string, t: T): string {
  if (detail === "file" || detail === "codebase" || detail === "command") return t(`narr.${detail}`);
  const m = /^(`.*`) in (.+)$/.exec(detail);
  return m ? t("narr.in", { q: m[1], file: m[2] }) : detail;
}

/** `Read App.tsx (1–40)` in the UI language. */
export function stepText(step: NarrateStep, t: T): string {
  return step.detail ? `${verbText(step.verb, t)} ${detailText(step.detail, t)}` : verbText(step.verb, t);
}

export function formatNarrateLine(step: NarrateStep): string {
  return step.detail ? `${step.verb} ${step.detail}` : step.verb;
}

export function parseNarrateLegacy(text: string): NarrateStep {
  const t = text.trim();
  const m =
    /^(Reading|Read|Searched|Searching|Grepped|Editing|Edited|Running|Ran|Testing|Tested|Exploring|Explored|Thought|Planning next moves|Writing plan|Wrote plan|Using tool|Used tool|Using|Used)\s*(.*)$/i.exec(
      t,
    );
  if (m) {
    let verb = capitalizeVerb(m[1]);
    if (/^Grepped$/i.test(verb)) verb = "Searched";
    if (/^Using$/i.test(verb)) verb = "Using tool";
    if (/^Used$/i.test(verb)) verb = "Used tool";
    return { verb, detail: m[2] || undefined };
  }
  return { verb: t };
}

function capitalizeVerb(v: string): string {
  if (/^planning next moves$/i.test(v)) return "Planning next moves";
  if (/^writing plan$/i.test(v)) return "Writing plan";
  if (/^wrote plan$/i.test(v)) return "Wrote plan";
  if (/^using tool$/i.test(v)) return "Using tool";
  if (/^used tool$/i.test(v)) return "Used tool";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

export function countExplored(steps: NarrateStep[]): { files: number; searches: number } {
  let files = 0;
  let searches = 0;
  for (const s of steps) {
    const v = s.verb.toLowerCase();
    if (/search|grep/.test(v)) searches += 1;
    else if (/read|edit|wrote|writing|test/.test(v)) files += 1;
    else if (/explor/.test(v)) files += 1;
  }
  return { files, searches };
}

export function newCheckpointId(): string {
  return `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Khôi phục file: áp before của mọi checkpoint sau điểm chọn (ngược thời gian). */
export function filesToRestore(
  checkpoints: { id: string; files: CheckpointFile[] }[],
  targetId: string,
): CheckpointFile[] {
  const idx = checkpoints.findIndex((c) => c.id === targetId);
  if (idx < 0) return [];
  const later = checkpoints.slice(idx + 1);
  const byPath = new Map<string, CheckpointFile>();
  for (let i = later.length - 1; i >= 0; i--) {
    for (const f of later[i].files) {
      if (!byPath.has(f.path)) byPath.set(f.path, f);
    }
  }
  return [...byPath.values()];
}
