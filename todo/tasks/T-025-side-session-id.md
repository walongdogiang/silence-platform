---
id: T-025
title: Phiên con dùng đúng mã phiên của chính nó (không lấy mã chat gốc)
type: fix
status: todo
phase:
area: [agent-kit]
size: S
model: opus
depends: [T-020]
branch:
pr:
created: 2026-11-26
updated: 2026-11-26
---

## Mục tiêu

Một phiên con (session start từ chat khác, kế thừa ngữ cảnh) đã thấy dòng `[todo] Phiên này: <id>` của chat gốc. Nó dùng nhầm mã đó cho lệnh `todo-claims.mjs worktree … --session`, nên sổ ghi chủ worktree là chat gốc. Khi phiên con commit, hook chủ worktree chặn chính nó. Xong việc này, phiên con luôn ghi và dùng đúng mã phiên của mình.

## Phạm vi sơ bộ

- Tái hiện: phiên con (mã chat = mã phiên của nó) chạy `worktree --session <mã chat gốc>` rồi commit → bị `deny`. Sự cố 2026-11-25, PR #82.
- Hướng cần xét ở pha design (chưa chọn):
  - Lệnh `worktree` / `claim` tự lấy mã phiên thật, không nhận `--session` do agent gõ.
  - Hook in lại `Phiên này:` mỗi lượt.
  - Skill dặn đọc mã phiên từ nguồn tin cậy.
- Chưa kiểm: phiên con có nhận SessionStart riêng không, và biến môi trường nào chứa mã phiên.
