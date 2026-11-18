---
description: Adapter Claude trong lõi TS ánh xạ interface Backend sang Agent SDK (query, PreToolUse, canUseTool, settingSources, plugins), test cần xác minh, và ánh xạ backend sau.
type: spec
status: draft
---
# Adapter Claude và các backend sau

Interface `Backend`: [protocol.md](protocol.md). Quyết định: [ADR 0004](../adr/0004-backend-adapters.md).

Nguồn: tài liệu Agent SDK TypeScript tại `code.claude.com/docs/en/agent-sdk/` (overview, permissions, hooks, typescript, sessions, cost-tracking), đọc ngày 2026-11-18. Ô ghi **[chưa xác minh]** là chưa thấy trong tài liệu hoặc cần test thật trên Windows.

## Tiến trình

- Adapter là module trong `packages/core` (ví dụ `core/src/backends/claude/`), phụ thuộc `@anthropic-ai/claude-agent-sdk` khoá phiên bản. Không có sidecar riêng: lõi gọi SDK trực tiếp, mỗi `query()` tự sinh một tiến trình Claude Code.
- SDK kèm binary Claude Code dạng optional dependency theo nền tảng; `pathToClaudeCodeExecutable` chỉ dùng khi thiếu binary. Binary này **đi sau** bản CLI mới nhất cho tới khi nâng SDK: đặt lịch nâng định kỳ.
- Lõi chạy bằng Node của Electron (`ELECTRON_RUN_AS_NODE`) hoặc `node` độc lập. SDK cần Node ≥ 18.14. **[chưa xác minh]** SDK chạy ổn dưới `ELECTRON_RUN_AS_NODE` trên Windows, và cách đóng gói binary native (ngoài asar) khi build Studio.
- Kiểm đăng nhập bằng `query.accountInfo()`; chưa đăng nhập thì UI hướng dẫn chạy `claude` rồi `/login`.
- Session tạo ngoài 5ilence (Claude desktop, terminal) đọc bằng `listSessions` / `getSessionMessages`.
- Test adapter bằng luồng `SDKMessage` ghi lại rồi phát lại; không gọi model trong CI.

## Ánh xạ lệnh

| Interface `Backend` | Agent SDK |
| --- | --- |
| `start` | `query({ prompt: AsyncIterable<SDKUserMessage>, options })`, **streaming input** (bắt buộc cho `interrupt`, `setPermissionMode`, `setModel`) |
| `options` cố định | `settingSources: ['project']` · `permissionMode: 'default'` · `tools: { type: 'preset', preset: 'claude_code' }` · `systemPrompt: { type: 'preset', preset: 'claude_code', append: <hồ sơ cá nhân> }` · `plugins: [{ type: 'local', path: '~/.silence/plugin' }]` · `includePartialMessages: true` · `hooks.PreToolUse` · `canUseTool` · `cwd` · `env` (mục Xác thực) |
| `resume` / `fork` | `resume: backendSessionId`, `forkSession: true`, `resumeSessionAt: atMessageId` |
| `limits` | `maxTurns`, `maxBudgetUsd` (chi phí do client ước tính) |
| `send` | đẩy `SDKUserMessage` vào hàng đợi input của `query` |
| `interrupt` | `query.interrupt()` |
| `setMode` | `agent` → `setPermissionMode('default')`; `plan` → `'plan'`; `ask` → giữ `'default'`, lõi trả `deny` cho mọi `write`/`edit`/`shell` có tác dụng phụ |
| `setModel` | `query.setModel(model)`; `effort` chỉ đặt lúc start (option `effort`) |
| `close` | kết thúc iterable input, rồi `query.close()` |

Không bao giờ dùng `acceptEdits`, `bypassPermissions`, `dontAsk`, `auto`: các mode này cho phép ở bước 4 của thứ tự đánh giá, bỏ qua `canUseTool`.

## Duyệt tool call

Thứ tự đánh giá theo tài liệu (trang permissions): **1. hook → 2. deny rule → 3. ask rule → 4. permission mode → 5. allow rule → 6. `canUseTool`**. Hook `deny` có hiệu lực cả khi `bypassPermissions`. Hook `allow` **không** bỏ qua deny rule và ask rule. Nhiều hook trả khác nhau thì `deny` > `defer` > `ask` > `allow`. `canUseTool` **không** được gọi khi allow rule hoặc permission mode đã cho phép.

