---
phase: 01-trusted-edit-loop
plan: 02
status: complete-code-unverified-ux
requirements: [LOOP-01, LOOP-03, WIN-02]
commit: dd943c5
written: "2026-11-10"
---

# Plan 01-02 Summary — Stage-then-apply Diff Apply/Reject (Walking Skeleton)

Written after the fact from commit `dd943c5` and the code on `main`; the plan shipped without a summary.

## Done

- **Stage, don't write** (`crates/tools/src/lib.rs`): `stage_write` / `stage_edit` compute the
  before/after pair and return a diff without touching disk. `reject_staged` discards; 
  `commit_staged` writes (used by Apply).
- **Engine owns pending state** (`crates/runtime/src/agent.rs`): `Session.pending_edits`
  (`path → PendingEdit{tool, after}`) is filled when a mutating tool is staged and emitted as
  `SessionEvent::Diff`.
- **Apply** (`agent::apply_diff`, RPC `diff.apply`): takes the pending edit, commits it, runs the
  `afterFileEdit` hook, appends an audit event `diff.apply` (`ok`, `had_pending`).
- **Reject** (`agent::reject_diff`, RPC `diff.reject`): drops the pending edit and calls
  `reject_staged`; disk stays at `before`.
- **Protocol** dual-synced: `DiffRejectParams` in `crates/protocol` and `packages/protocol`
  (protocol 0.1.2).
- **Studio**: `App.tsx` calls `diff.apply` / `diff.reject` through `window.silence.rpc` (Reject goes
  to the Engine, not a UI-only clear).

## Evidence

- `cargo test -p silence-tools`: `stage_write_leaves_disk_unchanged`, `staged_edit_reject_keeps_before`
  pass (tools suite 16/16 on `main` @ `203c54d`).
- Engine suite 47/47.

## Not verified

- **Manual UX** (Diff banner → Apply writes / Reject keeps before) — never exercised by hand.
  Tracked in `01-VALIDATION.md` Manual-Only table and `STATE.md` Pending Todos.
- No engine-level test that Apply writes an audit row and Reject writes none (`01-VALIDATION.md`
  row 01-02-T2 still "partial").
- No eval covering the staged-edit path (only `S23` shell UTF-8 was added in 01-04).

## Observations (not fixed here)

- `apply_diff` falls back to the renderer-supplied `after` when there is no pending edit
  (`had_pending: false`) and writes it. The path is still jailed by `Workspace::resolve`
  (since #8), but it means the renderer can request a write the model never proposed. Decide
  whether to refuse apply without a pending edit.
- `reject_diff` does not append an audit event; only Apply is audited.
