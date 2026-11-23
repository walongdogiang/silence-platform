---
id: T-006
title: 2.1 Xoá Engine Rust (chia PR)
status: todo
depends: []
created: 2026-11-23
---

## Mục tiêu

Bỏ toàn bộ Engine Rust; Studio chỉ dùng lõi TS.

## Bối cảnh

- Danh sách xoá: dòng "Giai đoạn 2" trong bảng **Xoá** của `docs/adapters/migration.md`. Khôi phục từ tag `archive/pre-harness-pivot`.
- Studio còn dùng Engine cho fs, terminal, lịch sử, eval, provider… → bước đầu là liệt kê đủ các RPC còn đi qua Engine, quyết định cái nào mang sang lõi (bảng **Mang từ Rust sang `packages/core`**), cái nào bỏ cùng UI.
- Docs phải sửa theo: mục **Docs cần sửa theo** cuối `docs/adapters/migration.md` (codemap, ADR 0001/0002, threat model, security, `AGENTS.md`, `CLAUDE.md`, `ci.yml`).

## Tiêu chí xong

- [ ] Bản liệt kê RPC còn dùng Engine + kế hoạch chia PR được user duyệt
- [ ] Từng PR: tsc + vitest xanh, Studio vẫn chat được
- [ ] `crates/`, `Cargo.*`, job Rust trong CI đã xoá; docs ở trên đã sửa
- [ ] Tất cả PR đã merge

## Nhật ký
