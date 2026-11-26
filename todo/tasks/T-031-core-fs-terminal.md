---
id: T-031
title: 2.1b Lõi nhận fs.* và terminal (node-pty)
type: feature
status: todo
phase:
area: [core, studio]
size: M
model: opus
depends: [T-006]
branch:
pr:
created: 2026-11-26
updated: 2026-11-26
---

## Mục tiêu

Lõi TS phục vụ RPC fs.* và terminal, thay phần Engine Rust (`pty.rs`, `fs.*`), để Studio không cần Engine cho hai việc này.

## Phạm vi

**Làm:** port theo bảng "Mang từ Rust sang packages/core" của migration.md; route trong `coreRoute.ts`; test. **Không làm:** lịch sử chat (T-032), xoá Rust (T-035).

## Bối cảnh

Một phần của 2.1 trong [lộ trình](../../docs/adapters/migration.md); việc gốc T-006 cỡ L đã tách. Phạm vi chi tiết chốt sau T-006 (kiểm kê RPC).
