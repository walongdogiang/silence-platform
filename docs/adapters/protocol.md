---
description: Spec API của lõi TS (client ↔ core qua MessagePort/WebSocket) và interface Backend cho adapter — ToolCall, decide, sự kiện, vòng đời session, kiểm chứng, hàng đợi, quota.
type: spec
status: draft
---
# API lõi và interface Backend

Quyết định: [ADR 0004](../adr/0004-backend-adapters.md). Ánh xạ Claude và backend sau: [claude-sdk.md](claude-sdk.md). Chưa có code.

```
client (Studio main/renderer, PWA) ──API lõi──► packages/core ──interface Backend──► adapter ──► app của hãng
```

## Nguyên tắc

- **Lõi quyết định mọi tool call**; adapter không tự cho phép.
- Kiểu dữ liệu chỉ chứa khái niệm trung lập. Tên tool, format hook, kiểu message của hãng nằm trong adapter.
- Hình dạng đặt theo các khái niệm của ACP (session, prompt, cập nhật dạng stream, xin quyền, huỷ), để sau này thêm được adapter ACP mà không đổi lõi.
- `packages/core` không import Electron. Kiểu dùng chung nằm trong `packages/protocol`.

## API lõi (client ↔ core)

| Kênh | Dùng khi | Bảo vệ |
| --- | --- | --- |
| MessagePort | Studio trên cùng máy | Chỉ tiến trình Studio có cổng; không mở socket |
| WebSocket | Điện thoại (giai đoạn 4) | Chỉ nghe `127.0.0.1`; `tailscale serve` đưa ra mạng riêng; token; duyệt lệnh rủi ro cần xác nhận thêm |

- Request/response JSON-RPC 2.0 và notification `session.event`, giống RPC hiện tại của Studio. Giữ tên method hiện có (`session.create`, `session.prompt`, `session.abort`, `session.permission`, `diff.*`, `fs.*`, `terminal.*`…) khi ý nghĩa không đổi, để renderer ít phải sửa.
- Method mới: `session.close`; `session.list` trả `{ sessions, external }`, `external` là session tạo từ Claude desktop/terminal (bỏ qua `{ external: false }`); `metrics.summary {days?}` → `{ days, core, external, byDay, byProject, quota? }` (1.10, `packages/core/src/metrics/metrics.ts`: báo xong sai = lượt có kiểm chứng mà lần đầu fail; vòng sửa = lần kiểm chứng thứ 2 trở đi trong lượt; nhắc lại = tin user trùng tin trước; session ngoài chỉ có lượt, nhắc lại, token; transcript ngoài cache theo `lastModified`); `session.external {workspace?, limit?}` (bỏ session do 5ilence tạo và lần gọi bài học trong `~/.silence`) và `session.external_messages {backend_session_id}` → `{ lines: [{ role, text }] }`; `lesson.propose {workspace, text, user?, answer?, model?}` → `{ lesson_id, project, model, summary, edits: [{ file, kind, before, after, reason, isNew }], warnings }` và `lesson.apply {lesson_id, accept: [index…]}` → `{ written, lessonFile, commit, pushed, note? }` (1.9, `packages/core/src/lessons/lessons.ts`; chỉ sửa `profile.md`, `projects/<repo>/profile.md`, `projects/<repo>/verify.yaml`, `plugin/skills/<tên>/SKILL.md`, không bao giờ đụng luật quyền; một lần gọi Claude không tool qua `backends/claude/oneShot.ts`; file đã đổi từ lúc đề xuất thì từ chối; commit chỉ các file của bài học rồi `git push`); `profile.status {workspace?}` → hồ sơ, hồ sơ project, plugin (skill), cảnh báo (1.7; `session.create` trả kèm `personal` cùng hình dạng); `repo_config.review {workspace}` → `{ workspace, hash, items, approved }`, `repo_config.approve {workspace, hash}` (1.6, lỗi `-32010` khi cần duyệt); sau này: `lesson.add`, `verify.status`, `quota.status`.
- `session.create` của lõi nhận thêm `repo_config: "ignore"` (chạy không nạp cấu hình repo), `unattended` (không người trông: `ask` thành `deny`), `backend` (mặc định `claude`), `resume_backend_session` + `fork`. Đã có ở 1.5b: `session.create`/`prompt`/`abort`/`permission`/`close`/`list` (`packages/core/src/sessions/manager.ts`).
- Renderer gọi qua một client trừu tượng; client chọn kênh. Renderer không biết đang chạy trong Electron hay trên web.

