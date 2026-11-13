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
| Anthropic Messages API (chuyển message, SSE, cache, thinking block) | `runtime/src/gateway/anthropic.rs` (`build_request`, `convert_messages`, `StreamState`) |
| Claude CLI backend + MCP bridge | `runtime/src/agent/cli.rs` (`run_cli_turn`, `cli_args`, `serve_bridge`, `run_bridge`); subcommand `mcp-bridge` ở `main.rs` |
| Nguồn model: trạng thái, key runtime, nguồn ưu tiên cho Auto | `runtime/src/providers.rs`; `router/src/lib.rs` (`set_credential`, `set_preferred`, `by_tier`); RPC `providers.*` ở `rpc.rs` |
| Effort (mức suy nghĩ) | `agent::set_effort`, `ModelEntry::effective_effort` (router); UI `renderer/effort.ts` + submenu trong `Composer.tsx` |
| Thông tin Claude CLI (tài khoản, cài đặt, safeguard, chi phí) | `runtime/src/providers.rs` (`cli_info`, `parse_auth_status`, `cli_usage`), RPC `providers.cli_info`; UI `renderer/components/CliDetails.tsx`, `renderer/cliInfo.ts` |
| Lưu API key (mã hoá) | `apps/studio/src/main/credentials.ts` (safeStorage); UI `renderer/components/ProviderSources.tsx` |
| Lỗi provider → mã thân thiện | `runtime/src/provider_error.rs` |
| Ước lượng token, compact | `runtime/src/compact.rs`; số liệu cho UI: `agent/usage.rs::context_usage` |
| Tiêu đề chat do AI sinh | `runtime/src/title.rs` |
| Danh sách RPC method (`session.*`, `diff.*`, `fs.*`, `mcp.*`, `terminal.*`…) | `runtime/src/rpc.rs::handle` |
| Audit log | `runtime/src/audit.rs` |
| Event log từng session (`events.jsonl`), list, replay | `runtime/src/session/log.rs` (`SessionStore`, `replay_messages`, `summarize`); kiểu dòng log: `LogRecord` / `LogBody` trong protocol |
| Mở lại session cũ (`session.resume`), ghi message/event vào log | `agent/resume.rs::resume_session`; `agent/mod.rs::persist_messages`, `subscribe` |
| Skill/hook của tổ chức (`.silence/`) | `runtime/src/org.rs` |
| Terminal (ConPTY) | `runtime/src/pty.rs` |
| Chỉ bind loopback | `runtime/src/bind_policy.rs` |
| Ẩn secret trong log | `runtime/src/redact.rs` |
| Entry CLI, chạy eval | `runtime/src/main.rs`; chạy `runtime/src/eval_runner.rs` (`run`, `Suite::attempt`, `resolve_model`), hiệu chỉnh `eval_calibrate.rs` (`pick_model`), lịch sử `eval_history.rs` (`render_summary`); hướng dẫn `evals/README.md` |
| Tool `read`/`write`/`edit`/`glob`/`grep`/`shell`/`git_*`, jail workspace | `crates/tools/src/lib.rs` (`specs`, `Workspace`) |
| Ảnh: đọc ảnh workspace (`read_image`, `view_image` spec), ảnh user dán (validate, content parts, strip cho model không vision) | `crates/tools/src/image.rs`, `crates/runtime/src/images.rs`; tool `view_image` ở `agent/mod.rs` (`view_image`, `builtin_tools`) |
| Job Object, timeout process | `crates/sandbox/src/lib.rs` |
| MCP client/host | `crates/mcp/src/lib.rs` |

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
| Khung cửa sổ | `renderer/components/TitleBar.tsx`, `Sidebar.tsx`, `BottomPanel.tsx` |
| Quyền (Settings) | `renderer/components/PermissionsSection.tsx` |
| Thông báo lỗi cho user | `renderer/errorCopy.ts`, `components/ErrorCard.tsx` |
| Theme, token màu | `renderer/theme/tokens.css`, `theme/appearance.ts`; spec: `docs/frontend/tokens.md` |
