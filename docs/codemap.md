---
description: Bản đồ code — câu hỏi “X nằm ở đâu?” → file và tên hàm trong Engine, Protocol và Studio.
type: reference
code:
  - crates/runtime/src
  - crates/tools/src
  - crates/protocol/src
  - packages/protocol/src
  - apps/studio/src
---
# Bản đồ code

TL;DR: câu hỏi "X nằm ở đâu?" → file và hàm. Hàm ghi theo tên để grep, không ghi số dòng. Chỉ trỏ path, không chép code. Đổi tên hoặc chuyển file thì cập nhật bảng này.

Kiến trúc đích và layout module sắp tới: [adr/0002-harness-architecture.md](adr/0002-harness-architecture.md). Bảng dưới là vị trí **hiện tại**.

## Luồng một lượt chat

Renderer `window.silence.rpc` (`apps/studio/src/preload/index.ts`) → main (`apps/studio/src/main/index.ts`, spawn Engine + TCP loopback) → `crates/runtime/src/rpc.rs::handle` → `crates/runtime/src/agent/mod.rs::prompt` → `run_turn` → `gateway::chat` (gọi model; model Claude CLI thì `agent/cli.rs::run_cli_turn`) → `dispatch_tool` → `crates/tools` → sự kiện `session.event` về UI.

## Engine (Rust)

