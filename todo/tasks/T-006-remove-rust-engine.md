---
id: T-006
title: 2.1a Kiểm kê RPC còn qua Engine Rust, quyết định mang sang lõi hay bỏ
type: chore
status: todo
phase:
area: [engine, studio, docs]
size: M
depends: []
branch:
pr:
created: 2026-11-23
updated: 2026-11-26
---

## Mục tiêu

Bước đầu của 2.1 (xoá Engine Rust). Việc gốc cỡ L đã tách thành T-006 → T-031 → T-032 → T-033 → T-034 → T-035. Việc này chỉ làm bảng kiểm kê: mọi RPC Studio còn đi qua Engine, mỗi cái mang sang lõi hay bỏ cùng UI; kết quả quyết định phạm vi thật của T-031, T-032, T-034.

## Phạm vi

**Làm:** liệt kê RPC từ `apps/studio/src/main/coreRoute.ts` (nhánh `to: "engine"`) và `packages/protocol`; mỗi RPC ghi: UI nào dùng, mang/bỏ, việc nào lo (T-031/T-032/T-034). Ghi bảng vào task này rồi cập nhật phạm vi các việc sau. Không đổi code.

**Không làm:** chuyển hay xoá bất cứ thứ gì (việc của T-031 trở đi).

## Bối cảnh

- Danh sách xoá: dòng "Giai đoạn 2" trong bảng **Xoá** của `docs/adapters/migration.md`; mang sang lõi: bảng **Mang từ Rust sang `packages/core`**. Khôi phục từ tag `archive/pre-harness-pivot`.
- Docs phải sửa theo: mục **Docs cần sửa theo** cuối `docs/adapters/migration.md` (codemap, ADR 0001/0002, threat model, security, `AGENTS.md`, `CLAUDE.md`, `ci.yml`).
