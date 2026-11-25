---
id: T-023
title: Chống các chat đụng nhau (phần 2) — nhật ký sửa file tự động, hỏi khi sửa trùng file chat khác đang sửa dở
type: feature
status: todo
phase:
area: [agent-kit]
size: M
model: opus
depends: [T-020]
branch:
pr:
created: 2026-11-25
updated: 2026-11-25
---

## Mục tiêu

Trước khi agent của một chat sửa một file mà chat khác đang sửa dở (chưa vào `origin/main`, chat đó hoạt động < 2 giờ), Claude Code dừng lại hỏi user. Nhật ký "chat nào đang sửa file nào" do máy ghi, không nhờ agent khai. Phần 2 của hướng b (user chọn 2026-11-25; thiết kế ở T-020 → Thiết kế, ý 1, 2, 3, 8, 10).

## Phạm vi

**Làm:**
- Ý 1 — PostToolUse Edit/Write/MultiEdit/NotebookEdit ghi `{chat, worktree, file, giờ}` (dựa trên chủ worktree của T-020, `scripts/todo-hook.mjs` → `post`).
- Ý 2 — PreToolUse cùng các công cụ: file đang được chat khác sửa dở → `ask` kèm chat nào, lúc nào. Chỉ trùng **file**, không trùng ý.
- Ý 3 — bù file sửa bằng shell: mỗi lượt đọc `git status --porcelain` của worktree chat đang làm.
- Ý 8 — loại trừ file việc nào cũng sửa (`todo/README.md`, `todo/DONE.md`).
- Ý 10 — `claim --areas` thành tuỳ chọn; vùng thật từ ý 1 + 3.

**Không làm:** chặn hẳn (chỉ hỏi); xung đột ý nghĩa giữa hai file khác nhau; lệnh user tự gõ ngoài Claude.

Lưu ý khi làm: hook PreToolUse cho Edit/Write chạy mỗi lần sửa file (~200 ms) — đo lại; [ADR 0006](../../docs/adr/0006-session-coordination.md) → Chủ worktree theo chat.
