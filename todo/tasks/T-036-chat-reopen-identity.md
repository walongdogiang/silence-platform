---
id: T-036
title: Chat mở lại (đổi model, mã phiên mới) vẫn được nhận là cùng chat chủ worktree
type: fix
status: todo
phase:
area: [agent-kit]
size: S
model: opus
depends: []
branch:
pr:
created: 2026-11-26
updated: 2026-11-26
---

## Mục tiêu

Khi app mở lại một chat với mã phiên mới (vd đổi model giữa chừng), sổ chủ worktree vẫn coi đó là cùng chat. Hiện tại hook chặn commit trong worktree chính chat đó vừa tạo. Model `opus`: chưa rõ dấu hiệu nào nối phiên mới với phiên cũ.

## Phạm vi

**Làm:** sửa cách lấy `chat` trong `ensureChat` (`scripts/todo-owner.mjs`) để phiên mở lại nối về chat cũ; test tái hiện trong `scripts/todo.test.mjs` (đỏ trước, xanh sau).

**Không làm:** phiên con (T-025), dọn mục worktree đã xoá (T-026).

## Bối cảnh

Gặp 2026-11-26: phiên `5314be98` (chat `0f93131f…`) tạo worktree; app mở lại thành phiên `ff6d0f8e` (Opus) thì sổ ghi `chat = ff6d0f8e…` (bằng chính mã phiên, như nhánh `source === "fork"` hoặc `chatIdFromTranscript` lấy `uuid` đầu transcript mới). PreToolUse `guardGit` từ chối `git commit`: "worktree đang thuộc chat 0f93131f". Phải tạo worktree mới để làm tiếp. Cần xem: `input.source` của SessionStart khi mở lại, và transcript mới có chứa mã phiên/uuid cũ không.
