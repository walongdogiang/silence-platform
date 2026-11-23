---
id: T-004
title: Ngôn ngữ đợt 2 — file agent đọc mỗi phiên sang tiếng Anh
type: docs
status: todo
phase:
area: [docs]
size: M
depends: []
branch:
pr:
created: 2026-11-23
updated: 2026-11-24
---

## Mục tiêu

Các file agent đọc ở mỗi phiên viết bằng tiếng Anh (gọn token, ít nhầm). Agent vẫn nói với user bằng tiếng Việt.

## Phạm vi

**Làm:** `AGENTS.md`, `CLAUDE.md`, `.claude/rules/*.md`, `docs/codemap.md`, `docs/README.md` sang tiếng Anh, giữ nguyên nghĩa và quy tắc (đặc biệt câu "Nói với user tiếng Việt"); `npm run check:rules` và `npm run check:docs` xanh.

**Không làm:** phần còn lại của `docs/` (đợt 3, T-005).

## Bối cảnh

Quyết định Q7a (chat ngày 2026-11-22): đợt 2 và đợt 3 mỗi đợt một PR.

## Câu hỏi mở

- [ ] Có đưa `.claude/skills/todo/SKILL.md`, `todo/` và `scripts/todo-brief.mjs` (chuỗi nạp vào phiên) vào đợt 2 không?
