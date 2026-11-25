---
id: T-024
title: Lời báo của hook chủ worktree ghi chat chủ đang làm việc gì, kèm tên chat dễ nhận ra
type: feature
status: todo
phase:
area: [agent-kit]
size: S
model: opus
model-build: sonnet
depends: [T-020]
branch:
pr:
created: 2026-11-25
updated: 2026-11-25
---

## Mục tiêu

Hiện tại khi hook chủ worktree (T-020) chặn (`deny`) hoặc hỏi (`ask`), lời báo chỉ có mã chat, ví dụ "chat 37a7cd15". Người dùng không dò được mã đó ra chat nào trong sidebar, cũng không biết chat ấy đang làm việc gì. Xong việc này, lời báo phải cho người đọc biết ngay: chat nào (bằng tên dễ nhận ra) và đang làm `T-xxx` nào (nếu có).

## Phạm vi sơ bộ

- **Việc đang làm:** lấy từ `book.claims`, tìm việc mà chat chủ đang giữ ở đúng worktree đó, rồi ghép vào lý do trong `guardGit` (`scripts/todo-owner.mjs`) và vào lệnh `todo-claims.mjs list`. Không thêm field vào `worktrees`, vì dữ liệu đã có trong `claims`.
- **Tên chat dễ nhận ra:** cần kiểm trước trong transcript `~/.claude/projects/<repo>/*.jsonl` xem có dòng nào chứa tiêu đề chat hay không. Nếu không có thì dùng khoảng 40 ký tự đầu của tin nhắn đầu tiên của user. Tên chỉ đọc lúc tạo lời báo hoặc lúc ghi chủ, và vẫn phải giữ hook chạy dưới khoảng 0,3 giây.
- Sổ vẫn là dữ liệu cho máy đọc. Chỉ những lời báo tạo ra từ sổ mới cần dễ đọc.
- Không làm trong việc này: đổi luật chặn/hỏi, hay ngưỡng 2 giờ.

Bối cảnh: phát hiện khi user tự chạy thử T-020 ngày 2026-11-25 (PR #79, #80).
