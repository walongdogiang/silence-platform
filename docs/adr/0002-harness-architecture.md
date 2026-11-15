---
description: Kiến trúc đích của harness trong Engine — event log làm nguồn sự thật, kernel nhỏ, 13 thành phần, layout module, store task/decisions, lộ trình tách.
type: adr
status: draft
code:
  - crates/runtime/src/agent/mod.rs
  - crates/runtime/src/rpc.rs
  - crates/runtime/src/audit.rs
  - crates/runtime/src/org.rs
  - crates/tools/src/lib.rs
  - crates/protocol/src/lib.rs
---
# ADR 0002 — Kiến trúc harness: event log, kernel nhỏ, tool registry

**Status:** Proposed
**Date:** 2026-11-09
**Liên quan:** [ADR 0001](0001-architecture.md) (Engine sở hữu harness), [threat-model.md](../threat-model.md).

## Context

"Harness" = mọi thứ quanh model trong Engine: vòng agent, context, tool, quyền, diff, sandbox, hook, lưu trữ, đo lường. Engine đã chạy được 6 mode, diff chờ duyệt, permission `ask`, router Auto, MCP, sub-agent, audit, eval. Điểm nghẽn hiện tại:

- `agent.rs` gộp vòng lặp, dispatch tool, quyền, diff, plan, sub-agent — khó sửa một phần mà không đụng phần khác.
- Session chỉ ở RAM (`AppCtx.sessions`); Engine tắt là mất. Lịch sử chat nằm ở `localStorage` của Studio.
- Tool là một `match` trong `dispatch_tool`; MCP và sub-agent đi đường riêng.
- Dừng vòng bằng hằng `loops > 24`; không có ngân sách token / USD / thời gian.
- Hook chỉ `beforeShell`, `afterFileEdit`, không chặn được.
- Chưa có tầng project / task / decisions để agent nhớ bối cảnh công việc.

## Decision

### Nguyên tắc

1. **Event log là nguồn sự thật.** Mỗi session một file `events.jsonl` append-only, có `schema_version`. UI, resume, audit, cost, replay eval đều đọc từ log. `messages` gửi model là view dựng lại từ log.
2. **Kernel nhỏ.** Vòng lặp chỉ biết: dựng context → gọi model → với mỗi tool call hỏi Policy → chạy Tool → ghi Event → kiểm Budget. Không biết tool hay mode cụ thể.
3. **Một cửa cho tác dụng phụ.** Policy (mode + risk + allowlist + hook PreToolUse) → Sandbox → Change manager (stage diff, checkpoint) → Event/Audit.
4. **Context là pipeline có ngân sách.** Mỗi nguồn (system, mode, AGENTS.md, skills, memory, task, ui_context, history) có thứ tự ưu tiên và hạn mức token.
5. **Đo được.** Đổi harness kèm eval (AGENTS.md); session thật replay được thành eval.

### Thành phần

| # | Thành phần | Trách nhiệm | Hiện có | Cần làm |
| --- | --- | --- | --- | --- |
| 1 | API | JSON-RPC, stream event | `rpc.rs::handle` | `session.list/resume/fork`, `task.*` |
| 2 | Session manager | tạo, resume, fork, abort | `agent.rs::create_session` (RAM) | nạp và ghi `events.jsonl` |
| 3 | Agent kernel | vòng turn, stop condition, retry, budget | `agent.rs::run_turn` | tách module; `Budget` theo mode |
| 4 | Context engine | ghép prompt theo lớp, compact, memory | `SYSTEM`, `with_mode_system`, `compact.rs`, `org.rs` | `ContextBuilder` có hạn mức; nạp task/decisions |
| 5 | Gateway + Router | gọi model, stream, cost, chọn tier | `gateway.rs`, `crates/router` | fallback model khi provider lỗi |
| 6 | Tool registry | trait `Tool { spec, risk, run }` cho builtin, MCP, sub-agent; validate args; cắt output | `dispatch_tool`, `crates/tools` | trait + registry, lọc theo mode |
| 7 | Policy | allow / ask / deny | `ask_perm`, `decide_permission`, `permissions.rs` | một hàm `policy::check` |
| 8 | Change manager | diff chờ duyệt, checkpoint mỗi turn, undo | `stage_file_tool`, `apply_diff` | checkpoint + `session.undo` |
| 9 | Sandbox | jail workspace, Job Object, timeout | `crates/sandbox`, `Workspace` | giới hạn output / RAM |
| 10 | Hooks / Skills / Subagents | lifecycle, skill, subagent khai báo bằng file | `org.rs` (2 hook), `run_subagent` (3 loại cứng) | SessionStart, UserPrompt, PreToolUse (chặn/sửa), PostToolUse, Stop; `.silence/agents/` |
| 11 | Store | sessions, project / task / decisions, memory | `audit.jsonl`, `permissions.json` | xem mục Store |
| 12 | Telemetry / Audit | cost, latency, trace, redact | `audit.rs`, `redact.rs` | audit là view của event log |
| 13 | Evals | task + grader, chạy đêm | `eval_runner.rs`, `evals/v0` | replay từ log, grader theo tool call |

### Layout module đích

```
crates/runtime/src/
  rpc.rs, main.rs
  session/   mod.rs (manager), log.rs (events.jsonl), resume.rs
  kernel/    turn.rs, budget.rs, modes.rs
  context/   builder.rs, compact.rs, system.rs, memory.rs
  tools/     registry.rs, builtin.rs, mcp_adapter.rs, subagent.rs
  changes/   stage.rs, checkpoint.rs
  policy.rs, permissions.rs, hooks.rs, org.rs
  gateway.rs, provider_error.rs, audit.rs, redact.rs
crates/store/   (silence-store) project / task / decisions + SQLite index
```