## Interface `Backend` (lõi ↔ adapter, trong tiến trình)

```ts
interface Backend {
  readonly info: { id: string; version: string; capabilities: Capabilities };
  start(opts: StartOptions, hooks: { decide(call: ToolCall): Promise<Decision>; emit(ev: BackendEvent): void }): Promise<SessionHandle>;
}
interface SessionHandle {
  send(msg: UserMessage): Promise<void>;   // kết quả đến qua emit
  interrupt(): Promise<void>;
  setMode?(mode: Mode): Promise<void>;
  setModel?(model?: string, effort?: Effort): Promise<void>;
  close(): Promise<void>;
}
```

`StartOptions`: `sessionId` (của lõi), `cwd`, `model?`, `effort?`, `mode` (`agent`/`plan`/`ask`), `systemAppend?`, `plugins?` (đường dẫn plugin cá nhân), `resume?` = `{ backendSessionId, fork, atMessageId? }`, `limits?` = `{ maxTurns?, maxUsd? }`, `sandbox` = `{ required, writable: string[], network: string[] }`.

`sandbox.required` mà backend không bật được sandbox trên nền tảng này → lỗi `unsupported`. Lõi quyết chạy không sandbox (tương tác) hay từ chối (không người trông).

`Capabilities`: `interrupt`, `resume`, `fork`, `setMode`, `setModel`, `partialText`, `cost` (`exact`/`estimate`/`none`), `quotaEvents`, `decide` (`callback`/`mcpOnly`), `images`, `sandbox` (nền tảng backend tự sandbox được), `externalSessions` (liệt kê được session tạo ngoài 5ilence).

## `decide(ToolCall) → Decision`

Adapter gọi **trước khi** backend chạy tool và giữ tool call tới khi có kết quả. Lõi có thể trả chậm (đang hỏi người dùng).

| Trường `ToolCall` | Ý nghĩa |
| --- | --- |
| `callId` | id của backend (Claude: `tool_use_id`) |
| `kind` | `read` · `search` · `write` · `edit` · `shell` · `fetch` · `mcp` · `agent` · `plan` · `internal` · `other` |
| `name` | tên trung lập cho Risk Engine (`read`, `write`, `edit`, `shell`, `glob`, `grep`, `web_fetch`, `mcp__<server>__<tool>`…) |
| `args` | đối số chuẩn hoá (`path`, `content`, `old`/`new`, `command`, `url`…) |
| `raw` | `{ tool, input }` nguyên bản, để audit và `modify` |
| `mcp?` | `{ server, tool, readOnly }` |
| `parentCallId?` | nằm trong subagent nào |
| `cwd` | thư mục làm việc |

| `Decision.action` | Trường | Adapter làm gì |
| --- | --- | --- |
| `allow` | — | chạy với input gốc |
| `deny` | `reason` (gửi model), `interrupt?` | chặn; `interrupt` thì dừng cả lượt |
| `modify` | `input` | chạy với input mới |

Lõi tự hỏi người dùng khi Risk Engine xếp `ask`, rồi mới trả `allow`/`deny`. Adapter không bao giờ nhận `ask`.

Lỗi hoặc huỷ khi đang chờ `decide` → adapter coi là `deny` với lý do `harness unavailable`. Không bao giờ mặc định cho phép.

## Sự kiện adapter → lõi (`emit`)

