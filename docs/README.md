# Tài liệu 5ilence (mục lục build)

Đọc file này trước khi đọc sâu docs khác. Đây là **mục lục cho Cursor khi xây repo `5ilence`**, không phải sách hướng dẫn end-user.

Cách dùng: chọn **một hoặc hai** file theo việc → đọc file đó. Không đọc hết catalog mỗi lần.

Playbook vận hành (stack, lệnh, ràng buộc): [`AGENTS.md`](../AGENTS.md) ở gốc repo.

---

## Tên sản phẩm (brand) ↔ code

Monorepo **`5ilence`**. Bốn tên dưới đây là bề mặt sản phẩm / trách nhiệm — **không** phải bốn repository. Năm 1: Studio + Engine; CLI để backlog.

| Brand | Vai trò | Path / artifact hiện tại |
| --- | --- | --- |
| **5ilence** | Nền tảng / tên repo | Thư mục repo (đổi từ `5ilence-planning`) |
| **5ilence Studio** | Desktop GUI (editor, chat, terminal, Git) | `apps/studio` (package `@silence/studio`) |
| **5ilence Engine** | Runtime, harness, session, tool execution | `crates/runtime` (binary / crate `silence-engine`) + `tools`, `mcp`, `router`, `sandbox` |
| **5ilence Agent** | Vòng agent / plan / tool calls | Module trong Engine (`crates/runtime/src/agent.rs`) — chưa tách process |
| **5ilence CLI** | Agent trong terminal | **Chưa có** (backlog PRD năm 1); sẽ dùng chung Engine |

Họ crate phụ vẫn `silence-*` (protocol, tools, …). Không đổi sang tên bắt đầu bằng số `5…` — identifier Rust không hợp lệ.

## Sản phẩm / kiến trúc

| File | Mục đích | Khi nào đọc |
| --- | --- | --- |
| [PRD.md](PRD.md) | Yêu cầu năm 1, persona, 6 job lõi, backlog | Plan GSD, đổi phạm vi sản phẩm |
| [adr/0001-architecture.md](adr/0001-architecture.md) | Quyết định Electron + Rust sidecar, JSON-RPC, Monaco | Đổi kiến trúc / IPC / editor |
| [threat-model.md](threat-model.md) | Tài sản, trust boundary, giảm thiểu đe dọa local agent | Đổi permission, sandbox, MCP, mạng |

## Giao diện

Mục lục chi tiết UI: [frontend/README.md](frontend/README.md).

| File | Mục đích | Khi nào đọc |
| --- | --- | --- |
| [frontend/layout.md](frontend/layout.md) | Shell TitleBar, Chat Workspace, panel | Sửa khung cửa sổ / layout |
| [frontend/chat.md](frontend/chat.md) | Hội thoại Cursor-like, Copy, checkpoint | Sửa ChatPane / hợp đồng tin nhắn |
| [frontend/composer.md](frontend/composer.md) | Ô nhập, mode, Auto, tools | Sửa Composer |
| [frontend/tokens.md](frontend/tokens.md) | Token màu, appearance | Sửa theme / appearance |
| [frontend/chat-markdown-roadmap.md](frontend/chat-markdown-roadmap.md) | Việc Markdown chat cố ý chưa làm | Tránh làm sớm / mở lại backlog Markdown |

Đổi UI: đọc spec tương ứng rồi `.cursor/rules/frontend-*.mdc`.

## Trạng thái planning (GSD)

| File | Mục đích | Khi nào đọc |
| --- | --- | --- |
| [../.planning/STATE.md](../.planning/STATE.md) | Vị trí phase / blocker hiện tại | Trước discuss / plan / execute |
| [../.planning/PROJECT.md](../.planning/PROJECT.md) | Bối cảnh dự án cho GSD | Khởi động milestone / đồng bộ PROJECT |

Plan: `/gsd-plan-phase --prd docs/PRD.md`. Không `/gsd-new-project` đè PRD. GSD (`.cursor/`, `.planning/`) chỉ cho Cursor — không ship vào UI app.

## Cấu hình / eval (ngoài `docs/`)

| File | Mục đích | Khi nào đọc |
| --- | --- | --- |
| [../config/models.yaml](../config/models.yaml) | Cấu hình model / route | Đổi Auto-model hoặc danh sách model |
| [../evals/v0/manifest.yaml](../evals/v0/manifest.yaml) | Danh sách eval harness | Đổi vòng agent / thêm eval |

## Kit agent trong app (không phải playbook Cursor)

Đây là tài liệu **agent sản phẩm** (copy `templates/silence` → `.silence/`), tách khỏi mục lục build ở trên.

| File | Mục đích | Khi nào đọc |
| --- | --- | --- |
| [../templates/silence/AGENTS.md](../templates/silence/AGENTS.md) | Luật agent trong app | Chỉ khi task đụng kit Silence / hành vi agent workspace |

Không sửa `templates/silence/` trừ khi task yêu cầu rõ. Không liệt kê skills GSD (`.cursor/skills/`) ở đây.

## Không còn đúng

| File | Ghi chú |
| --- | --- |
| [archive/ui-app.md](archive/ui-app.md) | Task UI cũ (Axiom Studio). **Không** dùng làm nguồn sự thật — dùng `docs/frontend/`. |
