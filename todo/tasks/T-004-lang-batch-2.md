---
id: T-004
title: Ngôn ngữ đợt 2 — file agent đọc mỗi phiên sang tiếng Anh
status: todo
depends: []
created: 2026-11-23
---

## Mục tiêu

Các file agent đọc ở mỗi phiên viết bằng tiếng Anh (gọn token, ít nhầm). Agent vẫn nói với user bằng tiếng Việt.

## Bối cảnh

Quyết định Q7a (chat ngày 2026-11-22): đợt 2 và đợt 3 mỗi đợt một PR. Đợt 3 là T-005.

Phạm vi đợt 2: `AGENTS.md`, `CLAUDE.md`, `.claude/rules/*.md`, `docs/codemap.md`, `docs/README.md`. Cân nhắc thêm `.claude/skills/todo/SKILL.md` và `todo/` (hỏi user).

## Tiêu chí xong

- [ ] Các file trên đã sang tiếng Anh, giữ nguyên nghĩa và quy tắc (đặc biệt câu "Nói với user tiếng Việt")
- [ ] `npm run check:rules` và `npm run check:docs` xanh
- [ ] PR đã merge

## Nhật ký
