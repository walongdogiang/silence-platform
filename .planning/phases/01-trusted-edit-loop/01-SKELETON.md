# Walking Skeleton — 5ilence

**Phase:** 1
**Generated:** 2026-11-05

## Capability Proven End-to-End

A Windows developer opens a local workspace in 5ilence Studio, prompts the agent, reviews one staged file edit as a Diff, and Apply or Reject under ask permission — with Engine as a separate process on local-only IPC.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| UI framework | Electron + React Studio (`apps/studio`) | ADR 0001; brownfield Chat Workspace already exists |
| Harness / agent loop | Rust `silence-engine` (crates/runtime + tools + sandbox) | Owns tools, permission, audit; UI crash must not kill agent (WIN-02) |
| IPC | JSON-RPC newline frames; Studio spawn `--tcp 127.0.0.1:0`; named pipe path when not `--tcp` | NET-01 local-only; no napi-rs primary IPC |
| Editor / diff surface | Monaco via existing DiffPane + ChatPane Diff banner | No VS Code fork year 1; tracer keeps banner Apply/Reject |
| File mutation semantics | Stage-then-apply (`write`/`edit` propose; `diff.apply` commits; `diff.reject` discards) | Locked LOOP-01 / D-01 — review then apply/reject |
| Permission | Default `ask`; remember by tool name into Engine-enforced workspace allowlist | PERM-01 / D-03; not renderer `localStorage` as sole gate |
| Interactive terminal | ConPTY via `portable-pty` + `powershell.exe` | WIN-01; distinct from non-interactive `shell` tool |
| Shell tool | Non-PTY `powershell -Command` + Job Object | Separate path from ConPTY; METR-04 must cover both |
| Protocol | Dual `crates/protocol` + `packages/protocol` (+ Studio type copies) | protocol.mdc; keep PROTOCOL_VERSION in sync |
| Directory layout | Monorepo: `apps/studio`, `crates/*`, `packages/protocol`, `evals/v0` | Existing brownfield; do not greenfield rewrite |
| Local run | `npm run studio` (Engine child); Engine CLI `npm run runtime`; tests via `cargo test -p …` / `.\scripts\cargo-msvc.bat` | Documented in AGENTS.md |

## Stack Touched in Phase 1

- [x] Project scaffold (framework, build, lint, test runner) — brownfield already present
- [x] Routing — Studio Chat Workspace session + RPC methods (`session.*`, `diff.*`)
- [x] Database — N/A relational; workspace `.silence/` + Engine `audit.jsonl` are the durable stores
- [x] UI — Permission Ask + Diff Apply/Reject wired to Engine RPC
- [x] Deployment — local full-stack: `npm run studio` spawns `silence-engine` on loopback

## Out of Scope (Deferred to Later Slices)

- Plan Approve-before-edit (Phase 2 / LOOP-02)
- Cloud provider depth, Auto routing, secret redaction, TTFT/cost/eval ≥70% (Phase 3)
- MCP allowlist UI (Phase 4)
- Sub-agent explore/implement/review (Phase 5)
- Cost/token + audit trail panels (Phase 6)
- Multi-file Diff queue / unified hunk IDE
- Named-pipe cutover for Studio production (TCP loopback remains NET-01 compliant)
- GSD/BMAD/ECC in product UI; VS Code fork; LAN bind; silent YOLO product path

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: Plan-then-edit — Approve blocks edits until plan accepted
- Phase 3: Cloud model and Auto — providers, Auto routing, redaction, latency/cost/eval targets
- Phase 4: Workspace MCP — stdio servers via allowlist
- Phase 5: Sub-agent delegation — explore/implement/review with parent summary
- Phase 6: Cost and audit — session usage + audit trail UI
