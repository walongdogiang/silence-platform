---
id: T-072
title: Mỗi lượt kết thúc bằng một dòng trạng thái việc (xong / dở / chờ bạn)
type: feature
status: todo
phase:
area: [agent-kit]
size: M
model: opus
model-build: sonnet
depends: [T-071]
branch:
pr:
created: 2026-11-27
updated: 2026-11-27
---

## Mục tiêu

User không biết việc đã xong chưa hay còn dở, nên phải hỏi lại "xong chưa". Sau việc này, lượt nào của một việc cũng kết thúc bằng đúng một dòng trạng thái, đọc là biết ngay.

## Phạm vi

**Làm** (phương án c, user đã chọn ngày 2026-11-27: luật + hook Stop làm lưới an toàn):
- **Thẻ 5. Trạng thái** trong `.claude/skills/todo/cards.md` và một dòng trong `CLAUDE.md`. Tin cuối mỗi lượt có đúng một dòng:
  - `🏁 Đã xong T-xxx`: PR #n đã merge, việc user cần làm;
  - `⏳ Đang dở T-xxx`: n/m tiêu chí (đếm ô đã tick trong file việc, không ước lượng), bước kế, agent tự làm tiếp hay đang chờ gì;
  - `⛔ Chờ bạn T-xxx`: một câu hỏi.
- Việc giao thẳng trong chat (không có trong `todo/`) cũng dùng ba dòng này, không có mã.
- **Hook Stop** (`scripts/todo-hook.mjs` nhánh `stop`): phiên đang giữ việc mà tin cuối không có 🏁/⏳/⛔ thì chặn dừng một lần (`decision: "block"` kèm lý do), để agent viết thêm dòng trạng thái. Không lặp (dùng `stop_hook_active`).
- Thẻ 🏁 Báo xong (thẻ 4) giữ nguyên; dòng trạng thái là dòng đầu của thẻ đó.

**Không làm:** hook tự viết trạng thái thay agent; chặn quá một lần mỗi lượt.

## Đọc trước

- `.claude/skills/todo/cards.md` (khung chung, thẻ 4) và `.claude/skills/todo/SKILL.md` → Đóng việc, Khi nào kết thúc.
- `scripts/todo-hook.mjs` → `handle()` nhánh `stop`.
- Cần kiểm tài liệu chính thức: hook Stop đọc tin cuối của agent bằng trường nào (trường riêng hay đọc từ `transcript_path`), và trường `stop_hook_active`.

## Bối cảnh

- Làm sau T-071, vì cả hai cùng sửa `CLAUDE.md` và `scripts/todo-hook.mjs`. Ở pha design, xem có viết chung luật T-071 vào một khối trong `CLAUDE.md` không.
- Đụng `CLAUDE.md` và hook nên thuộc loại phải hỏi; cổng duyệt của việc này phủ phần đó.
