---
id: T-020
title: Quy tắc worktree — mỗi việc một worktree mới, không dùng lại worktree có sẵn
type: feature
status: todo
phase:
area: [docs]
size: M
depends: []
branch:
pr:
created: 2026-11-25
updated: 2026-11-25
---

## Mục tiêu

Hai phiên không bao giờ dùng chung một worktree. Mỗi việc có worktree riêng tạo từ `origin/main`, gắn với nhánh của việc; xong việc thì gỡ. Commit của phiên này không thể rơi vào nhánh của phiên khác.

## Phạm vi

**Làm:** thiết kế và ghi quy tắc vào skill `task-git` (mục Worktree), skill `todo` (Bắt đầu việc bước 3, Đóng việc), memory/quy ước; cách đặt tên và chỗ đặt worktree; cách biết worktree thuộc phiên/việc nào (vd qua sổ `scripts/todo-claims.mjs`); dọn worktree sau merge; xử lý worktree mồ côi.
**Không làm:** đổi quy trình PR/merge (`scripts/pr-merge.mjs`); thư mục chính của user (vẫn không đụng).

## Bối cảnh

Sự cố 2026-11-25: phiên làm PR #69 và phiên làm ADR 0005 (PR #70) cùng dùng `5ilence-wt2`. Worktree "sạch" lúc kiểm nhưng phiên kia đang viết dở; commit `1c0790e` của ADR rơi vào nhánh `chore/settings-merge-gate`. Gỡ được vì commit chưa lên remote. Quy tắc hiện tại ("`git status` sạch thì dùng được", skill `task-git`) không đủ.

Liên quan: skill `task-git` (`.claude/skills/task-git/SKILL.md`), skill `todo` (Bắt đầu việc, Chuyển giao), sổ giữ việc `scripts/todo-claims.mjs`.
