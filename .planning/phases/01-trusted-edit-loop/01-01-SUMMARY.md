---
phase: 01-trusted-edit-loop
plan: 01
subsystem: testing
tags: [cargo-test, wave-0, stage-apply, permissions, bind-policy, utf8, long-path]

requires: []
provides:
  - Wave 0 red baselines for stage_write / staged_edit_reject disk semantics
  - Wave 0 red baselines for permissions load/save stubs
  - Wave 0 red baseline for non-loopback TCP bind refuse
  - Wave 0 red baselines for Vietnamese UTF-8 shell fixture and long nested path I/O
affects:
  - 01-02 stage-then-apply implementation
  - 01-03 permission persistence
  - 01-04 shell UTF/long-path and bind guard greens

actuals:
  tokens: 8014
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - stage_write/stage_edit/reject_staged stubs that intentionally still commit until Plan 01-02
    - permissions::load/save Err stubs until Plan 01-03
    - bind_policy::ensure_loopback_tcp_bind Ok stub until Plan 01-04

key-files:
  created:
    - crates/runtime/src/permissions.rs
    - crates/runtime/src/bind_policy.rs
    - crates/runtime/tests/bind_guard.rs
  modified:
    - crates/tools/src/lib.rs
    - crates/runtime/src/lib.rs
    - crates/runtime/Cargo.toml
    - .planning/phases/01-trusted-edit-loop/01-VALIDATION.md

key-decisions:
  - "Wave 0 stage APIs are thin public stubs that still call committing write/edit so disk assertions fail until 01-02"
  - "permissions load/save return Err stubs so round-trip and missing-file emptiness both stay red for the intended reason"
  - "bind_policy accepts all hosts in Wave 0 so bind_refuses_non_loopback fails until 01-04"

patterns-established:
  - "Named cargo filters are the Wave 0 contract: stage_write_leaves_disk_unchanged, staged_edit_reject_keeps_before, vietnamese_utf8_round_trip, long_nested_path_tool_io, permissions_round_trip, permissions_missing_file_is_empty, bind_refuses_non_loopback"
  - "tmp_ws()/tempfile fixtures only — no machine-wide paths"

requirements-completed: [LOOP-01, PERM-01, WIN-01, NET-01, METR-04]

coverage:
  - id: D1
    description: "Failing stage_write leaves disk unchanged baseline"
    requirement: LOOP-01
    verification:
      - kind: unit
        ref: "crates/tools/src/lib.rs#stage_write_leaves_disk_unchanged"
        status: fail
    human_judgment: false
  - id: D2
    description: "Failing staged edit reject keeps before baseline"
    requirement: LOOP-01
    verification:
      - kind: unit
        ref: "crates/tools/src/lib.rs#staged_edit_reject_keeps_before"
        status: fail
    human_judgment: false
  - id: D3
    description: "Failing Vietnamese UTF-8 shell fixture baseline"
    requirement: WIN-01
    verification:
      - kind: unit
        ref: "crates/tools/src/lib.rs#vietnamese_utf8_round_trip"
        status: fail
    human_judgment: false
  - id: D4
    description: "Failing long nested path tool I/O baseline"
    requirement: METR-04
    verification:
      - kind: unit
        ref: "crates/tools/src/lib.rs#long_nested_path_tool_io"
        status: fail
    human_judgment: false
  - id: D5
    description: "Failing permissions round-trip and missing-file emptiness baselines"
    requirement: PERM-01
    verification:
      - kind: unit
        ref: "crates/runtime/src/permissions.rs#permissions_round_trip"
        status: fail
      - kind: unit
        ref: "crates/runtime/src/permissions.rs#permissions_missing_file_is_empty"
        status: fail
    human_judgment: false
  - id: D6
    description: "Failing non-loopback TCP bind refuse baseline"
    requirement: NET-01
    verification:
      - kind: unit
        ref: "crates/runtime/tests/bind_guard.rs#bind_refuses_non_loopback"
        status: fail
    human_judgment: false

duration: 25min
completed: 2026-11-05
status: complete
plan_head_before: af166614ac5a99cd397540a3bd303c97d4544b25
plan_head_after: 167cea4f3f7e1d93a0e3c7f7b63017e10280e994
---

# Phase 01 Plan 01: Wave 0 RED baselines Summary

**Nyquist Wave 0 failing cargo tests lock stage/UTF/long-path, permission persistence, and loopback bind before Plans 01-02+ turn them green.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-11-05T00:33:16Z
- **Completed:** 2026-11-05T00:58:00Z
- **Tasks:** 2/2
- **Files modified:** 7 (+ Cargo.lock bootstrap)

## Accomplishments

- Added four named `silence-tools` red tests for stage disk semantics, Vietnamese UTF-8 shell fixture, and long nested path I/O
- Scaffolded `permissions` + `bind_policy` stubs with three named `silence-engine` red tests
- Updated `01-VALIDATION.md` Wave 0 scaffold checkboxes; `nyquist_compliant` remains false