Hệ quả: chỉ hook `PreToolUse` thấy được **mọi** lệnh gọi, kể cả khi `.claude/settings.json` của project có allow rule. Cổng Risk Engine phải ở hook.

| Phương án | Cách chạy | Đánh giá |
| --- | --- | --- |
| **a.** Hook gọi `decide`. Lõi trả `allow`/`deny`/`modify` ngay; khi cần hỏi thì trả `ask`, hook trả `permissionDecision: 'ask'`, SDK chuyển sang `canUseTool`, adapter gọi lại lõi để hỏi | Đúng như mô tả ban đầu | Phụ thuộc việc hook `ask` có luôn dẫn tới `canUseTool` không **[chưa xác minh]**. Hai lượt hỏi lõi cho một lệnh gọi |
| **b. (chọn)** Hook gọi `decide` và **chờ** lõi quyết xong, kể cả lúc lõi hỏi người dùng; hook chỉ trả `allow`/`deny`/`allow + updatedInput`. Lõi lưu kết quả theo `tool_use_id`. `canUseTool` (do ask rule của project, hoặc SDK tự hỏi) tra kết quả đã lưu; không có thì gọi `decide` | Một nơi quyết, không dựa vào ngữ nghĩa của hook `ask`. Ask rule của project không gây hỏi hai lần | Hook phải chờ được lâu: cần đặt `timeout` lớn cho matcher **[chưa xác minh giá trị mặc định và giới hạn]** |
| c. Chỉ `canUseTool`, `settingSources: []` | Đơn giản | Mất `CLAUDE.md`, skill, `.mcp.json` của project; allow rule truyền qua option vẫn bỏ qua callback. Loại |

Đầu ra hook (kiểu `HookJSONOutput`): `hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' | 'deny' | 'ask' | 'defer', permissionDecisionReason, updatedInput }`. `canUseTool` trả `{ behavior: 'allow', updatedInput? }` hoặc `{ behavior: 'deny', message, interrupt? }`; không bao giờ trả `null` (tool call sẽ treo).

Ngoại lệ đã biết: lệnh xoá đường dẫn hệ trọng (`rm`/`rmdir` vào critical path) không được duyệt bởi hook `allow`. Ngoại lệ này chỉ chặt hơn, không lỏng hơn.

**Test bắt buộc trước khi dùng thật:** (1) project có `"allow": ["Bash(*)", "Edit"]` mà Risk Engine vẫn nhận `decide` cho mọi lệnh gọi; (2) tool call bên trong subagent (`Task`) cũng đi qua hook **[chưa xác minh]**; (3) hook chờ 5 phút không bị huỷ; (4) lõi chết giữa chừng thì lệnh gọi bị từ chối; (5) hook dạng lệnh trong `.claude/settings.json` của project có tự chạy khi headless không **[chưa xác minh, các nguồn mâu thuẫn]**; (6) hook trả `allow` thì SDK có còn hỏi thêm ở bước permission mode hay gọi `canUseTool` không (tránh hỏi hai lần) **[chưa xác minh]**; (7) lệnh slash của project có chạy shell mà không qua hook không **[chưa xác minh]**; (8) `plugins` cục bộ nạp đúng skill/subagent khi `settingSources: ['project']`.

## Duyệt cấu hình repo

Hook dạng lệnh trong `.claude/settings.json` và server trong `.mcp.json` chạy tiến trình **ngoài** tool call, nên hook `PreToolUse` không thấy. Theo các issue trên tracker của Claude Code, chế độ headless/SDK coi thư mục là đã tin cậy và bỏ qua hộp thoại trust. Trước `start`, lõi đọc các file này (kể cả `env`, `apiKeyHelper` trong settings và lệnh slash của project). Nếu có hook hoặc MCP server chưa duyệt (so theo hash nội dung), lõi hỏi người dùng. Từ chối thì không mở session với `settingSources: ['project']`.

## Ánh xạ tool Claude → tên trung lập

| Tool Claude | `kind` | `name` (Risk Engine) |
| --- | --- | --- |
| `Read`, `NotebookRead` | read | `read` |
| `Glob`, `Grep`, `LS` | search | `glob`, `grep` |
| `Write` | write | `write` |
| `Edit`, `MultiEdit`, `NotebookEdit` | edit | `edit` |
| `Bash`, `BashOutput`, `KillShell` | shell | `shell` (lệnh lấy từ `input.command`) |
| `WebFetch`, `WebSearch` | fetch | `web_fetch`, `web_search` |
| `Task` / `Agent` | agent | `subagent` |
| `TodoWrite`, `ExitPlanMode` | internal / plan | tự cho phép, có ghi log |
| `mcp__<server>__<tool>` | mcp | giữ nguyên |
| tên khác | other | Risk Engine coi là `ask` |

