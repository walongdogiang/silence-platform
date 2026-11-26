---
id: T-034
title: 2.1e Xoá UI chỉ phục vụ Engine cũ
type: chore
status: todo
phase:
area: [studio, protocol]
size: M
model: opus
depends: [T-033]
branch:
pr:
created: 2026-11-26
updated: 2026-11-26
---

## Mục tiêu

Bỏ phần UI và kiểu protocol chỉ phục vụ Engine: Evals, Auto, nguồn model và API key, sandbox, Ports, browser của agent.

## Phạm vi

**Làm:** xoá theo bảng kiểm kê của T-006; sửa `packages/protocol` và spec `docs/frontend/` + rule `.claude/rules/frontend-*.md`. **Không làm:** xoá `crates/` (T-035).

## Bối cảnh

Một phần của 2.1 trong [lộ trình](../../docs/adapters/migration.md); việc gốc T-006 cỡ L đã tách. Phạm vi chi tiết chốt sau T-006 (kiểm kê RPC).
