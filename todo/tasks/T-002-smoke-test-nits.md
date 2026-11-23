---
id: T-002
title: Sửa các điểm nhỏ còn lại sau chạy thử 1.8–1.11
type: fix
status: todo
phase:
area: [studio]
size: M
depends: []
branch:
pr:
created: 2026-11-23
updated: 2026-11-24
---

## Mục tiêu

Dọn các lỗi nhỏ thấy khi chạy thử thật Studio (`SILENCE_CORE=1`) ngày 2026-11-23, sau PR #60, để chat hằng ngày không vướng.

## Phạm vi

**Làm:**
- "Worked for —" ở lượt bị ngắt hiện đúng (hoặc ẩn)
- Thẻ gộp không tràn rộng cột chat
- Worktree tự dọn sau khi gộp
- Thẻ diff ghi đường dẫn tương đối theo workspace, không tuyệt đối
- Trang Số liệu không còn tải ~10s

**Không làm:** thiết kế lại thẻ quyền (nhánh `fix/perm-card-design` của phiên khác); tính năng mới.

## Bối cảnh

- Chạy thử trên repo `D:\vuhieu\test\test-python` (có `.silence/verify.yaml` chạy `python -m compileall -q .`). Spec: `docs/frontend/chat.md`, `docs/frontend/layout.md`.
- PR #62 (`fix(studio): worktree card after a merge; one-line banner, relative diff paths`) có thể đã xử lý mục đường dẫn tương đối và một phần mục worktree sau gộp — kiểm lại ở pha design trước khi làm.