Danh sách tool thật lấy từ `system/init.tools` mỗi session; tên trong bảng là theo hiểu biết hiện tại **[chưa xác minh đủ danh sách]**.

## Diff, snapshot, sandbox

- **Diff:** với `write`/`edit`, lõi đọc file hiện tại và áp `old`→`new` ngay trong `decide` để có thẻ diff trước khi ghi. Chế độ Ask/Allowlist: thẻ diff là câu hỏi. Chế độ Cân bằng: tự chạy, thẻ có `applied: true` và nút Undo.
- **Snapshot:** dùng snapshot git theo lượt của lõi (`refs/silence/snap/…`), trung lập với backend. Option `enableFileCheckpointing` + `rewindFiles()` của SDK là phương án phụ.
- **Sandbox (không tự dựng):** khi tương tác, bật option `sandbox` của SDK với `failIfUnavailable: true` trên macOS/Linux/WSL2. Theo tài liệu sandboxing, Claude Code **không** có sandbox trên Windows native: ở đó dựa vào Risk Engine cộng snapshot. Sandbox của Claude chỉ bọc Bash, không bọc Edit/Write. Việc không người trông chạy trong container (giai đoạn 3), không dùng `silence-sbx`.

## Xác thực, usage, quota

- `env` của SDK **thay thế** môi trường tiến trình con chứ không gộp. Adapter dựng `env` từ môi trường hiện có, **bỏ** `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`/`_FOUNDRY`. Ở chế độ không tương tác, API key luôn được ưu tiên nếu có.
- `.claude/settings.json` của project có thể đặt `apiKeyHelper` hay `env`. Lõi kiểm `apiKeySource` trong `system/init`: khác nguồn đăng nhập gói thì đóng session với `auth_required`. **[chưa xác minh]** giá trị chính xác của `apiKeySource` khi dùng phiên đăng nhập Pro.
- `usage`: lấy từ `result.usage` và `total_cost_usd`. Tài liệu ghi rõ đây là **ước tính phía client** → `usd_kind: 'estimate'`. Với gói Pro, con số này chỉ để tham khảo.
- `quota`: từ `rate_limit_event.rate_limit_info` (`status` `allowed`/`allowed_warning`/`rejected`, `resetsAt`, `utilization`) và `SDKAssistantMessage.error` (`rate_limit`, `billing_error`, `overloaded`, `authentication_failed`). **[chưa xác minh]** hình dạng đầy đủ của `rate_limit_event` và `SDKAPIRetryMessage`.
- `turn.end`: từ `result.subtype` (`success`, `error_max_turns`, `error_max_budget_usd`, `error_during_execution`) và `stop_reason`.

## Backend sau (chưa làm)

| Backend | Đường điều khiển | Duyệt tool call | Ghi chú |
| --- | --- | --- | --- |
| **Codex CLI** | `codex app-server` (JSON-RPC 2.0 qua stdio, sinh được JSON Schema → kiểu TS) | server gửi request xin duyệt lệnh và patch **[chưa xác minh tên method]** | Đăng nhập ChatGPT; sandbox Windows của Codex **[chưa xác minh]** |
| **Cursor CLI** | chế độ headless, output stream-json **[chưa xác minh]** | không có callback → **dự phòng MCP**: tắt tool ghi/shell, dùng tool MCP của harness | Quyền khai báo bằng file cấu hình |
| **Antigravity CLI (`agy`)** | headless, output máy đọc được; có SDK **[chưa xác minh khả năng điều khiển quyền]** | dự phòng MCP cho tới khi xác minh | Thay Gemini CLI |
| **ACP chung** | client ACP; `session/request_permission` → `decide` | callback | Phủ được nhiều agent cùng lúc; mỗi agent có mức hỗ trợ ACP khác nhau |

**Dự phòng MCP:** lõi mở một MCP server cục bộ (có token, mỗi lượt) phát tool `read`/`write`/`edit`/`shell`, mọi lệnh gọi đi qua `decide`. Backend chạy với tool có sẵn bị tắt và chỉ được dùng server này. Ý tưởng lấy từ MCP bridge cũ (`crates/runtime/src/agent/cli.rs`, `serve_bridge`), viết lại bằng TS khi có backend thật sự cần.
