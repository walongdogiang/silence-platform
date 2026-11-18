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
- Method mới: `session.list_external` (session tạo từ Claude desktop/terminal), `lesson.add`, `verify.status`, `quota.status`, `repo_config.review`/`approve`.
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

Lõi đổi các sự kiện này thành `SessionEvent` hiện có cho client (`Token`, `Thinking`, `ToolStart`, `ToolEnd`, `Permission`, `Diff`, `Cost`, `Done`, `Error`), thêm `Quota`.

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

## Hàng đợi, song song, quota

- Mỗi lượt là một **job**: `interactive`, `background`, `scheduled`. Ưu tiên `interactive` > `scheduled` > `background`.
- Giới hạn chạy cùng lúc theo tài khoản backend, mặc định 1–2 cho Claude Pro (chỉnh trong Settings). Chat không bị xếp sau việc nền.
- **Cô lập:** mỗi session song song và mỗi job nền chạy trong một git worktree riêng. Job không người trông chạy trong container (giai đoạn 3).
- **Không người trông:** lệnh Risk Engine xếp `ask` thành `deny` với lý do "cần người duyệt, đã ghi lại"; UI liệt kê để duyệt và chạy lại.
- `quota{exhausted}`: dừng nhận job mới tới `resetsAt` (không có thì hỏi người dùng); job đang chạy bị cắt đánh dấu "dở".
- `rate_limited` có `retryAfterMs`: thử lại tối đa 3 lần, lùi dần.
- `quota{warning}`: không chạy job `background` mới; chat vẫn chạy.
- **Lịch:** lượt lỡ do máy ngủ chạy bù một lần khi thức dậy.
