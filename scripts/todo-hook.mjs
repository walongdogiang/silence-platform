#!/usr/bin/env node
// Hook Claude Code cho chủ worktree (T-020, ADR 0006). Đọc JSON hook ở stdin.
//   node scripts/todo-hook.mjs pre      PreToolUse  Bash|PowerShell: lệnh git đổi trạng thái trong worktree của chat khác → deny/ask
//   node scripts/todo-hook.mjs post     PostToolUse Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit: ghi chủ worktree
//   node scripts/todo-hook.mjs stop     Stop: chat đang chờ user
//   node scripts/todo-hook.mjs notify   Notification permission_prompt|idle_prompt: chat đang chờ user
// Mọi lỗi → exit 0, không in gì: hook không được làm hỏng phiên (docs: lỗi hook không chặn công cụ).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load, save, touchSession, readHookInput, recordEvent } from "./todo-claims.mjs";
import { ensureChat, touchChat, parseGitCommand, toplevelOf, mainRootOf, branchOf, findGit, guardGit, setOwner, wtKey, normPath } from "./todo-owner.mjs";

const SHELLS = new Set(["Bash", "PowerShell"]);
const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

const realDeps = { toplevelOf, mainRootOf, branchOf };

/** Lệnh git đổi trạng thái → [{ op, wt }] với wt là gốc worktree (null nếu là thư mục chính / không phải git). */
export function gitTargets(command, cwd, deps = realDeps) {
  const ops = parseGitCommand(command, cwd);
  if (!ops.length) return [];
  const main = wtKey(deps.mainRootOf(cwd));
  return ops.map(({ op, dir }) => {
    const wt = op.startsWith("worktree ") ? normPath(dir) : deps.toplevelOf(dir);
    return { op, wt: wt && wtKey(wt) !== main ? wt : null };
  });
}

/**
 * Xử lý một sự kiện hook trên sổ (thuần, trừ deps). Trả { output?: object, events: [] }.
 * output là JSON in ra stdout (chỉ khi deny/ask).
 */
export function handle(kind, input, book, deps = realDeps, now = new Date()) {
  const session = input.session_id;
  const events = [];
  if (!session) return { events };
  touchSession(book, { session, transcript: input.transcript_path, cwd: input.cwd }, now);
  ensureChat(book, { session, transcript: input.transcript_path, source: input.source });
  const tool = input.tool_name;
  if (kind === "stop" || kind === "notify") {
    touchChat(book, session, "waiting", now);
    return { events };
  }
  touchChat(book, session, "running", now);
  if (kind === "pre" && SHELLS.has(tool)) {
    const targets = gitTargets(input.tool_input?.command, input.cwd, deps);
    const r = guardGit(book, { session, targets }, now);
    if (r.decision !== "allow")
      return {
        events,
        output: { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: r.decision, permissionDecisionReason: r.reason } },
      };
    return { events };
  }
  if (kind === "post" && SHELLS.has(tool)) {
    // Lệnh đã chạy = đã được phép (deny không bao giờ chạy; ask đã được user cho phép) → ghi/chuyển chủ.
    for (const { op, wt } of gitTargets(input.tool_input?.command, input.cwd, deps)) {
      if (!wt) continue;
      if (op === "worktree remove") {
        delete book.worktrees?.[wtKey(wt)];
        continue;
      }
      const r = setOwner(book, { session, wt, branch: deps.branchOf(wt), transfer: true }, now);
      if (!r.from) continue;
      // Việc đang giữ ở worktree đó đã đi theo (setOwner); ghi sổ sự kiện cho việc đó. Chat cũ được báo qua `moved`.
      for (const [task, c] of Object.entries(book.claims ?? {}))
        if (c.session === session && wtKey(c.worktree) === wtKey(wt)) events.push({ kind: "handoff", session, task });
    }
    return { events };
  }
  if (kind === "post" && EDITS.has(tool)) {
    const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    if (!file) return { events };
    const wt = deps.toplevelOf(path.dirname(file));
    if (wt && wtKey(wt) !== wtKey(deps.mainRootOf(wt))) setOwner(book, { session, wt }, now); // không cướp chủ: phần cảnh báo sửa trùng là việc sau
  }
  return { events };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const kind = process.argv[2];
    const input = readHookInput();
    // Sổ ở git common dir của repo chứa script này; tìm qua đĩa, không chạy git (nhanh).
    const g = findGit(path.dirname(fileURLToPath(import.meta.url)));
    const file = g ? path.join(g.commonDir, "todo-claims.json") : null;
    if (file && input.session_id) {
      const book = load(file);
      const { output, events } = handle(kind, input, book);
      save(file, book);
      for (const e of events) recordEvent(e, file);
      if (output) process.stdout.write(JSON.stringify(output));
    }
  } catch {
    // im lặng: không làm hỏng phiên
  }
  process.exitCode = 0;
}