| Câu hỏi | Ở đâu |
| --- | --- |
| System prompt của agent (`SYSTEM`) | `crates/runtime/src/agent/modes.rs` |
| Mode (Ask/Agent/Plan/…) đổi gì trong vòng lặp | `agent/modes.rs::profile`, `with_mode_system`; `agent/mod.rs::builtin_tools` |
| Vòng agent, gọi tool, subagent | `agent/mod.rs::run_turn`, `dispatch_tool`; `agent/subagent.rs::run_subagent` |
| Diff chờ duyệt, apply/reject | `agent/changes.rs::stage_file_tool`, `apply_diff`, `reject_diff` |
| Hỏi quyền, nhớ quyền theo workspace | `agent/policy.rs::ask_perm`, `decide_permission`; lưu file: `runtime/src/permissions.rs` |
| Phân tầng rủi ro lệnh/tool (auto/logged/ask/block) | `runtime/src/risk/mod.rs::classify`, parser `risk/command.rs`, luật `risk/default_policy.yaml`, ca test `risk/corpus.yaml`; spec `docs/security/` |
| Chặn mở session YOLO qua RPC | `runtime/src/rpc.rs::client_permission_allowed` |
| Phạm vi duyệt (một lần / phiên / workspace), Stop từ chối quyền đang chờ, đổi chế độ quyền | `agent/policy.rs::decide_permission_scoped`, `agent/mod.rs::abort`, `set_permission`; UI `renderer/permissionUi.ts`, card trong `ChatPane.tsx`, Settings `PermissionsSection.tsx` |
| Thông báo desktop khi chờ duyệt | `main/notify.ts`, handler `silence-notify-permission` trong `main/index.ts` |
| Chọn model theo lượt (Model Auto) | slot theo mode/mục đích + leo cấp + trần chi phí: `agent/auto.rs` (`pick_main`, `pick_aux`, `Escalation`, `budget`); slot → model: `crates/router/src/auto.rs` (`Catalog::route_auto`, preset, pool); RPC `auto.set_config`, `session.budget_continue`, `session.spend`, `session.carry_spend`; cấu hình: `config/models.yaml` (`escalation.on`) |
| Auto ở Studio | `renderer/autoConfig.ts` (lưu, preset, `slotModel`, `engineConfig`, chi phí theo slot); `components/AutoSettings.tsx` (submenu + Settings); chip lượt: `ChatPane.tsx::autoChip` |
| Gọi API model, chi phí | `runtime/src/gateway/mod.rs` (`chat`, `chat_short`, `chat_cost_usd`; rẽ nhánh theo `provider.kind`) |
| Claude API — Messages API (chuyển message, SSE, cache, thinking block) | `runtime/src/gateway/claude_api.rs` (`build_request`, `convert_messages`, `StreamState`) |
| Claude CLI backend + MCP bridge | `runtime/src/agent/cli.rs` (`run_cli_turn`, `cli_args`, `serve_bridge`, `run_bridge`); subcommand `mcp-bridge` ở `main.rs` |
| Nguồn model: trạng thái, key runtime, nguồn ưu tiên cho Auto | `runtime/src/providers.rs`; `router/src/lib.rs` (`set_credential`, `set_preferred`, `by_tier`); RPC `providers.*` ở `rpc.rs` |
| Effort (mức suy nghĩ) | `agent::set_effort`, `ModelEntry::effective_effort` (router); UI `renderer/effort.ts` + submenu trong `Composer.tsx` |
| Thông tin Claude CLI (tài khoản, cài đặt, safeguard, chi phí) | `runtime/src/providers.rs` (`cli_info`, `parse_auth_status`, `cli_usage`), RPC `providers.cli_info`; UI `renderer/components/CliDetails.tsx`, `renderer/cliInfo.ts` |
| Lưu API key (mã hoá) | `apps/studio/src/main/credentials.ts` (safeStorage); UI `renderer/components/ProviderSources.tsx` |
| Lỗi provider → mã thân thiện | `runtime/src/provider_error.rs` |
| Ước lượng token, compact | `runtime/src/compact.rs` (ngưỡng trễ 70% → 50%); số liệu cho UI: `agent/usage.rs::context_usage` |
| Tóm tắt lượt bị bỏ khi compact | `compact.rs::compact_with_summary` + `summarize_span` (slot Small, như tiêu đề; note `<compacted_history>`; lỗi thì bỏ như cũ); gọi từ `agent/mod.rs::run_turn` ngoài khoá session |
| Prompt cache (bố cục prefix, breakpoint) | system tĩnh + lịch sử giữ nguyên; mode/style/env đi trong message `<turn_context>` ở cuối, không lưu: `agent/env.rs::turn_context`, `with_turn_context`; breakpoint lịch sử đặt trước nó (`gateway::is_turn_context`, `claude_api.rs::mark_history_end`); breakpoint Claude API `gateway/claude_api.rs::build_request`, OpenRouter `anthropic/*` `gateway/mod.rs::with_cache_breakpoints`; đọc `cached_tokens` ở `gateway/mod.rs::ingest`; tool MCP sắp xếp ở `mcp/src/lib.rs::all_tools` |
| Tiêu đề chat do AI sinh | `runtime/src/title.rs` |
| Danh sách RPC method (`session.*`, `diff.*`, `fs.*`, `mcp.*`, `terminal.*`…) | `runtime/src/rpc.rs::handle` |
| Audit log | `runtime/src/audit.rs` |
| Event log từng session (`events.jsonl`), list, replay | `runtime/src/session/log.rs` (`SessionStore`, `replay_messages`, `summarize`); kiểu dòng log: `LogRecord` / `LogBody` trong protocol |
| Mở lại session cũ (`session.resume`), ghi message/event vào log | `agent/resume.rs::resume_session`; `agent/mod.rs::persist_messages`, `subscribe` |
| Cắt lịch sử (`session.rewind`), nhân bản session (`session.fork`) | `agent/history.rs::rewind_session`, `fork_session`, `cut_index`; UI: `renderer/messageMenu.ts`, `components/MessageMenu.tsx` |
| Chỉ dẫn workspace (AGENTS.md gốc + `.silence/AGENTS.md`, CLAUDE.md khi không có AGENTS.md), skill, hook | `runtime/src/org.rs` (`load`, `system_append`: system tĩnh chỉ liệt kê tên + mô tả skill); thân skill qua tool `skill` (`org::skill_text`, `agent/mod.rs::session_tools`, `skill_spec`; risk `READ_WS`); AGENTS.md/CLAUDE.md của thư mục con nối vào kết quả `read`/`outline`/`write`/`edit` đầu tiên trong thư mục đó (`OrgContext::nested_for`, `agent/mod.rs::nested_note`) |
| Terminal (ConPTY) | `runtime/src/pty.rs` |
| Chỉ bind loopback | `runtime/src/bind_policy.rs` |
| Ẩn secret trong log | `runtime/src/redact.rs` |
| Entry CLI, chạy eval | `runtime/src/main.rs`; chạy `runtime/src/eval_runner.rs` (`run`, `Suite::attempt`, `resolve_model`), hiệu chỉnh `eval_calibrate.rs` (`pick_model`), lịch sử `eval_history.rs` (`render_summary`, `fail_streak`, `last_run`); trần theo task `eval_runner.rs::TaskMetrics::over_limits`; chọn task theo diff `eval_affects.rs` + `evals/affects.yaml`; cấu hình eval (nguồn mặc định, trần profile, CI) `eval_config.rs` + `evals/config.yaml` (`steps` = các bước của profile; RPC `eval.config.get/set`; UI `components/EvalsSettingsPanel.tsx`); chạy profile `eval_profile.rs::run_profile` (lệnh `evals-profile`, `npm run evals:smoke|nightly|weekly`); kiểm nguồn trước khi chạy `providers.rs::source_ready`; hướng dẫn `evals/README.md` |
| Eval trong Studio | trang `renderer/components/EvalsPage.tsx`, cấu hình `renderer/evalConfig.ts`; RPC `eval.catalog/estimate/start/cancel/runs/task` ở `runtime/src/eval_rpc.rs` (`EvalHost`); tiến độ `eval_runner::run_with` → `EvalProgress` → notification `eval.progress` (`rpc.rs::pump_eval`, main → IPC `silence-eval`); quy đổi model theo nguồn `router/src/auto.rs::same_model_on`; ước tính `eval_history::estimate` |
| Tool `read`/`write`/`edit`/`glob`/`grep`/`shell`/`git_*`, jail workspace | `crates/tools/src/lib.rs` (`specs`, `Workspace`, `shell_command`) |
| Chặn ghi đè thay đổi bên ngoài: file đổi trên đĩa sau lần agent đọc/ghi cuối thì `write` bị từ chối tới khi đọc lại, `edit` chạy kèm ghi chú; Apply bản đề xuất (Ask/Allowlist) bị từ chối nếu file đã đổi sau khi đề xuất | `runtime/src/agent/fresh.rs` (`stale_write`, `stale_edit_note`, `after_tool`; `Session.seen`); gọi trong `agent/mod.rs::dispatch_tool` trước Risk Engine; `agent/changes.rs::apply_diff`; eval `E06-edit-keep-outside-change` |
| Unicode NFC/NFD (tiếng Việt dựng sẵn và tổ hợp) cho `edit`/`grep`, chuẩn hoá prompt | `crates/tools/src/unicode.rs` (`nfc`, `find_nfc`, `like`); `lib.rs::apply_edit`; `agent/mod.rs::prompt_with_images` |
| Ngôn ngữ trả lời (`Reply language`) | `runtime/src/lang.rs` (`detect`, `decide`); `Session.reply_lang`; dòng trong `agent/env.rs::RuntimeEnv::render` |
| Trình duyệt headless cho agent (`browser_*`): tìm Edge/Chrome, CDP, snapshot chữ có ref, act, console/network | `crates/tools/src/browser/` (`Browser::launch`, `open`, `act`, `report`, `diff_lines`, `screenshot`, `view`, `flow`; luồng → test Playwright `flow.rs` (`locator`, `expectations`, `render_test`, `detect_playwright`); `cdp.rs`; JS `snapshot.js`, `locate.js`); agent `crates/runtime/src/agent/browser.rs` (`dispatch`, `spec`: model thấy **một** tool `browser` có `op`, `agent/mod.rs::expand_grouped_call` đổi thành `browser_<op>` trước khi dispatch, nên risk/audit/UI/eval vẫn dùng tên `browser_*`; `screenshot` gọi từ vòng lượt như `view_image`, `emit_view` → event `browser`); UI tab Trình duyệt `renderer/browserView.ts`, `BottomPanel.tsx` (`BrowserPane`); eval `evals/web/` + fixture `evals/fixtures/web-app` |
| Kiểm HTTP tới localhost (`http_check`), chỉ loopback, HTML → chữ | `crates/tools/src/http.rs` (`http_check`, `local_url`, `html_to_text`); risk `LOCAL_HTTP` / `HTTP_NOT_LOCAL` trong `risk/mod.rs::classify` |
| Tiến trình nền (`proc_start`/`proc_logs`/`proc_stop`/`proc_list`), nhận URL localhost, tab Ports | cơ chế `crates/tools/src/procs.rs` (`Table`, `find_urls`); agent `crates/runtime/src/agent/procs.rs` (`dispatch`, `spec`: một tool `proc` có `op` cho model, dispatch dưới tên `proc_<op>`); RPC `proc.list`/`proc.stop` ở `rpc.rs`; UI `renderer/procs.ts`, `BottomPanel.tsx` (`PortsList`) |
| Ảnh: đọc ảnh workspace (`read_image`, `view_image` spec), ảnh user dán (validate, content parts, strip cho model không vision) | `crates/tools/src/image.rs`, `crates/runtime/src/images.rs`; tool `view_image` ở `agent/mod.rs` (`view_image`, `builtin_tools`) |
| Job Object, timeout process | `crates/sandbox/src/lib.rs` |
| Xác thực kết nối RPC (`auth.hello`, `SILENCE_RPC_TOKEN`) | `crates/runtime/src/rpc_auth.rs`, `rpc.rs` (`serve_connection`); Studio: `apps/studio/src/main/index.ts` (`spawnRuntime`) |
| DACL chỉ cho user hiện tại (named pipe) | `crates/sandbox/src/owner_only.rs` |
| Lọc env cho lệnh trong sandbox | `crates/sandbox/src/env.rs` (`scrub`) |
| Sandbox Windows: chạy lệnh dưới `silence-sbx` (runner, token, ACL, Job) | `crates/sandbox/src/win/` (`launch::run`, `runner`, `token`, `acl`, `job`); API `silence_sandbox::{run, status, grant_workspace}` |
| Cài / gỡ sandbox, cấp quyền workspace | `crates/sandbox/src/win/setup.rs`; CLI `silence-engine sandbox …` (`crates/runtime/src/main.rs` `sandbox_cmd`, `sandbox_exec`) |
| Mạng của sandbox: firewall rule, proxy allowlist | `crates/sandbox/src/win/firewall.rs` (`install`, `check`); `crates/sandbox/src/proxy.rs` (`Proxy`, `Grant`, `NetEvent`, `workspace_allowlist`) |
| Tự chủ: bảng quyết định (cover / ask), host trong lệnh | `runtime/src/risk/mod.rs` (`Verdict::sandbox_plan`, `url_hosts`); khoá `sandbox_covers` / `always_ask` / `never_escalate` ở `risk/default_policy.yaml` |
| Tự chủ: gate chọn sandbox / hỏi / chặn, thẻ leo thang | `agent/policy.rs::gate` (`Gate::Sandbox`), `agent/sandbox.rs` (`block_seen`, `run_in_sandbox`, `ask_hosts`) |
| Tự chủ: snapshot hoàn tác mỗi lượt (`refs/silence/snap/…`) | `agent/sandbox.rs` (`take_snapshot`, `restore_snapshot`); RPC `snapshot.list` / `snapshot.restore` |
| Sandbox phía Engine: cache status, proxy một phiên, credential theo lệnh, `.silence/network.json` | `runtime/src/sandbox_host.rs` (`SandboxHost`, `network::{add,remove,list}`); RPC `sandbox.status` / `sandbox.setup` / `network.list` / `network.revoke` |
| Chạy shell trong sandbox | `crates/tools/src/lib.rs::shell_sandboxed` |
| MCP client/host | `crates/mcp/src/lib.rs` |

