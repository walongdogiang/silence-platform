---
id: T-003
title: 1.12 Pane xem dev server / URL
type: feature
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

Studio có pane xem dev server / URL (Electron `WebContentsView`), để xem app đang làm ngay cạnh chat. Mốc cuối của giai đoạn 1.

## Phạm vi

**Làm:** mở URL / dev server localhost trong pane, đóng/mở lại được; bản xem trước tĩnh cho user duyệt trước khi code; cập nhật `docs/frontend/layout.md`.

**Không làm:** agent tự điều khiển trình duyệt; mở URL ngoài localhost mặc định (để sau, nếu cần).

## Bối cảnh

- Mốc 1.12 trong `docs/adapters/migration.md` (nhánh dự kiến `feat/browser-preview`).
- UI: `docs/frontend/layout.md` và rule `.claude/rules/frontend-*.md`.
- Bảo mật: không bind LAN; `docs/threat-model.md`.
