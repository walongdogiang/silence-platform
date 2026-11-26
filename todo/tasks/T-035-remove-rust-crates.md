---
id: T-035
title: 2.1f Xoá crates/, Cargo, job Rust trong CI, sửa docs
type: chore
status: todo
phase:
area: [engine, ci, docs]
size: M
model: opus
depends: [T-034]
branch:
pr:
created: 2026-11-26
updated: 2026-11-26
---

## Mục tiêu

Repo không còn Rust. Xong thì T-007/T-008 và giai đoạn 3 mở được.

## Phạm vi

**Làm:** xoá `crates/`, `Cargo.*`, `scripts/cargo-msvc.bat`, `config/models.yaml`, `templates/silence/`, `evals/`, job Rust trong `ci.yml`; viết lại `scripts/studio-watch.mjs`; sửa codemap, ADR 0001/0002, threat model, `AGENTS.md`, `CLAUDE.md`. Chạm `.github/workflows`, `AGENTS.md`, `CLAUDE.md` → hỏi user ở cổng duyệt.

## Bối cảnh

Một phần của 2.1 trong [lộ trình](../../docs/adapters/migration.md); việc gốc T-006 cỡ L đã tách. Phạm vi chi tiết chốt sau T-006 (kiểm kê RPC).