## Task Commits

1. **Task 1: Wave 0 — stage / UTF / long-path failing tests in silence-tools** - `229f331` (test)
2. **Task 2: Wave 0 — permission persistence + bind-guard failing tests** - `167cea4` (test)

## Files Created/Modified

- `crates/tools/src/lib.rs` — stage stubs + four Wave 0 tests
- `crates/runtime/src/permissions.rs` — load/save stubs + two unit tests
- `crates/runtime/src/bind_policy.rs` — loopback bind stub
- `crates/runtime/tests/bind_guard.rs` — `bind_refuses_non_loopback`
- `crates/runtime/src/lib.rs` — export new modules
- `crates/runtime/Cargo.toml` — tempfile dev-dependency
- `.planning/phases/01-trusted-edit-loop/01-VALIDATION.md` — Wave 0 scaffolds marked created

## Decisions Made

- Stage surface is public `stage_write` / `stage_edit` / `reject_staged` / `commit_staged` stubs that still commit so LOOP-01 assertions fail for the right reason
- Permission stubs return `Err` (not silent empty-success) so both round-trip and missing-file tests fail on unimplemented persistence
- Bind stub returns `Ok` for all hosts so refusal assertions stay red

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Vietnamese UTF fixture still green with console Write**
- **Found during:** Task 1
- **Issue:** `[Console]::Out.Write` preserved Vietnamese under current capture, causing unexpected green
- **Fix:** Switched fixture to `Set-Content` without UTF-8 encoding so disk bytes mojibake until Plan 01-04 hardens shell
- **Files modified:** `crates/tools/src/lib.rs`
- **Verification:** `vietnamese_utf8_round_trip` fails on mojibake assertion
- **Committed in:** `229f331`

**2. [Rule 3 - Blocking] Long-path fixture under MAX_PATH length**
- **Found during:** Task 1
- **Issue:** Short segment names kept absolute path at 175 chars
- **Fix:** Longer `nested-segment-NNN/` segments so absolute path exceeds 260; failure then hits resolve/`\\?\` jail mismatch
- **Files modified:** `crates/tools/src/lib.rs`
- **Verification:** `long_nested_path_tool_io` fails on resolve/jail
- **Committed in:** `229f331`

**3. [Rule 3 - Blocking] Pre-staged old phase-dir deletions rode into Task 1 commit**
- **Found during:** Task 1 commit
- **Issue:** Staged deletes under `.planning/phases/5ilence-01-trusted-edit-loop/` were included when committing `lib.rs`
- **Fix:** Left in place — content already lives under `01-trusted-edit-loop/`; subsequent commits used `git reset` + explicit path staging
- **Files modified:** none (process only)
- **Verification:** `01-CONTEXT.md` present under new phase dir
- **Committed in:** `229f331` (unrelated deletions)

**Total deviations:** 3 auto-fixed (1 Rule 1, 2 Rule 3)
**Impact on plan:** Required for valid RED evidence and cleaner later commits; no production green work added

## Issues Encountered

- `target/debug/silence-engine.exe` locked by running Engine process — verified engine tests via `CARGO_TARGET_DIR=target/gsd-w0`
- Cargo CLI accepts only one TESTNAME before `--`; Wave 0 verify uses filters after `--`

## RED Evidence (Wave 0 / TDD)

| Target test | Command | Exit | Failure reason |
|-------------|---------|------|----------------|
| stage_write_leaves_disk_unchanged | `cargo-msvc.bat test -p silence-tools -- …` | 101 | disk already after contents |
| staged_edit_reject_keeps_before | same | 101 | reject no-op; disk has staged edit |
| vietnamese_utf8_round_trip | same | 101 | mojibake on disk (`Xin chào…`) |
| long_nested_path_tool_io | same | 101 | resolve escapes via `\\?\` prefix |
| permissions_round_trip | `… -p silence-engine --lib …` | 101 | save stub Err |
| permissions_missing_file_is_empty | same | 101 | load stub Err |
| bind_refuses_non_loopback | `… --test bind_guard` | 101 | stub accepts `0.0.0.0:0` |

Semantic assessment: each named target executed and failed on the planned assertion/stub — not suite-wide opaque red.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plans 01-02 / 01-03 / 01-04 can turn these exact filters green. Eval task definition (≥1) remains unchecked in VALIDATION Wave 0 until a later plan.

## Self-Check: PASSED

- FOUND: crates/tools/src/lib.rs, permissions.rs, bind_policy.rs, bind_guard.rs, 01-01-SUMMARY.md
- FOUND commits: 229f331, 167cea4 ancestors of HEAD
- Named filters present: stage_write_leaves_disk_unchanged, staged_edit_reject_keeps_before

---
*Phase: 01-trusted-edit-loop*
*Completed: 2026-11-05*