| `type` | Trường | Ghi chú |
| --- | --- | --- |
| `ready` | `backendSessionId`, `model`, `tools[]`, `backendVersion`, `auth` = `{ source, account? }` | Lõi kiểm `auth.source`; sai nguồn thì đóng session |
| `text.delta` / `thinking.delta` | `text` | stream |
| `message` | `role`, `content`, `messageId` | ghi event log |
| `tool.start` | `callId`, `name`, `args` | sau khi đã `allow` |
| `tool.end` | `callId`, `ok`, `output` (đã cắt), `files?`, `untrusted` | `untrusted` = output từ nguồn ngoài (web, MCP chưa tin cậy) → lõi bật taint, Risk Engine siết lại |
| `usage` | `inputTokens`, `outputTokens`, `cacheRead`, `cacheWrite`, `usd`, `usdKind`, `model` | cộng dồn theo lượt |
| `quota` | `status` (`ok`/`warning`/`exhausted`), `resetsAt?`, `utilization?` | dừng việc nền |
| `compacted` | `trigger`, `preTokens` | |
| `subagent` | `callId`, `state`, `summary?` | |
| `turn.end` | `stop` (`completed`/`interrupted`/`max_turns`/`budget`/`quota`/`error`), `backendStop?`, `durationMs` | mỗi `send` kết thúc bằng đúng một `turn.end` |
| `error` | `code`, `message`, `retryable`, `retryAfterMs?` | |

Mã lỗi: `auth_required`, `quota_exhausted`, `rate_limited`, `overloaded`, `backend_crashed`, `backend_not_found`, `unsupported`, `internal`.

Lõi đổi các sự kiện này thành `SessionEvent` hiện có cho client (`Token`, `Thinking`, `ToolStart`, `ToolEnd`, `Permission`, `Diff`, `Cost`, `Done`, `Error`), thêm `Quota`. Tới khi `Quota` vào protocol, `quota`, `compacted`, `subagent`, `ready` đi qua `trace` (`event` = tên sự kiện).

## Vòng đời session

```
start ──ready──► idle ──send──► running ──turn.end──► idle ──close──► closed
                   ▲                │ interrupt ──► turn.end{interrupted}
                   └── resume / fork                │ quota ──► paused (lõi giữ việc)
```

- **Resume:** lõi lưu `sessionId ↔ backendSessionId` trong `events.jsonl`.
- **Fork:** `resume.fork`; backend không hỗ trợ → lõi phát lại lịch sử dạng chữ vào session mới.
- **Tiến trình của hãng chết:** session thành `error{backend_crashed}`; chỉ resume khi người dùng gửi tiếp; không tự chạy lại lượt dở.
- **Lõi tắt hay khởi động lại:** mọi `decide` đang chờ thành `deny`; session đang chạy kết thúc.

## Sau mỗi lượt: kiểm chứng

Sau `turn.end{completed}` có file đổi, lõi chạy lệnh trong `verify.yaml` (ưu tiên `~/.silence/projects/<repo>/verify.yaml`, sau đó `.silence/verify.yaml` trong repo) khớp phạm vi file đổi. Fail thì gửi lỗi đã cắt gọn bằng `send`, tối đa 2 lần, rồi báo người dùng. Adapter không cần biết bước này. "Báo xong sai" (agent nói xong, kiểm chứng fail) được ghi làm số liệu.

Đã làm ở 1.8 (`packages/core/src/verify/verify.ts`, `sessions/manager.ts::afterTurn`):

