---
id: T-003
title: 1.12 Pane xem dev server / URL
status: todo
depends: []
created: 2026-11-23
---

## Mục tiêu

Studio có pane xem dev server / URL (Electron `WebContentsView`). Mốc cuối của giai đoạn 1.

## Bối cảnh

- Mốc 1.12 trong `docs/adapters/migration.md` (nhánh dự kiến `feat/browser-preview`).
- UI: đọc `docs/frontend/layout.md` và rule `.claude/rules/frontend-*.md` trước khi sửa; dựng bản xem trước tĩnh cho user duyệt trước khi code.
- Ràng buộc bảo mật: không bind LAN; xem `docs/threat-model.md`.

## Tiêu chí xong

- [ ] Thiết kế pane được user duyệt (bản xem trước)
- [ ] Mở URL / dev server localhost trong pane, đóng/mở lại được
- [ ] Test Studio xanh; `docs/frontend/layout.md` cập nhật
- [ ] PR đã merge

## Nhật ký
