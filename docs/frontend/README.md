---
description: Mục lục spec UI Electron (renderer) — layout, chat, composer, tokens; không chứa backend hay Engine.
type: index
code:
  - apps/studio/src/renderer
---
# Front-end 5ilence

Chỉ tài liệu **UI Electron** (`apps/studio/src/renderer`). Backend, Engine, infra, evals **không** nằm đây.

Khi sửa giao diện: đọc file tương ứng dưới đây, rồi `.cursor/rules/frontend-*.mdc`.

| Spec | Nội dung |
| --- | --- |
| [layout.md](layout.md) | Shell: Chat Workspace; icon Chat trên titlebar giữa panel và Settings |
| [chat.md](chat.md) | Hội thoại Cursor-like: Worked for, Thought brief, narration, checkpoint, Explored |
| [composer.md](composer.md) | Ô nhập kiểu Cursor, mode, Auto, context usage |
| [tokens.md](tokens.md) | Token màu, appearance, localStorage |

**Ranh giới:** UI không gọi model. Mọi fs/shell/MCP qua `silence-engine` (JSON-RPC). Không bịa backend (mic, upload, automations = “chưa gắn”).

**Lịch sử:** `docs/archive/ui-app.md` (Axiom Studio / Agents Window) **không** còn là nguồn sự thật. Đã bỏ project header (Chat/Plan/Tasks…) khỏi khung chat. Explorer không hiện trong Chat Workspace. Icon Chat trên titlebar (giữa panel và Settings) bật/tắt cả Chat Workspace.

**Code:** `apps/studio/src/renderer/` — `App.tsx` + `components/` + `theme/`.
