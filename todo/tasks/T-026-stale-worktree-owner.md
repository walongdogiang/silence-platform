---
id: T-026
title: Sổ chủ worktree tự bỏ mục của worktree đã bị xoá
type: fix
status: todo
phase:
area: [agent-kit]
size: S
model: sonnet
depends: [T-020]
branch:
pr:
created: 2026-11-26
updated: 2026-11-26
---

## Mục tiêu

Sổ `todo-claims.json` vẫn ghi chủ cho `5ilence-worktrees/hook-owner-branch`, dù worktree đó đã bị gỡ khỏi git. Lệnh `git worktree remove` báo lỗi giữa chừng (Windows không xoá được thư mục đang mở), nên hook `post` không xoá mục chủ. Mục thừa làm `list` và thẻ Dọn worktree hiện sai. Xong việc này, worktree không còn trong `git worktree list` thì sổ tự bỏ mục chủ của nó.

## Phạm vi sơ bộ

- Tái hiện: ghi chủ cho một worktree, gỡ worktree bằng cách khác `git worktree remove` (hoặc lệnh remove lỗi) → mục chủ vẫn còn.
- Hướng sơ bộ: khi đọc sổ (SessionStart, `list`, `guardGit`), bỏ mục mà đường dẫn không còn là worktree (đọc `.git` trên đĩa, giữ hook nhanh).
- Không làm: xoá thư mục trên đĩa (vẫn hỏi user qua thẻ Dọn worktree).
