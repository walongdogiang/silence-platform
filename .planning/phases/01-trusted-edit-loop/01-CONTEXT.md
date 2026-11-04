# Phase 1: Trusted edit loop - Context

**Gathered:** 2026-11-05
**Status:** Ready for planning
**Source:** PRD Express Path (docs/PRD.md)
**Mode:** mvp (Walking Skeleton eligible — Phase 01, no prior summaries)

<domain>
## Phase Boundary

Deliver the year-1 **trusted edit loop** on the existing brownfield Studio + Engine stack: user opens a workspace, prompts the agent, agent reads/greps/edits files and runs shell through Engine only, user reviews diffs and apply/reject, with permission default `ask`, Engine isolated on local-only IPC, and reliable Windows ConPTY/PowerShell (long paths + Vietnamese UTF).

**In scope REQ-IDs:** LOOP-01, LOOP-03, WIN-01, WIN-02, PERM-01, NET-01, METR-04

**Out of this phase:** Plan-approve (Phase 2), cloud/Auto/metrics beyond shell reliability (Phase 3), MCP (Phase 4), sub-agents (Phase 5), cost/audit UI (Phase 6), CLI/Tab/RAG/marketplace.

</domain>

<decisions>
## Implementation Decisions

### Core loop (locked from PRD / ROADMAP)
- User opens a workspace, prompts AI; agent reads/greps/edits files and runs shell; user reviews diff then apply/reject (LOOP-01)
- UI never calls the model; every file change goes through the tool runtime with diff + audit (LOOP-03)
- Success: Studio renderer never calls model or tools directly — only Engine via RPC

### Permissions (locked)
- Permission default = `ask` (rememberable per workspace); no silent YOLO (PERM-01)
- Risky tools must prompt before execution

### Windows / process isolation (locked)
- Default terminal ConPTY + PowerShell; long paths; UTF-16/UTF-8 including Vietnamese must not break (WIN-01, METR-04)
- Engine (Rust sidecar) is a separate process — UI crash does not kill the agent (WIN-02)
- IPC local-only (named pipe / loopback); no LAN bind (NET-01)

### Architecture (locked from ADR)
- Electron + React Studio; Rust `silence-engine` owns harness
- JSON-RPC over named pipe (Windows) or TCP `127.0.0.1` for dev
- No napi-rs as primary IPC; Monaco editor (no VS Code fork year 1)
- Protocol dual-sourced: `packages/protocol` + `crates/protocol`

### Product principles (locked)
- Cloud models are the year-1 direction overall, but Phase 1 only needs a working prompt→tool→diff path (provider wiring depth belongs mainly to Phase 3)
- GSD/BMAD/ECC must not ship into product UI
- Brand surfaces: 5ilence Studio / Engine / Agent; keep existing `apps/studio` + `silence-engine` paths

### Claude's Discretion
- Exact gap analysis of what already works vs missing in brownfield Studio/Engine for LOOP-01
- How apply/reject UX is surfaced in Studio (diff panel wiring) if partially present
- Whether Walking Skeleton for Phase 1 emphasizes one end-to-end tracer path (open workspace → one edit tool → diff apply) before broadening tool coverage
- Eval/task selection for METR-04 (shell/ConPTY reliability) without pulling full Phase 3 eval suite
- Permission remember storage format/location per workspace

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product / phase
- `docs/PRD.md` — year-1 jobs, NFR Windows, non-goals
- `.planning/ROADMAP.md` — Phase 1 goal, success criteria, REQ mapping
- `.planning/REQUIREMENTS.md` — LOOP-01, LOOP-03, WIN-*, PERM-01, NET-01, METR-04
- `.planning/PROJECT.md` — core value and planning constraints

### Architecture
- `docs/adr/0001-architecture.md` — Electron + Rust sidecar, JSON-RPC, Monaco, protocol
- `AGENTS.md` — Cursor build playbook (stack, commands, hard constraints)

### UI / chat contracts
- `docs/frontend/chat.md` — ChatPane structure, Copy, fork limits
- `docs/frontend/layout.md` — shell layout (when touching Studio chrome)
- `docs/README.md` — brand ↔ path map (Studio / Engine)

### Threat / security
- `docs/threat-model.md` — local agent trust boundaries, permission, no LAN bind

</canonical_refs>

<specifics>
## Specific Ideas

- Phase 1 success criteria from ROADMAP (observable):
  1. Workspace + prompt; tools only via Engine
  2. Diff apply/reject via tool runtime + audit
  3. Permission `ask` with remember; no silent YOLO
  4. Separate Engine, local-only IPC, ConPTY/PowerShell reliable for long path + Vietnamese UTF
- Brownfield: plan against existing `apps/studio` + `crates/runtime` (and related crates), not greenfield scaffolding
- Tracer-first / MVP: prefer one production-quality end-to-end trusted edit path before expanding

</specifics>

<deferred>
## Deferred Ideas

- Plan mode Approve-before-edit → Phase 2 (LOOP-02)
- Cloud/Auto, secret redaction depth, eval ≥70%, TTFT, Auto cost → Phase 3
- MCP allowlist → Phase 4
- Sub-agent explore/implement/review → Phase 5
- Cost/token + audit trail UI → Phase 6
- v2: `@` mentions, skills/hooks, Ask/Debug/Review runtime, Git commit/worktree, CLI, RAG, Tab/LSP
- Non-goals: VS Code fork, marketplace, fleet VMs, multi-tenant control plane, GSD-in-product-UI

</deferred>

---

*Phase: 01-trusted-edit-loop*
*Context gathered: 2026-11-05 via PRD Express Path*