`crates/{tools,mcp,router,sandbox,protocol}` giữ nguyên vai trò.

### Event log

Mỗi dòng: `{ "v": 1, "seq", "ts" (RFC3339 UTC, ms), "session_id", "turn", "type", ...payload }`. Kiểu tối thiểu:

| `type` | Payload chính |
| --- | --- |
| `session.start` | workspace, mode, model, `task_id?`, `parent_session?` (fork / sub-agent) |
| `user.message` | text (đã redact), attachments |
| `model.call` | model_id, tier, lý do route, prompt/completion tokens, USD, latency |
| `assistant.message` | text, thought, tool_calls |
| `tool.call` / `tool.result` | name, args, status, output (đã cắt), duration |
| `policy.decision` | tool, allow / ask / deny, nguồn (mode, allowlist, hook, user) |
| `file.read` / `file.write` | path tương đối, khoảng dòng, before/after hash, provider |
| `diff.staged` / `diff.applied` / `diff.rejected` | path, hash |
| `checkpoint` | turn, ref |
| `turn.end` | stop: done / abort / budget / error |

`file.read` / `file.write` thay cho `read.json` / `write.json` trong bản nháp `harness/`. Một session một writer (Engine); dòng cuối hỏng do crash thì bỏ qua khi đọc.

### Hook

Hook là lệnh khai báo trong `.silence/hooks/*.json` với `event` và `command`; Engine gửi JSON qua stdin, đọc JSON từ stdout, có timeout (sandbox).

| Event | Chặn được | Kết quả hook |
| --- | --- | --- |
| `SessionStart`, `UserPrompt` | không / có | thêm context |
| `PreToolUse` | có | `allow` / `deny` + lý do / `modify` args |
| `PostToolUse` | không | thêm ghi chú cho model |
| `Stop` | có | yêu cầu chạy tiếp (ví dụ test chưa xanh) |

Hook lỗi hoặc quá thời gian → coi như không có ý kiến, ghi event; không bao giờ tự `allow` thay cho bước hỏi user.

### Store

```
%LOCALAPPDATA%\5ilence\              data_dir (main.rs), không commit
  silence.db                          index projects / sprints / tasks / sessions — dựng lại được từ file
  sessions\<session_id>\events.jsonl, attachments\
  hosts\<host_id>.json                không chứa secret, chỉ credential_ref
<project_root>\.silence\              đi theo git của project
  AGENTS.md, skills\, hooks\, agents\
  project.json                        run profile, chính sách worktree (cảnh báo khi ghi main)
  sprints\<sprint_id>.md              frontmatter: name, status, start, end
  tasks\<task_id>\task.md             frontmatter: status (enum), sprint, parent, created_at (RFC3339)
  tasks\<task_id>\decisions\{biz,db,ui}.md
  memory.md
```

Session gắn `task_id` → context engine nạp `task.md` + `decisions/`. ID dùng UUIDv7; không chia thư mục theo ngày (UUIDv7 đã chứa thời gian). Path trong event lưu tương đối `root_path`. Thư mục nháp `harness/` ở gốc repo được thay bằng layout này.

Ràng buộc an toàn (xem [threat-model.md](../threat-model.md)):

- `project.json`, `hosts\*.json` không chứa mật khẩu / key; chỉ `credential_ref` tới Windows Credential Manager.
- Run profile chỉ bind `127.0.0.1`; mở ra LAN / public là quyết định riêng, không nằm trong ADR này.
- `memory.md`, `decisions/` là input không tin cậy như file khác trong workspace — không được nới quyền.

## Lộ trình

Mỗi bước một PR, không đổi hành vi ngoài phạm vi bước, eval không tụt so với baseline.

1. Tách `agent.rs` theo layout trên — chỉ di chuyển code. **Xong** (`agent/` có 7 module).
2. Event log + `session.list/resume`; schema event ở cả `crates/protocol` và `packages/protocol`; Studio đọc lịch sử từ Engine. **Engine + protocol xong** (`session/log.rs`, `agent/resume.rs`); còn lại: Studio chuyển từ `localStorage` sang `session.list/resume`, và `diff` chưa được ghi vào log (chờ checkpoint ở bước 5).
3. Tool registry + `policy::check` + hook PreToolUse chặn được; MCP, sub-agent đi qua registry.
4. Budget theo mode thay hằng 24; `Done { stop: "budget" }`.
5. Checkpoint / undo mỗi turn.
6. `silence-store` + `task.*` RPC + nạp vào context; UI danh sách task.
7. Eval replay từ `events.jsonl`.

Bước 1–3 nên chèn sau Phase 1 (Trusted edit loop) của roadmap.

## Consequences

- Resume, audit, cost và eval dùng chung một nguồn dữ liệu; bỏ ghi hai nơi.
- Thêm tool / hook / subagent không phải sửa kernel.
- Tốn thêm I/O ghi log mỗi event; chấp nhận (append, không fsync mỗi dòng).
- Đổi schema event phải tăng `schema_version` và giữ đọc được bản cũ.

## Alternatives rejected

- **SQLite làm nguồn sự thật cho session:** khó diff, khó đọc tay, khó replay; giữ SQLite làm index.
- **Lưu task / decisions chỉ trong data_dir:** mất khi đổi máy, không đi theo git của project.
- **Tách kernel thành process riêng:** chưa cần; Engine đã tách khỏi UI (ADR 0001).