- **File:** `rules: [{ when: [glob…], run: "<lệnh>", timeout_s? }]` và `pairs: [[a, b]]` (cặp file hợp đồng phải đổi cùng nhau). File của user (`~/.silence/projects/<repo>/verify.yaml`) có thì dùng, không thì dùng của repo.
- **File đổi:** so cây snapshot đầu lượt với cây hiện tại (`git/snapshot.ts::changedSince`, index tạm, bắt cả file mới/xoá và file do shell sửa); không có git thì dùng đường dẫn agent đã write/edit. Không file nào đổi, hoặc không lệnh nào khớp: không chạy gì. Chế độ Ask: không kiểm chứng.
- **Chạy:** mỗi lệnh khớp một lần, theo thứ tự trong file. Lệnh có `;` được tách ở cấp ngoài cùng và chạy lần lượt, dừng ở phần đầu tiên hỏng (PowerShell 5.1 trả về trạng thái của phần cuối nên `a; b` sẽ che lỗi của `a`). Windows dùng PowerShell, nơi khác `sh`. Timeout mặc định 600 giây. Output giữ phần cuối 6000 ký tự, đã che secret.
- **Lệnh của repo (4d):** lệnh trong `.silence/verify.yaml` của repo đã duyệt và không đổi (`<dataDir>/verify-approvals.jsonl`, theo workspace + nội dung lệnh) thì chạy; lệnh mới hoặc đã đổi đi qua cùng luồng quyền (luật deny, chặn cứng, Bypass) và thẻ hỏi với `source: "verify"`. "Luôn cho phép" ở đây duyệt đúng lệnh đó, không lưu luật Bash (để agent không dùng lại được); không có "Từ chối, thêm luật". Không người trông: bỏ qua (`skipped`). File `verify.yaml` của user và file duyệt là mục tiêu `POLICY_TAMPER`.
- **Vòng sửa:** fail thì lõi gửi `[5ilence verify] …` kèm lệnh và output lỗi, tối đa `MAX_FIX_ROUNDS` = 2; mỗi vòng kết thúc thì kiểm lại. `done` chỉ gửi khi kiểm chứng xong.
- **Sự kiện** `session.event` `verify` (protocol 0.1.21): `{ ok, round, final, source, changed, checks: [{ command, ok, skipped?, exit_code?, ms, output }] }`. Ghi event log (`verify`) và audit (`verify`, `verify.approve`).

## Hàng đợi, song song, quota

- Mỗi lượt là một **job**: `interactive`, `background`, `scheduled`. Ưu tiên `interactive` > `scheduled` > `background`.
- Giới hạn chạy cùng lúc theo tài khoản backend, mặc định 1–2 cho Claude Pro (chỉnh trong Settings). Chat không bị xếp sau việc nền.
- **Cô lập:** mỗi session song song và mỗi job nền chạy trong một git worktree riêng. Job không người trông chạy trong container (giai đoạn 3).
- **Đã làm ở 1.11** (`packages/core/src/worktrees/worktrees.ts`, `sessions/manager.ts`): `session.create { worktree: "auto" | "on" | "off" }` (mặc định `auto`). `auto` tách khi đã có chat khác làm việc thẳng trong cùng checkout **và** chat đó đang chạy (`other_running`) hoặc checkout có thay đổi chưa commit (`dirty`); `on` luôn tách (`forced`); `off` không tách. Worktree nằm ở `%LOCALAPPDATA%/silence/worktrees/<project>/<YYYYMMDD-HHMM-xxxx>` (`SILENCE_WORKTREES` để đổi), nhánh `silence/<tên>` từ HEAD của checkout chính (không mang thay đổi chưa commit). Kết quả `session.create` có `worktree { path, branch, base, reason }`. `worktree.status` → `{ worktree, files: [{ path, added, removed, isNew? }], commits }`; `worktree.merge` commit phần còn lại trong worktree rồi `git merge --no-ff` vào nhánh base của checkout chính (đang ở nhánh khác thì từ chối; xung đột thì `merge --abort`, trả danh sách file); `worktree.discard` đóng session, xoá worktree và nhánh. Đóng chat không xoá worktree.
- **Giới hạn và hàng đợi (1.11):** `core.set_limit { max }` (1–4, mặc định 2, từ Settings → Chung). Lượt vượt giới hạn vào hàng đợi FIFO: `session.prompt` trả `{ queued: true }`, sự kiện `trace` `queued { position, limit }`, rồi `dequeued` khi bắt đầu. Huỷ lượt đang chờ thì kết thúc ngay bằng `done { stop: "interrupted" }`.
- **Không người trông:** lệnh Risk Engine xếp `ask` thành `deny` với lý do "cần người duyệt, đã ghi lại"; UI liệt kê để duyệt và chạy lại.
- `quota{exhausted}`: dừng nhận job mới tới `resetsAt` (không có thì hỏi người dùng); job đang chạy bị cắt đánh dấu "dở".
- `rate_limited` có `retryAfterMs`: thử lại tối đa 3 lần, lùi dần.
- `quota{warning}`: không chạy job `background` mới; chat vẫn chạy.
- **Lịch:** lượt lỡ do máy ngủ chạy bù một lần khi thức dậy.
