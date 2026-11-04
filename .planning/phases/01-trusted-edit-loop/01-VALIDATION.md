---
phase: "1"
slug: "trusted-edit-loop"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-05"
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `01-RESEARCH.md` ## Validation Architecture.

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
| 1-*-* | TBD | TBD | LOOP-01 | TBD | Staged edit not on disk until Apply | unit + integration | `cargo test -p silence-tools` | ❌ W0 | ⬜ pending |
| 1-*-* | TBD | TBD | LOOP-03 | TBD | No renderer model/fs; audit on apply | unit + boundary | `cargo test -p silence-engine` | ⚠️ partial | ⬜ pending |
| 1-*-* | TBD | TBD | WIN-01 | TBD | PowerShell + long path + Vietnamese UTF | unit | `cargo test -p silence-tools` | ❌ W0 | ⬜ pending |
| 1-*-* | TBD | TBD | WIN-02 | TBD | Engine separate process | smoke | spawn / Studio main pattern | ✅ | ⬜ pending |
| 1-*-* | TBD | TBD | PERM-01 | TBD | Ask default; remember workspace | unit | session allowlist + file round-trip | ❌ W0 | ⬜ pending |
| 1-*-* | TBD | TBD | NET-01 | TBD | Bind loopback/pipe only | unit | reject non-loopback addr | ❌ W0 | ⬜ pending |
| 1-*-* | TBD | TBD | METR-04 | TBD | Shell/ConPTY reliable | unit | `cargo test -p silence-tools` / pty smoke | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*  
*Planner fills concrete Task IDs / Plan / Wave / Threat Ref when PLAN.md exists.*

---

## Wave 0 Requirements

- [ ] Unit tests for staged write/edit + apply/reject disk semantics
- [ ] Unit tests for permission remember + workspace persistence load/save
- [ ] UTF-8 Vietnamese + long-path shell/file fixtures under `crates/tools`
- [ ] Bind-address guard test for TCP serve
- [ ] Optional: 1–2 `evals/v0` shell reliability tasks (not full suite)
- [ ] Framework install: none — use existing cargo/npm

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Renderer never calls model/fs/shell directly | LOOP-03 | Architecture boundary / preload surface | Spot-check Studio preload + ChatPane; no direct model/fs APIs |
| UI crash does not kill Engine | WIN-02 | Process isolation smoke | Kill Studio renderer/main while Engine alive; confirm Engine process remains |
| Diff Apply/Reject UX in Studio | LOOP-01 | End-to-end UI | Prompt edit → see staged diff → Apply writes / Reject restores |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
