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
| `options` cố định | `settingSources: ['user', 'project', 'local']` · `permissionMode: 'default'` · `tools: { type: 'preset', preset: 'claude_code' }` + `disallowedTools` (mục Cấu hình như terminal) · `systemPrompt: { type: 'preset', preset: 'claude_code', append: <hồ sơ cá nhân> }` · `plugins: [{ type: 'local', path: '~/.silence/plugin' }]` · `includePartialMessages: true` · `hooks.PreToolUse` · `canUseTool` · `cwd` · `env` (mục Xác thực) |
| `resume` / `fork` | `resume: backendSessionId`, `forkSession: true`, `resumeSessionAt: atMessageId` |
| `limits` | `maxTurns`, `maxBudgetUsd` (chi phí do client ước tính) |
| `send` | đẩy `SDKUserMessage` vào hàng đợi input của `query` |
| `interrupt` | `query.interrupt()` |
| `setMode` | `agent` → `setPermissionMode('default')`; `plan` → `'plan'`; `ask` → giữ `'default'`, lõi trả `deny` cho mọi `write`/`edit`/`shell` có tác dụng phụ |
| `setModel` | `query.setModel(model)`; `effort` chỉ đặt lúc start (option `effort`) |
| `close` | kết thúc iterable input, rồi `query.close()` |

Không bao giờ dùng `acceptEdits`, `bypassPermissions`, `dontAsk`, `auto`: các mode này cho phép ở bước 4 của thứ tự đánh giá, bỏ qua `canUseTool`.

## Cấu hình như terminal (đích, ADR 0004 Decision 6)

Quyết định 2026-11-28 (T-038): Claude trong 5ilence chạy như Claude trong terminal, harness chỉ cộng thêm. **Code chưa đổi**: adapter hiện vẫn dùng `settingSources: ['project']`, danh sách 15 tool (`toolMap.ts`) và `env` theo danh sách giữ (`env.ts`); sửa ở T-074.

