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

## Luồng một lượt chat

Renderer `window.silence.rpc` (`apps/studio/src/preload/index.ts`) → main (`apps/studio/src/main/index.ts`, spawn Engine + TCP loopback) → `crates/runtime/src/rpc.rs::handle` → `crates/runtime/src/agent.rs::prompt` → `run_turn` → `gateway.rs::chat` (gọi model) → `dispatch_tool` → `crates/tools` → sự kiện `session.event` về UI.

## Engine (Rust)

| Câu hỏi | Ở đâu |
| --- | --- |
| System prompt của agent (`SYSTEM`) | `crates/runtime/src/agent.rs` |
| Mode (Ask/Agent/Plan/…) đổi gì trong vòng lặp | `agent.rs::profile`, `with_mode_system`, `builtin_tools` |
| Vòng agent, gọi tool, subagent | `agent.rs::run_turn`, `dispatch_tool`, `run_subagent` |
| Diff chờ duyệt, apply/reject | `agent.rs::stage_file_tool`, `apply_diff`, `reject_diff` |
| Hỏi quyền, nhớ quyền theo workspace | `agent.rs::ask_perm`, `decide_permission`; lưu file: `runtime/src/permissions.rs` |
| Chọn model theo lượt | `agent.rs::pick_model_for`; catalog + phân loại: `crates/router/src/lib.rs` (`classify`); cấu hình: `config/models.yaml` |
| Gọi API model, chi phí | `runtime/src/gateway.rs` (`chat`, `chat_short`, `cost_usd`) |
| Lỗi provider → mã thân thiện | `runtime/src/provider_error.rs` |
| Ước lượng token, compact | `runtime/src/compact.rs`; số liệu cho UI: `agent.rs::context_usage` |
| Tiêu đề chat do AI sinh | `runtime/src/title.rs` |
| Danh sách RPC method (`session.*`, `diff.*`, `fs.*`, `mcp.*`, `terminal.*`…) | `runtime/src/rpc.rs::handle` |
| Audit log | `runtime/src/audit.rs` |
| Skill/hook của tổ chức (`.silence/`) | `runtime/src/org.rs` |
| Terminal (ConPTY) | `runtime/src/pty.rs` |
| Chỉ bind loopback | `runtime/src/bind_policy.rs` |
| Ẩn secret trong log | `runtime/src/redact.rs` |
| Entry CLI, chạy eval | `runtime/src/main.rs`, `runtime/src/eval_runner.rs`; danh sách eval: `evals/v0/manifest.yaml` |
| Tool `read`/`write`/`edit`/`glob`/`grep`/`shell`/`git_*`, jail workspace | `crates/tools/src/lib.rs` (`specs`, `Workspace`) |
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
| Ô nhập, mode, model | `renderer/components/Composer.tsx`, `renderer/modes.ts`, `renderer/models.ts` |
| Diff | `renderer/components/DiffPane.tsx`, `DiffCard.tsx`, `renderer/unifiedDiff.ts`, `renderer/diffSummary.ts` |
| Lịch sử chat, tab | `renderer/components/ChatHistoryPanel.tsx`, `ChatTabBar.tsx` |
| Khung cửa sổ | `renderer/components/TitleBar.tsx`, `Sidebar.tsx`, `BottomPanel.tsx` |
| Quyền (Settings) | `renderer/components/PermissionsSection.tsx` |
| Thông báo lỗi cho user | `renderer/errorCopy.ts`, `components/ErrorCard.tsx` |
| Theme, token màu | `renderer/theme/tokens.css`, `theme/appearance.ts`; spec: `docs/frontend/tokens.md` |
