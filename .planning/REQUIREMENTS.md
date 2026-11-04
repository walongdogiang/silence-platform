# Requirements: 5ilence

**Defined:** 2026-11-04
**Core Value:** Harness that can edit a local workspace with permission, plan-approve, and eval. Not a VS Code fork. BMAD/GSD/ECC stay out of the product UI.
**Source:** `docs/PRD.md` (canonical — do not overwrite)

## v1 Requirements

Requirements for year-1 core. Each maps to roadmap phases.

### Core loop

- [ ] **LOOP-01**: User opens a workspace, prompts the AI; agent reads/greps/edits files and runs shell; user reviews diff then apply/reject
- [ ] **LOOP-02**: Plan mode — agent proposes a plan, user Approves, then edits are allowed
- [ ] **LOOP-03**: UI never calls the model; every file change goes through the tool runtime with diff + audit

### Model

- [ ] **MODL-01**: User can attach a cloud model (OpenAI-compatible / cloud provider); not locked to company-only models
- [ ] **MODL-02**: User can enable Auto — harness routes fast / mid / strong

### MCP

- [ ] **MCP-01**: User can enable MCP stdio servers per workspace allowlist (Git, tickets, CI, DB tools, …)

### Sub-agent

- [ ] **SUBA-01**: User can delegate explore / implement / review to a sub-agent and receive a summary

### Cost & audit

- [ ] **COST-01**: User can view cost/token usage for the session
- [ ] **AUDT-01**: User can view the audit trail for the session

### Windows / NFR

- [ ] **WIN-01**: Default terminal is ConPTY + PowerShell; long paths and UTF (including Vietnamese) do not break
- [ ] **WIN-02**: Engine (Rust sidecar) is a separate process — UI crash does not kill the agent
- [ ] **PERM-01**: Permission default is `ask` (remember per workspace); no silent YOLO
- [ ] **SEC-01**: Secrets are redacted before sending to the model
- [ ] **NET-01**: IPC is local-only (named pipe / loopback); no LAN bind

### Metrics (year-1 targets)

- [ ] **METR-01**: Eval pass rate ≥ 70% with Auto on the 20-task v0 suite
- [ ] **METR-02**: Time-to-first-token < 1.5s when network is healthy
- [ ] **METR-03**: Auto median cost/task ≥ 30% cheaper than strong-only
- [ ] **METR-04**: Shell/ConPTY reliable on Windows

## v2 Requirements

Deferred — not locked for year 1. Tracked but not in current roadmap until core is solid.

### Context & convention

- **CTX-01**: `@` file/folder mentions
- **CTX-02**: `/` skills, path-scoped `AGENTS.md` / rules, hooks

### Modes

- **MODE-01**: Ask / Debug / Review modes wired to runtime (UI stubs may exist)

### Git & session

- **GIT-01**: Commit when user asks; worktree; resume thread

### CLI

- **CLI-01**: 5ilence CLI (Claude Code-style), shared Engine with Studio

### Index & editor

- **IDX-01**: Codebase index / embedding / RAG if needed after ripgrep
- **EDT-01**: Tab autocomplete; full LSP — after year 1 unless locked early

## Out of Scope

Explicitly excluded for year 1. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Fork VS Code / marketplace extensions | ADR + PRD non-goals |
| Fleet agent on cloud VMs | Year-1 non-goal |
| Multi-tenant control plane / remote sessions | After local is solid |
| BMAD/GSD/ECC shipped into product UI | Cursor build-kit only |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LOOP-01 | — | Pending |
| LOOP-02 | — | Pending |
| LOOP-03 | — | Pending |
| MODL-01 | — | Pending |
| MODL-02 | — | Pending |
| MCP-01 | — | Pending |
| SUBA-01 | — | Pending |
| COST-01 | — | Pending |
| AUDT-01 | — | Pending |
| WIN-01 | — | Pending |
| WIN-02 | — | Pending |
| PERM-01 | — | Pending |
| SEC-01 | — | Pending |
| NET-01 | — | Pending |
| METR-01 | — | Pending |
| METR-02 | — | Pending |
| METR-03 | — | Pending |
| METR-04 | — | Pending |

**Coverage:**
- v1 requirements: 18 total
- Mapped to phases: 0
- Unmapped: 18 ⚠️

---
*Requirements defined: 2026-11-04*
*Last updated: 2026-11-04 after PRD express resume (skip map, skip research)*
