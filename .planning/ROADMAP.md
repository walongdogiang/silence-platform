# Roadmap: 5ilence

## Overview

Year-1 MVP delivers the six locked Studio + Engine jobs as vertical slices on the existing brownfield monorepo (`apps/studio`, `silence-engine`): trusted prompt→tool→diff on Windows, plan-approve before edits, cloud/Auto models with measurable quality/cost/latency, workspace MCP allowlists, sub-agent delegation, and session cost/audit visibility. v2 backlog (context mentions, modes, Git/CLI, index, full LSP) stays deferred.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Trusted edit loop** - Open workspace, prompt, tool/diff apply-reject under ask permissions on Windows
- [ ] **Phase 2: Plan-then-edit** - Agent proposes a plan; user Approves before edits are allowed
- [ ] **Phase 3: Cloud model and Auto** - Attach cloud providers, Auto routing, redaction, latency/cost/eval targets
- [ ] **Phase 4: Workspace MCP** - Enable MCP stdio servers per workspace allowlist
- [ ] **Phase 5: Sub-agent delegation** - Delegate explore/implement/review and receive a summary
- [ ] **Phase 6: Cost and audit** - View session token/cost usage and audit trail

## Phase Details

### Phase 1: Trusted edit loop

**Goal:** As a Windows developer, I want to open a local workspace, prompt the agent, review staged file diffs and Apply or Reject under ask permissions, so that Engine-only edits stay trusted on local-only IPC with reliable PowerShell.
**Mode:** mvp
**Depends on:** Nothing (first phase)
**Requirements:** LOOP-01, LOOP-03, WIN-01, WIN-02, PERM-01, NET-01, METR-04
**Success Criteria** (what must be TRUE):
  1. User opens a workspace and sends a prompt; the agent reads, greps, edits files, and runs shell through Engine — the Studio renderer never calls the model or tools directly.
  2. User reviews proposed file changes as diffs and can apply or reject; every change goes through the tool runtime with audit.
  3. Risky tools prompt with permission default `ask` (rememberable per workspace); there is no silent YOLO path.
  4. Engine runs as a separate process on local-only IPC (named pipe / loopback); UI crash does not kill the agent, and ConPTY + PowerShell handles long paths and Vietnamese UTF without breaking shell tools.

**Plans:** 1/4 plans executed
Plans:
**Wave 1**
- [x] 01-01-PLAN.md — Wave 0 Nyquist failing tests (stage, permission, UTF/long-path, bind)

**Wave 2** *(blocked on Wave 1 completion)*
- [ ] 01-02-PLAN.md — Walking Skeleton tracer: stage-then-apply Diff Apply/Reject + audit

**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 01-03-PLAN.md — PERM-01 remember (name_hint + workspace store + Studio checkbox)
- [ ] 01-04-PLAN.md — WIN/NET/METR-04 shell UTF, ConPTY keep, loopback bind guard

**UI hint**: yes

### Phase 2: Plan-then-edit

**Goal:** User can require an approved plan before the agent is allowed to edit the workspace.
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** LOOP-02
**Success Criteria** (what must be TRUE):
  1. In plan mode, the agent produces a readable plan before any workspace edits.
  2. Until the user Approves, edit tools remain blocked for that session.
  3. After Approve, the same session can proceed to edits under the approved plan (still via diff + permission rules from Phase 1).

**Plans:** TBD
**UI hint**: yes

### Phase 3: Cloud model and Auto

**Goal:** User can attach cloud (OpenAI-compatible) models and enable Auto routing with secret redaction and year-1 latency, cost, and eval targets.
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** MODL-01, MODL-02, SEC-01, METR-01, METR-02, METR-03
**Success Criteria** (what must be TRUE):
  1. User configures a cloud / OpenAI-compatible provider and chats without company-only model lock-in.
  2. With Auto enabled, the harness routes among fast / mid / strong; median cost per task is at least 30% cheaper than strong-only.
  3. Secrets are redacted before prompts or tool results are sent to the model.
  4. On a healthy network, time-to-first-token is under 1.5s; Auto achieves ≥70% pass rate on the 20-task v0 eval suite.

**Plans:** TBD
**UI hint**: yes

### Phase 4: Workspace MCP

**Goal:** User can enable MCP stdio servers for a workspace via allowlist so the agent can use external tools safely.
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** MCP-01
**Success Criteria** (what must be TRUE):
  1. User enables MCP stdio servers for a workspace through an allowlist (Git, tickets, CI, DB tools, and similar).
  2. During a session, the agent can call tools from allowlisted MCP servers.
  3. Servers or tools outside the workspace allowlist cannot be used.

**Plans:** TBD
**UI hint**: yes

### Phase 5: Sub-agent delegation

**Goal:** User can delegate explore / implement / review work to a sub-agent and receive a usable summary in the parent session.
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** SUBA-01
**Success Criteria** (what must be TRUE):
  1. User (or parent agent) can start a sub-agent for explore, implement, or review.
  2. Parent session shows a summary of the sub-agent’s work when it finishes.
  3. Sub-agent tool use still goes through Engine permission, diff, and audit boundaries (no bypass of the trusted loop).

**Plans:** TBD
**UI hint**: yes

### Phase 6: Cost and audit

**Goal:** User can inspect session cost/token usage and the audit trail for what the agent did.
**Mode:** mvp
**Depends on:** Phase 1, Phase 3
**Requirements:** COST-01, AUDT-01
**Success Criteria** (what must be TRUE):
  1. User opens a session cost/token view and sees usage for the current session.
  2. User opens the audit trail and can inspect tool calls and related decisions for the session.
  3. Cost and audit surfaces are available in Studio for the local session (not a remote control-plane requirement).

**Plans:** TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Trusted edit loop | 1/4 | In Progress | - |
| 2. Plan-then-edit | 0/TBD | Not started | - |
| 3. Cloud model and Auto | 0/TBD | Not started | - |
| 4. Workspace MCP | 0/TBD | Not started | - |
| 5. Sub-agent delegation | 0/TBD | Not started | - |
| 6. Cost and audit | 0/TBD | Not started | - |

## Coverage summary

| Requirement | Phase |
|-------------|-------|
| LOOP-01 | 1 |
| LOOP-02 | 2 |
| LOOP-03 | 1 |
| MODL-01 | 3 |
| MODL-02 | 3 |
| MCP-01 | 4 |
| SUBA-01 | 5 |
| COST-01 | 6 |
| AUDT-01 | 6 |
| WIN-01 | 1 |
| WIN-02 | 1 |
| PERM-01 | 1 |
| SEC-01 | 3 |
| NET-01 | 1 |
| METR-01 | 3 |
| METR-02 | 3 |
| METR-03 | 3 |
| METR-04 | 1 |

**Coverage:** 18/18 v1 requirements mapped. v2 / Out of Scope deferred (not phased).