## Lõi TS (`packages/core`, ADR 0004)

Đang xây để thay Engine Rust; bật trong Studio bằng `SILENCE_CORE=1`. Không import Electron.

| Câu hỏi | Ở đâu |
| --- | --- |
| JSON-RPC server/client, lỗi, notification | `packages/core/src/api/jsonrpc.ts` (`RpcServer`, `RpcClient`, `RpcFailure`) |
| Kênh truyền (MessagePort, cặp trong bộ nhớ cho test) | `packages/core/src/api/transport.ts` (`portTransport`, `memoryPair`) |
| Đăng ký method của lõi | `packages/core/src/core.ts::createCore` |
| Entry khi chạy trong `utilityProcess` | `packages/core/src/host/utility.ts` |
| Interface `Backend`, `ToolCall`, `Decision`, sự kiện | `packages/core/src/backends/types.ts` (spec `docs/adapters/protocol.md`) |
| Studio khởi động lõi, IPC `silence-core` | `apps/studio/src/main/core.ts` (`startCore`, `coreEnabled`); `main/index.ts::connectCore` |

## Protocol (đổi cả hai)

| Câu hỏi | Ở đâu |
| --- | --- |
| Kiểu request/response/event, `SessionMode`, mã lỗi | `crates/protocol/src/lib.rs` |
| Bản TypeScript tương ứng | `packages/protocol/src/index.ts` |