| Chỗ | Đích | Ràng buộc |
| --- | --- | --- |
| `settingSources` | `['user', 'project', 'local']`; từ chối duyệt cấu hình repo → `['user']` | Duyệt cấu hình repo giữ nguyên cho `project`, `local`, `.mcp.json`. Kiểm `apiKeySource` giữ nguyên (chặn `apiKeyHelper` ở bất kỳ file nào) |
| Luật quyền | Risk Engine đọc thêm luật trong file settings của Claude ([permissions.md](../security/permissions.md)) | Luật allow của Claude bỏ qua `canUseTool` nhưng không bỏ qua hook, nên Risk Engine vẫn quyết mọi lệnh gọi |
| `tools` | preset `claude_code`; `disallowedTools` chỉ cho tool đi vòng qua harness hoặc cần cloud (vd `RemoteTrigger`, `PushNotification`, tool `Artifact…`, connector `mcp__claude_ai_*`), mỗi tên một lý do trong `toolMap.ts` | Bộ đủ tốn thêm token tạo cache mỗi session (spike: ~40k với bộ rút gọn); đo lại ở T-074. Tool lạ vẫn qua hook → `ask` |
| `env` | giữ toàn bộ `process.env`, bỏ `AUTH_VARS` và biến của app chủ (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SSE_PORT`, `ELECTRON_*`…; danh sách chốt bằng test) | Lệnh shell của agent cần đủ biến như terminal. Test: `system/init.tools` không có tool của app chủ |

`AskUserQuestion` tới host qua `canUseTool`, host trả `{ behavior: 'allow', updatedInput: { questions, answers } }` (trang user-input). Spike #6: hook trả `allow` thì **không** gọi `canUseTool`. Vì vậy với `AskUserQuestion`, hook phải chờ câu trả lời của người dùng rồi trả `allow` kèm `updatedInput` có `answers` **[chưa xác minh, spike ở T-074]**. `EnterPlanMode` đi đường nào: chưa xác minh.

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

## Kết quả spike (2026-11-19)

SDK `0.3.327` (kèm Claude Code `2.1.327`), Windows 10, phiên đăng nhập Claude Pro, model Haiku, chạy bằng Node 20.20 và bằng Electron 33.4 (`ELECTRON_RUN_AS_NODE`, Node 20.18). Script spike nằm ngoài repo (thư mục tạm), không merge.

| # | Câu hỏi | Kết quả |
| --- | --- | --- |
| 1 | Project có `"allow": ["Bash(*)", "Edit", "Write", "Read"]`, hook còn thấy mọi lệnh gọi? | **Có.** Hook nhận `Bash`, `Write`, `Skill` |
| 2 | Tool call trong subagent có qua hook? | **Có.** Lệnh gọi `Agent` và `Read` của subagent đều qua hook; lệnh của subagent có `agent_id` |
| 3 | Hook chờ lâu có bị huỷ? | Với `timeout: 600` trên matcher, hook chờ **70 giây** rồi `allow`, lệnh chạy bình thường. Chưa thử 5 phút |
| 4 | Lõi chết giữa chừng thì lệnh bị từ chối? | Chưa thử (cần lõi thật) |
| 5 | Hook dạng lệnh trong `.claude/settings.json` của project có chạy khi headless? | **Không chạy** (thư mục chưa trust). Vẫn giữ bước duyệt cấu hình repo vì `.mcp.json`, `env`, `apiKeyHelper` chưa thử |
| 6 | Hook trả `allow` thì có bị hỏi thêm / gọi `canUseTool`? | **Không**, cả khi có lẫn không có allow rule trong project. Không hỏi hai lần |
| 7 | Lệnh slash của project chạy shell ngoài hook? | Chưa thử |
| 8 | `plugins` cục bộ nạp skill khi `settingSources: ['project']`? | **Có.** Skill hiện tên `spike-plugin:spike-skill`, model gọi qua tool `Skill` (cũng qua hook) |
| 9 | `updatedInput` của hook có đổi được lệnh? | **Có.** `echo spike-ok` thành `echo modified-by-hook` |
| 10 | Đăng nhập | `apiKeySource: "none"` khi dùng phiên Pro, không cần biến môi trường nào |

**Phát hiện cần xử lý trong adapter:**
- **Môi trường kế thừa làm lọt tool của app chủ.** Chạy từ trong app Claude desktop, session SDK thấy thêm tool `Artifact…` của app đó. Cách xử lý lúc spike: dựng `env` từ **danh sách cho phép**. Từ 2026-11-28 đổi sang giữ toàn bộ, chỉ bỏ biến của app chủ (mục Cấu hình như terminal).
- **Tool theo tài khoản vẫn có dù chỉ nạp `project`:** connector claude.ai (`mcp__claude_ai_*`), `CronCreate`, `RemoteTrigger`, `SendToProject`, `PushNotification`… Cách xử lý lúc spike: truyền `tools` là danh sách rõ ràng. Từ 2026-11-28 đổi sang preset + `disallowedTools` cho đúng các tool này (mục Cấu hình như terminal).
- **Mỗi session mới tốn khoảng 40k token tạo cache** (system prompt + định nghĩa tool). Thu gọn danh sách tool giảm con số này; tái dùng session (resume) rẻ hơn mở mới.
- **Kiểu message mới** ngoài tài liệu: `system/task_summary`, `system/thinking_tokens`, `system/post_turn_summary`, `system/background_tasks_changed`, `system/task_started|progress|updated|notification`; `system/init` xuất hiện lại khi có subagent. Adapter bỏ qua kiểu không biết, không lỗi.
- **`electron.exe` trên Windows** là app giao diện nên không in ra console; lõi chạy dưới Electron phải giao tiếp qua pipe/MessagePort, không dựa vào stdout của console.

Test còn lại (4, 7, và chờ 5 phút) làm trong PR adapter thật.

## Duyệt cấu hình repo

Hook dạng lệnh trong `.claude/settings.json` và server trong `.mcp.json` chạy tiến trình **ngoài** tool call, nên hook `PreToolUse` không thấy. Spike cho thấy hook dạng lệnh của project **không** chạy khi headless trong thư mục chưa trust; `.mcp.json` và `env` chưa thử, nên vẫn duyệt. Trước `start`, lõi đọc các file này (kể cả `env`, `apiKeyHelper` trong settings và lệnh slash của project). Nếu có hook hoặc MCP server chưa duyệt (so theo hash nội dung), lõi hỏi người dùng. Từ chối thì không mở session với `settingSources: ['project']`.

Đã làm ở 1.6 (`packages/core/src/repoConfig/review.ts`):

- **Mục được liệt kê:** trong `.claude/settings.json` có `hooks` (từng lệnh/URL), từng biến `env`, `apiKeyHelper`, `awsAuthRefresh`, `awsCredentialExport`, `otelHeadersHelper`, `statusLine`, `fileSuggestion`, `enabledPlugins`, `extraKnownMarketplaces`, `enableAllProjectMcpServers`, `enabledMcpjsonServers`, `mcpServers`. Trong `.mcp.json` có từng server (lệnh + tên biến env). Trong `.claude/commands/**/*.md` và `.claude/skills/**/*.md` có mỗi `` !`lệnh` ``. File JSON hỏng được liệt kê dạng `invalid`.
- **Hash:** sha256 của danh sách mục, nên sửa vô hại (quyền, model, định dạng) không làm hỏi lại. Bản duyệt lưu theo workspace ở `<dataDir>/repo-config-approvals.jsonl`; `repo_config.approve` chỉ nhận hash khớp với nội dung trên đĩa lúc đó.
- **`session.create`:** chưa duyệt thì trả lỗi JSON-RPC `-32010` (`REPO_CONFIG_REVIEW`) kèm `data.review`. Client duyệt (`repo_config.approve`) rồi gọi lại, hoặc gọi lại với `repo_config: "ignore"`: khi đó adapter dùng `settingSources: []` (đích: `['user']`, T-074), không nạp `CLAUDE.md`, skill, hook, MCP của repo. Không người trông thì tự chạy kiểu `ignore` và ghi audit.
- **Mỗi lượt:** lõi quét lại; cấu hình đổi sang nội dung chưa duyệt thì `session.prompt` trả `-32010`, lượt không chạy.
- **Studio:** main hiện hộp thoại native liệt kê các mục (`apps/studio/src/main/repoReview.ts`) với Cho phép / Chạy không dùng cấu hình repo / Huỷ; giữa session chỉ có Cho phép / Huỷ.

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

Danh sách tool thật lấy từ `system/init.tools` mỗi session. Spike thấy thêm `PowerShell` (kind `shell`), `Skill` (`internal`, nhưng nội dung skill có thể dẫn tới tool khác nên vẫn ghi log), `Agent` (tên mới của `Task` trong hook), `EnterWorktree`/`ExitWorktree`, `Monitor`, `ToolSearch`. Không thấy `WebFetch`, `LS`, `MultiEdit`, `TodoWrite` trong bản `2.1.327`.

## Diff, snapshot, sandbox

- **Diff:** với `write`/`edit`, lõi đọc file hiện tại và áp `old`→`new` ngay trong `decide` để có thẻ diff trước khi ghi. Chế độ Ask/Allowlist: thẻ diff là câu hỏi. Chế độ Cân bằng: tự chạy, thẻ có `applied: true` và nút Undo.
- **Snapshot:** dùng snapshot git theo lượt của lõi (`refs/silence/snap/…`), trung lập với backend. Option `enableFileCheckpointing` + `rewindFiles()` của SDK là phương án phụ.
- **Sandbox (không tự dựng):** khi tương tác, bật option `sandbox` của SDK với `failIfUnavailable: true` trên macOS/Linux/WSL2. Theo tài liệu sandboxing, Claude Code **không** có sandbox trên Windows native: ở đó dựa vào Risk Engine cộng snapshot. Sandbox của Claude chỉ bọc Bash, không bọc Edit/Write. Việc không người trông chạy trong container (giai đoạn 3), không dùng `silence-sbx`.

## Xác thực, usage, quota

- `env` của SDK **thay thế** môi trường tiến trình con chứ không gộp. Adapter dựng `env` từ môi trường hiện có (đích: toàn bộ, trừ biến của app chủ), **bỏ** `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK`/`_VERTEX`/`_FOUNDRY`. Ở chế độ không tương tác, API key luôn được ưu tiên nếu có.
- `.claude/settings.json` của project có thể đặt `apiKeyHelper` hay `env`. Lõi kiểm `apiKeySource` trong `system/init`: phiên đăng nhập Pro cho `"none"` (đã xác minh); khác giá trị đó thì đóng session với `auth_required`.
- `usage`: lấy từ `result.usage` và `total_cost_usd`. Tài liệu ghi rõ đây là **ước tính phía client** → `usd_kind: 'estimate'`. Với gói Pro, con số này chỉ để tham khảo.
- `quota`: từ `rate_limit_event.rate_limit_info` và `SDKAssistantMessage.error` (`rate_limit`, `billing_error`, `overloaded`, `authentication_failed`). Hình dạng thấy trong spike: `{ status: "allowed" | "allowed_warning" | "rejected", resetsAt (giây epoch), rateLimitType: "five_hour" | "seven_day", utilization (0–1), surpassedThreshold, unifiedWindows: { five_hour: { utilization, resetsAt, status }, seven_day: { … } }, overageStatus, isUsingOverage }`. Lõi lấy cửa sổ có `utilization` cao nhất làm trạng thái quota. `SDKAPIRetryMessage` chưa gặp.
- `turn.end`: từ `result.subtype` (`success`, `error_max_turns`, `error_max_budget_usd`, `error_during_execution`) và `stop_reason`.

## Backend sau (chưa làm)

| Backend | Đường điều khiển | Duyệt tool call | Ghi chú |
| --- | --- | --- | --- |
| **Codex CLI** | `codex app-server` (JSON-RPC 2.0 qua stdio, sinh được JSON Schema → kiểu TS) | server gửi request xin duyệt lệnh và patch **[chưa xác minh tên method]** | Đăng nhập ChatGPT; sandbox Windows của Codex **[chưa xác minh]** |
| **Cursor CLI** | chế độ headless, output stream-json **[chưa xác minh]** | không có callback → **dự phòng MCP**: tắt tool ghi/shell, dùng tool MCP của harness | Quyền khai báo bằng file cấu hình |
| **Antigravity CLI (`agy`)** | headless, output máy đọc được; có SDK **[chưa xác minh khả năng điều khiển quyền]** | dự phòng MCP cho tới khi xác minh | Thay Gemini CLI |
| **ACP chung** | client ACP; `session/request_permission` → `decide` | callback | Phủ được nhiều agent cùng lúc; mỗi agent có mức hỗ trợ ACP khác nhau |

**Dự phòng MCP:** lõi mở một MCP server cục bộ (có token, mỗi lượt) phát tool `read`/`write`/`edit`/`shell`, mọi lệnh gọi đi qua `decide`. Backend chạy với tool có sẵn bị tắt và chỉ được dùng server này. Ý tưởng lấy từ MCP bridge cũ (`crates/runtime/src/agent/cli.rs`, `serve_bridge`), viết lại bằng TS khi có backend thật sự cần.
