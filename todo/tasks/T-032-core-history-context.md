---
id: T-032
title: 2.1c Lõi nhận lịch sử chat, session.context, rewind, fork
type: feature
status: todo
phase:
area: [core, studio]
size: L
model: opus
depends: [T-006]
branch:
pr:
created: 2026-11-26
updated: 2026-11-26
---

## Mục tiêu

Lấp các chỗ lõi còn thiếu so với Engine (migration.md mục 1.5c) để chat không còn cần Rust. `size: L`: ở design tách tiếp nếu quá một PR.

## Phạm vi

**Làm:** lịch sử chat, `session.context`, `rewind`, `fork` trên lõi, giữ định dạng `events.jsonl` nếu được. **Không làm:** eval (bỏ ở T-034 nếu T-006 quyết bỏ).

## Bối cảnh

Một phần của 2.1 trong [lộ trình](../../docs/adapters/migration.md); việc gốc T-006 cỡ L đã tách. Phạm vi chi tiết chốt sau T-006 (kiểm kê RPC).
