---
id: T-006
title: 2.1 Xoá Engine Rust (chia PR)
type: chore
status: todo
phase:
area: [engine, studio, ci, docs]
size: L
depends: []
branch:
pr:
created: 2026-11-23
updated: 2026-11-24
---

## Mục tiêu

Bỏ toàn bộ Engine Rust; Studio chỉ dùng lõi TS. `size: L` — ở pha design phải tách thành nhiều việc, mỗi việc một PR.

## Phạm vi

**Làm:** liệt kê đủ các RPC Studio còn đi qua Engine (fs, terminal, lịch sử, eval, provider…), quyết định cái nào mang sang lõi, cái nào bỏ cùng UI; xoá `crates/`, `Cargo.*`, job Rust trong CI; sửa docs theo.

**Không làm:** tính năng mới trên lõi ngoài những gì cần để thay Engine.

## Bối cảnh

- Danh sách xoá: dòng "Giai đoạn 2" trong bảng **Xoá** của `docs/adapters/migration.md`; mang sang lõi: bảng **Mang từ Rust sang `packages/core`**. Khôi phục từ tag `archive/pre-harness-pivot`.
- Docs phải sửa theo: mục **Docs cần sửa theo** cuối `docs/adapters/migration.md` (codemap, ADR 0001/0002, threat model, security, `AGENTS.md`, `CLAUDE.md`, `ci.yml`).
