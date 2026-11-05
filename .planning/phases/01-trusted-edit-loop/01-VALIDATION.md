---
phase: "1"
slug: "trusted-edit-loop"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-05"
updated: "2026-11-05"
# wave_0_complete stays false until Plans 01-02..01-04 green the suite
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `01-RESEARCH.md` ## Validation Architecture; task map filled by planner.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust `cargo test` (crate-scoped); optional `npm run evals` |
| **Config file** | Workspace `Cargo.toml`; `evals/v0/manifest.yaml` |
| **Quick run command** | `cargo test -p silence-tools` (or `.\scripts\cargo-msvc.bat test -p silence-tools`) |
| **Full suite command** | `cargo test -p silence-tools -p silence-engine -p silence-sandbox` (+ optional `npm run evals` if keys) |
| **Estimated runtime** | ~30–120 seconds (crate tests); evals longer |

---

## Sampling Rate

- **After every task commit:** Run `cargo test -p silence-tools` (add `-p silence-engine` when touching runtime/rpc)
- **After every plan wave:** Run `cargo test -p silence-tools -p silence-engine -p silence-sandbox`
- **Before `/gsd-verify-work`:** Full suite must be green; `npm run evals` only if keys present else document skip
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-T1 | 01-01 | 1 | LOOP-01, WIN-01, METR-04 | T-01-01 | Stage/UTF/long-path red baselines | unit | `cargo test -p silence-tools` | ✅ | ❌ red |
| 01-01-T2 | 01-01 | 1 | PERM-01, NET-01 | T-01-02 | Permission + bind red baselines | unit | `cargo test -p silence-engine permissions_round_trip bind_refuses` | ✅ | ❌ red |
| 01-02-T1 | 01-02 | 2 | LOOP-01, LOOP-03, WIN-02 | T-01-03, T-01-04 | Staged edit not on disk until Apply; Reject via Engine | unit + human-check | `cargo test -p silence-tools stage_write_leaves_disk_unchanged staged_edit_reject_keeps_before` | ❌→✅ | ⬜ pending |
| 01-02-T2 | 01-02 | 2 | LOOP-03 | T-01-05 | Audit on Apply; Reject no write | unit | `cargo test -p silence-engine` | ⚠️ partial | ⬜ pending |
| 01-02-T3 | 01-02 | 2 | LOOP-01 | T-01-06 | Diff banner loading/error UX | cargo + human-check | `cargo test -p silence-tools -p silence-engine` | ✅ UI | ⬜ pending |
| 01-03-T2 | 01-03 | 3 | PERM-01 | T-01-07, T-01-09 | Remember persists; name resolved server-side | unit | `cargo test -p silence-engine permissions_round_trip remember_allow second_call_skips` | ❌→✅ | ⬜ pending |
| 01-03-T3 | 01-03 | 3 | PERM-01 | T-01-07 | Remember checkbox + Ask banner | cargo + human-check | `cargo test -p silence-engine` | ✅ UI | ⬜ pending |
| 01-04-T1 | 01-04 | 3 | WIN-01, METR-04 | T-01-12 | Shell UTF + long-path green | unit | `cargo test -p silence-tools vietnamese_utf8 long_nested` | ❌→✅ | ⬜ pending |
| 01-04-T2 | 01-04 | 3 | NET-01, WIN-02 | T-01-10 | Bind loopback only; Engine separate | unit | `cargo test -p silence-engine bind_refuses` | ❌→✅ | ⬜ pending |
| 01-04-T3 | 01-04 | 3 | METR-04, WIN-01 | T-01-11 | ConPTY keep + ≥1 mandatory evals/v0 task def (live evals skip if no keys) | unit (+ eval def) | `cargo test -p silence-tools -p silence-engine -p silence-sandbox` + manifest has UTF/staged/shell task | ⚠️ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*  
*01-03-T1 is checkpoint:decision (no automated row).*

---

## Wave 0 Requirements

- [x] Unit tests for staged write/edit + apply/reject disk semantics (`stage_write_leaves_disk_unchanged`, `staged_edit_reject_keeps_before` — red until 01-02)
- [x] Unit tests for permission remember + workspace persistence load/save (`permissions_round_trip`, `permissions_missing_file_is_empty` — red until 01-03)
- [x] UTF-8 Vietnamese + long-path shell/file fixtures under `crates/tools` (`vietnamese_utf8_round_trip`, `long_nested_path_tool_io` — red until 01-04)
- [x] Bind-address guard test for TCP serve (`bind_refuses_non_loopback` — red until 01-04)
- [ ] Mandatory: ≥1 `evals/v0` task definition for shell UTF and/or staged-edit path (live `npm run evals` may skip without keys; not full 20-suite gate)
- [x] Framework install: none — use existing cargo/npm

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Renderer never calls model/fs/shell directly | LOOP-03 | Architecture boundary / preload surface | Spot-check Studio preload + ChatPane; no direct model/fs APIs |
| UI crash does not kill Engine | WIN-02 | Process isolation smoke | Kill Studio renderer/main while Engine alive; confirm Engine process remains |
| Diff Apply/Reject UX in Studio | LOOP-01 | End-to-end UI | Prompt edit → see staged diff → Apply writes / Reject keeps before |
| Permission Remember UX | PERM-01 | Banner interaction | Allow+Remember → recreate session → same tool skips Ask |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter (after Plan 01-04 greens suite)

**Approval:** pending — execute plans then re-check
