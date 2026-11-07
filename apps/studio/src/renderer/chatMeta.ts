/** Helpers meta lượt chat kiểu Cursor — narration, thought brief, checkpoint. */

export type CheckpointFile = { path: string; before: string; after: string };

export type NarrateStep = {
  verb: string;
  detail?: string;
};

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

  if (/grep|search|rg|glob|find/.test(n)) {
    if (query && short) return { verb: "Searching", detail: `\`${clip(query, 40)}\` in ${short}` };
    if (query) return { verb: "Searching", detail: `\`${clip(query, 48)}\`` };
    return { verb: "Searching", detail: short ?? "codebase" };
  }
  if (/read|cat|open|fs\.read|list|tree/.test(n)) {
    return { verb: "Reading", detail: short ?? "file" };
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
    "Using tool": "Used tool",
    Using: "Used tool",
    Used: "Used tool",
  };
  return { verb: map[step.verb] ?? step.verb, detail: step.detail };
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
