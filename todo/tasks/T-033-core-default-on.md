---
id: T-033
title: 2.1d Bật lõi mặc định, bỏ công tắc SILENCE_CORE, dùng thử
type: chore
status: todo
phase:
area: [core, studio]
size: S
model: sonnet
depends: [T-031, T-032]
branch:
pr:
created: 2026-11-26
updated: 2026-11-26
---

## Mục tiêu

Studio dùng lõi TS mặc định; đường Engine chỉ còn để so sánh trong thời gian dùng thử.

## Phạm vi

**Làm:** đổi mặc định ở `core.ts`/`coreRoute.ts`, bỏ `toEngineMode`/đường dự phòng khi dùng thử đạt. **Cổng:** user dùng thử vài ngày cho mọi việc (tiêu chí `(user, chặn)`).

## Bối cảnh

Một phần của 2.1 trong [lộ trình](../../docs/adapters/migration.md); việc gốc T-006 cỡ L đã tách. Phạm vi chi tiết chốt sau T-006 (kiểm kê RPC).