## Studio (Electron)

| Câu hỏi | Ở đâu |
| --- | --- |
| Spawn Engine, IPC, chặn điều hướng | `apps/studio/src/main/index.ts`, `main/safeUrl.ts` |
| Cầu nối renderer ↔ main | `apps/studio/src/preload/index.ts` |
| State gốc, gọi RPC | `apps/studio/src/renderer/App.tsx` |
| Hội thoại, Markdown | `renderer/components/ChatPane.tsx`, `MarkdownMessage.tsx` |
| Run pulse (elapsed, token lượt, chờ duyệt, Stopping) | `renderer/runStatus.ts`; state `run` trong `App.tsx`; hiển thị `ChatPane.AgentMeta`; spec `docs/frontend/status.md` |
| Ảnh ở UI: dán/kéo-thả/thu nhỏ, lightbox, IndexedDB, ảnh workspace trong câu trả lời | `renderer/pastedImages.ts`, `imageStore.ts`, `workspaceImages.ts`, `components/ImageLightbox.tsx`, `components/WorkspaceImage.tsx`, `components/VisualBlock.tsx` (khối ```svg), `components/ImageFrame.tsx` (hover Tải/Copy/Chỉnh sửa), `components/ImageEditor.tsx` + `imageEdit.ts` (trình đánh dấu, undo/redo, prompt), `imageActions.ts` (tải/copy/ghép PNG) |
| Ô nhập, mode, model | `renderer/components/Composer.tsx`, `renderer/modes.ts`, `renderer/models.ts` |
| Diff | `renderer/components/DiffPane.tsx`, `DiffCard.tsx`, `renderer/unifiedDiff.ts`, `renderer/diffSummary.ts` |
| Lịch sử chat, tab | `renderer/components/ChatHistoryPanel.tsx`, `ChatTabBar.tsx` |
| Khung cửa sổ | `renderer/components/TitleBar.tsx`, `BottomPanel.tsx` |
| Quyền (Settings) | `renderer/components/PermissionsSection.tsx` |
| Thông báo lỗi cho user | `renderer/errorCopy.ts`, `components/ErrorCard.tsx` |
| Theme, token màu | `renderer/theme/tokens.css`, `theme/appearance.ts`; spec: `docs/frontend/tokens.md` |
