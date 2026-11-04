# Phase 1: Trusted edit loop - Research

**Researched:** 2026-11-05
**Domain:** Brownfield Studio (Electron) + Engine (`silence-engine`) trusted prompt → tool → diff apply/reject on Windows
**Confidence:** HIGH (codebase seams); MEDIUM (Windows ConPTY/UTF ecosystem docs)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- User opens a workspace, prompts AI; agent reads/greps/edits files and runs shell; user reviews diff then apply/reject (LOOP-01)
- UI never calls the model; every file change goes through the tool runtime with diff + audit (LOOP-03)
- Success: Studio renderer never calls model or tools directly — only Engine via RPC
- Permission default = `ask` (rememberable per workspace); no silent YOLO (PERM-01)
- Risky tools must prompt before execution
- Default terminal ConPTY + PowerShell; long paths; UTF-16/UTF-8 including Vietnamese must not break (WIN-01, METR-04)
- Engine (Rust sidecar) is a separate process — UI crash does not kill the agent (WIN-02)
- IPC local-only (named pipe / loopback); no LAN bind (NET-01)
- Electron + React Studio; Rust `silence-engine` owns harness
- JSON-RPC over named pipe (Windows) or TCP `127.0.0.1` for dev
- No napi-rs as primary IPC; Monaco editor (no VS Code fork year 1)
- Protocol dual-sourced: `packages/protocol` + `crates/protocol`
- Cloud models are the year-1 direction overall, but Phase 1 only needs a working prompt→tool→diff path (provider wiring depth belongs mainly to Phase 3)
- GSD/BMAD/ECC must not ship into product UI
- Brand surfaces: 5ilence Studio / Engine / Agent; keep existing `apps/studio` + `silence-engine` paths

### Claude's Discretion
- Exact gap analysis of what already works vs missing in brownfield Studio/Engine for LOOP-01
- How apply/reject UX is surfaced in Studio (diff panel wiring) if partially present
- Whether Walking Skeleton for Phase 1 emphasizes one end-to-end tracer path (open workspace → one edit tool → diff apply) before broadening tool coverage
- Eval/task selection for METR-04 (shell/ConPTY reliability) without pulling full Phase 3 eval suite
- Permission remember storage format/location per workspace

### Deferred Ideas (OUT OF SCOPE)
- Plan mode Approve-before-edit → Phase 2 (LOOP-02)
- Cloud/Auto, secret redaction depth, eval ≥70%, TTFT, Auto cost → Phase 3
- MCP allowlist → Phase 4
- Sub-agent explore/implement/review → Phase 5
- Cost/token + audit trail UI → Phase 6
- v2: `@` mentions, skills/hooks, Ask/Debug/Review runtime, Git commit/worktree, CLI, RAG, Tab/LSP
- Non-goals: VS Code fork, marketplace, fleet VMs, multi-tenant control plane, GSD-in-product-UI
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LOOP-01 | Workspace → prompt → read/grep/edit/shell → review diff → apply/reject | Brownfield loop mostly wired; **critical gap**: `write`/`edit` mutate disk before Apply; Reject only clears UI. Stage-then-`diff.apply` (or Reject-reverts-`before`) required. |
| LOOP-03 | UI never calls model; file changes via tool runtime + audit | Renderer uses `window.silence.rpc` only; audit JSONL exists. Keep boundary; ensure Apply path audits. |
| WIN-01 | ConPTY + PowerShell default; long paths; Vietnamese UTF | Interactive PTY uses `portable-pty` + `powershell.exe`; **shell tool** uses non-PTY `powershell -Command`. Need reliability tests + encoding/cwd hardening. |
| WIN-02 | Engine separate process; UI crash ≠ agent death | Already true: Electron spawns `silence-engine` child. Verify crash isolation remains; do not fold harness into renderer. |
| PERM-01 | Permission default `ask`, remember per workspace; no silent YOLO | Session creates with `"ask"`; Ask UI exists. **Bugs**: `remember` never persists tool name (`name_hint: None`); no workspace disk store; Allow always sets `remember: allow`. |
| NET-01 | Local-only IPC; no LAN bind | Studio uses `--tcp 127.0.0.1:0`; pipe path exists when not `--tcp`. Guard against `0.0.0.0` / `*` binds. |
| METR-04 | Shell/ConPTY reliable on Windows | No dedicated UTF/long-path shell eval today. Add focused unit + 1–2 harness tasks; not full 20-task suite. |
</phase_requirements>

## Summary

Phase 1 is a **brownfield gap-close**, not a greenfield harness. Studio already opens a workspace, creates an Engine session with `permission: "ask"`, prompts via `session.prompt`, surfaces permission and diff banners, and talks to a separately spawned `silence-engine` over loopback JSON-RPC. Tools (`read`/`grep`/`write`/`edit`/`shell`), audit append, Job Object wrap for shell PIDs, and ConPTY-backed interactive terminal already exist under `crates/{runtime,tools,sandbox,protocol}` and `apps/studio`.

The phase fails its locked LOOP-01 semantics today because mutating file tools **write to disk immediately** after permission Allow, while UI Apply re-writes the same content and Reject **does not restore** `before`. PERM-01 is incomplete: remember never lands on the session allowlist from RPC, and nothing persists across sessions per workspace. WIN-01 / METR-04 need explicit Windows shell encoding and long-path coverage; interactive ConPTY and non-interactive `shell` are two different execution paths.

**Primary recommendation:** Ship a Walking Skeleton tracer — open workspace → one `edit`/`write` proposal → Diff Apply/Reject that actually controls disk → ask permission with working remember-to-workspace — then harden shell UTF/long-path and IPC bind guards; do not broaden MCP/plan/sub-agent/cost UI.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Open workspace / pick folder | Browser / Client (Electron main dialog) | API / Backend (Engine `fs.tree`) | OS folder picker stays in main; tree listing is Engine-jailed |
| Chat prompt / stream UI | Browser / Client (renderer) | — | Display only; no model/tools |
| Model + agent loop + tools | API / Backend (`silence-engine` / `runtime`) | — | LOOP-03: harness owns model and tools |
| Permission ask / decide | API / Backend | Browser / Client (banner UX) | Decision truth in Engine; UI only answers RPC |
| Diff propose / apply / reject | API / Backend (tool + `diff.apply`) | Browser / Client (DiffPane / banner) | Disk mutation must be Engine-gated |
| Interactive terminal (ConPTY) | API / Backend (`pty.rs`) | Browser / Client (xterm) | PTY owned by Engine; UI is I/O surface |
| Non-interactive `shell` tool | API / Backend (`silence-tools`) | Database / Storage (workspace cwd jail) | Job Object + workspace root |
| Audit log | Database / Storage (`audit.jsonl` under data dir) | API / Backend | Append-only; Phase 6 UI only |
| IPC bind policy | API / Backend + Electron main | — | Loopback / named pipe only |
| Permission remember (workspace) | Database / Storage (workspace-scoped file) | API / Backend (session allowlist) | PERM-01 “per workspace” |

## Project Constraints (from .cursor/rules/)

| Rule | Actionable directives for Phase 1 |
|------|-----------------------------------|
| `AGENTS.md` / `frontend-boundary.mdc` | Renderer never calls model; fs/shell/session only via `window.silence.rpc` → Engine |
| `rust-harness.mdc` | ConPTY, long paths, UTF-8/UTF-16; Job Object kill-on-close; cwd jail; mutating tools ask + audit; no silent YOLO; bind loopback/pipe only; no napi-rs primary IPC; harness change ⇒ eval task; `cargo test -p silence-tools` when touching tools |
| `protocol.mdc` | Change `packages/protocol` and `crates/protocol` together; keep `PROTOCOL_VERSION` identical; Studio `types.ts` / `global.d.ts` are copies until package import lands |
| `frontend-shell.mdc` | Hide Diff/Changes until `diff \|\| file`; keep graphite+copper tokens; Chat Workspace layout contracts |
| `frontend-composer.mdc` | Follow when touching composer (mode chips already include Plan — Phase 2 owns plan semantics) |
| `gsd-commit.mdc` | GSD execute/plan may commit; never commit `.env` / secrets / `node_modules` |
| `docs/threat-model.md` | Default ask; path jail; no LAN bind; YOLO opt-in only |
| `docs/frontend/chat.md` | Diff/permission are separate protocol channels; Copy must not include tool/diff/permission |

## Brownfield Gap Analysis (discretion)

### Already works (HIGH — verified in tree)

| Seam | Evidence |
|------|----------|
| Separate Engine process + loopback TCP | `apps/studio/src/main/index.ts` spawns `serve --tcp 127.0.0.1:0` |
| Named pipe server path | `crates/runtime/src/main.rs` `\\.\pipe\silence-{pid}` when not `--tcp` |
| Session create default Ask in UI | `createLiveSession` passes `permission: "ask"` |
| PermissionMode enum | `Ask`, `Allowlist`, `Yolo` with `#[default] Ask` in `crates/protocol/src/lib.rs` |
| Ask prompt + Allow/Deny UI | `SessionEvent::Permission` + ChatPane banner |
| Tools + workspace jail | `silence_tools::{read,write,edit,grep,shell}`; `Workspace::resolve` via `dunce::canonicalize` |
| Diff events + Apply RPC + Reject handler | `SessionEvent::Diff`; `diff.apply` → `write`; `onRejectDiff={() => setDiff(null)}` |
| Interactive ConPTY terminal | `portable-pty` + `powershell.exe` in `pty.rs` |
| Audit append on tools | `AuditLog` JSONL under data dir |
| Job Object on shell PID | `silence_sandbox::wrap_pid` |

### Gaps blocking phase success

| Gap | REQ | Severity | Fix direction |
|-----|-----|----------|---------------|
| File tools write disk before Apply; Reject does not revert | LOOP-01 | **Blocker** | Stage: `write`/`edit` emit Diff + hold contents until `diff.apply`; Reject discards (or restore `before` if auto-applied) |
| `session.permission` passes `name_hint: None` so remember never fills allowlist | PERM-01 | **Blocker** | Pass tool name from pending map / params; UI checkbox for remember |
| No workspace-persistent permission remember | PERM-01 | High | Load/save allowlist keyed by workspace (see Discretion recommendation) |
| `answerPerm` sets `remember: allow` always | PERM-01 | Medium | Separate Remember control; default remember-on-allow is OK only if storage correct |
| Shell tool ≠ ConPTY; UTF/long-path untested | WIN-01, METR-04 | High | Unit tests + 1–2 evals; set UTF-8 console where needed; long-path fixture |
| Diff UX is banner + DiffPane `after` only (no unified hunk view) | LOOP-01 | Medium (discretion) | Tracer can keep banner Apply/Reject; polish later |
| No bind-address regression test | NET-01 | Medium | Assert TCP bind host is loopback; refuse non-loopback |
| Eval runner uses `PermissionMode::Yolo` | — | Note | Keep for unattended evals; product path must remain Ask |

### Discretion recommendations

1. **Walking Skeleton (recommended):** One production tracer — workspace open → prompt → `edit` staged Diff → user Apply writes + audit → Reject leaves disk unchanged → permission Ask with remember persisted for that workspace. Defer multi-file queue polish, Monaco side-by-side hunk UI, and shell path expansion beyond reliability fixes.
2. **Apply/reject UX:** Keep ChatPane banner + existing DiffPane for tracer; do not rebuild DiffPane as a full review IDE in Phase 1.
3. **METR-04 evals:** Prefer `cargo test -p silence-tools` (UTF Vietnamese round-trip, path >260 via `\\?\` or enabled long paths) + optional interactive PTY smoke; add **at least 1** (at most 2) `evals/v0` task definitions that exercise `shell` UTF and/or staged-edit (e.g. `echo` Vietnamese + create file under nested long path). Live `npm run evals` may skip without keys. Do **not** require full 20-task / ≥70% suite (Phase 3).
4. **Permission remember storage:** Store under workspace `.silence/permissions.json` (or Engine data_dir map keyed by canonical workspace path) with schema `{ "allow_tools": ["edit","write","shell"] }`. Load into session allowlist on `session.create`. Prefer workspace-local file so clone/share semantics stay obvious; do not use renderer `localStorage` as source of truth (bypassable / not Engine-enforced).

## Standard Stack

### Core (already in monorepo — do not replace)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Electron + React Studio | `apps/studio` workspace | UI shell, chat, Monaco, xterm | ADR 0001 locked |
| `silence-engine` (Rust) | workspace crate | Agent loop, RPC, PTY, audit | ADR / AGENTS.md |
| `silence-tools` | workspace | read/write/edit/grep/shell | Existing tool runtime |
| `silence-protocol` + `@silence/protocol` | `PROTOCOL_VERSION` `"0.1.1"` | RPC/events/session types | Dual-source contract |
| `silence-sandbox` | workspace | Windows Job Object | Kill-on-close for shell |
| `portable-pty` | `"0.8"` (resolved ~0.8.1; crates.io latest 0.9.0) | ConPTY interactive terminal | Already integrated; OK legitimacy |
| `dunce` | workspace `"1"` (1.0.5) | Canonicalize / de-UNC paths | Jail + Windows path hygiene |
| `tokio` | workspace | async TCP/pipe/process | Engine runtime |
| Monaco (`@monaco-editor/react`) | Studio dep | Editor / diff surface | ADR — no VS Code fork |
| xterm.js | Studio dep | Terminal view | Pairs with Engine PTY |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `tempfile` | `"3"` (dev) | Tool unit test workspaces | `cargo test -p silence-tools` |
| `ignore` | workspace | Walk/glob respecting gitignore | Existing grep/glob |
| PowerShell | Host OS (`powershell.exe` / Windows PowerShell 5.1 observed on research machine) | Default shell | WIN-01; prefer UTF-8-safe invocation |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Stage-then-apply for files | Auto-apply after Ask + Reject-reverts | Revert is harder under concurrent edits; staging matches locked “review then apply” wording |
| Workspace `.silence/permissions.json` | Engine global data_dir only | Global is cleaner for multi-root later; workspace file is clearer for PERM-01 “per workspace” |
| Upgrade `portable-pty` 0.9 | Stay on 0.8.x | Upgrade only if ConPTY bug blocks METR-04 |
| Token-auth on loopback TCP | Bind-only loopback | Token improves local multi-user threat; not required by NET-01 wording; defer unless security gate escalates |

**Installation:** None required for tracer — no new packages.

**Version verification:** `portable-pty` 0.8.1 in tree / 0.9.0 latest on crates.io; `dunce` 1.0.5 — both legitimacy `OK` via `gsd_run query package-legitimacy check`.

## Package Legitimacy Audit

> Phase 1 should **not** install new external packages. Audit covers libraries the phase will continue to rely on.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| portable-pty | crates | since 2019 | ~1.2M/wk | github.com/wezterm/wezterm | OK | Approved (keep 0.8.x) |
| dunce | crates | since 2017 | ~10M/wk | gitlab.com/kornelski/dunce | OK | Approved |
| ignore | crates | since 2016 | ~4M/wk | github.com/BurntSushi/ripgrep | OK | Approved |
| tempfile | crates | since 2015 | ~18M/wk | github.com/Stebalien/tempfile | OK | Approved (dev) |

**Packages removed due to [SLOP] verdict:** none  
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```text
[User] → Studio renderer (ChatPane / DiffPane / xterm)
            │  window.silence.rpc / onEvent only
            ▼
       Electron main (preload bridge, folder pick, spawn)
            │  JSON-RPC newline frames
            ▼
       silence-engine (separate process)
         ├─ session.prompt → agent loop → model gateway
         ├─ ask_perm → SessionEvent::Permission → UI decide
         ├─ tools: read/grep (immediate)
         │         write/edit → **staged Diff** → diff.apply / reject
         │         shell → PowerShell (+ Job Object)
         ├─ terminal.start → portable-pty ConPTY → SessionEvent::Terminal
         ├─ audit.jsonl append
         └─ bind: 127.0.0.1:0 (Studio) or \\.\pipe\silence-<pid>
```

### Recommended Project Structure (touch points only)

```text
apps/studio/src/
  main/index.ts              # spawn Engine, loopback only
  renderer/App.tsx           # session, perm, apply/reject wiring
  renderer/components/ChatPane.tsx  # Ask + Diff banners
  renderer/components/DiffPane.tsx  # changes surface
crates/runtime/src/
  agent.rs                   # ask_perm, tool dispatch, staging hook
  rpc.rs                     # session.permission name_hint; diff.apply/reject
  pty.rs                     # ConPTY interactive
  main.rs                    # bind policy
crates/tools/src/lib.rs      # stage vs commit writes; shell UTF/long-path
crates/sandbox/src/lib.rs    # Job Object (keep)
crates/protocol/ + packages/protocol/  # dual sync if new RPC/events
evals/v0/manifest.yaml       # optional 1–2 METR-04 tasks
```

### Pattern 1: Stage-then-commit file mutations
**What:** Mutating file tools compute `FileDiff` and emit `SessionEvent::Diff` **without** `fs::write` until `diff.apply`. Reject drops the pending proposal (and must not leave disk changed).
**When to use:** `write` / `edit` in product Ask mode (LOOP-01).
**Example:**
```rust
// Target shape for planner/executor — staging, not current write()/edit()
// Current write() calls std::fs::write immediately [VERIFIED: crates/tools/src/lib.rs:254-282]
pub struct PendingEdit {
    pub path: String,
    pub before: String,
    pub after: String,
}
// On tool call: insert PendingEdit in session; emit Diff; return "proposed edit …"
// On diff.apply: std::fs::write + audit append
// On diff.reject (new or UI-only): remove PendingEdit; no disk write
```

### Pattern 2: Permission remember via Engine
**What:** `decide_permission` must receive the tool name; on `remember`, push to session allowlist **and** persist workspace allowlist.
**When to use:** Every Allow from Ask UI.
**Anti-pattern:** Passing `None` for `name_hint` from RPC (current code).

### Pattern 3: Dual protocol sync
**What:** Any new `diff.reject` method or permission fields update Rust + TS protocol + Studio copies together (`protocol.mdc`).

### Anti-Patterns to Avoid
- **Silent disk write then cosmetic Diff:** Violates locked apply/reject semantics.
- **Renderer-local permission store as sole gate:** Engine must enforce.
- **Binding `0.0.0.0` “for convenience”:** Violates NET-01 / threat model.
- **Folding tools into Electron main / napi:** Violates ADR and WIN-02 isolation.
- **Full 20-eval gate for Phase 1:** Deferred metrics live in Phase 3; METR-04 is targeted reliability.
- **Shipping GSD into Studio UI.**

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Interactive Windows PTY | Custom ConPTY FFI | Existing `portable-pty` | CreatePseudoConsole + UTF-8/VT already wrapped |
| Path jail / UNC mess | Ad-hoc string checks | `dunce::canonicalize` + `starts_with` root | Edge cases (symlinks, `\\?\`) |
| Process tree cleanup | Manual taskkill | `silence_sandbox` Job Object | Kill-on-job-close |
| JSON-RPC framing | New IPC protocol | Existing newline JSON-RPC | Dual protocol already shipped |
| Diff data model | New patch format | Existing `FileDiff` / `SessionEvent::Diff` | Wire Apply/Reject correctly first |
| Test workspace fixtures | Custom temp dirs | `tempfile` in unit tests | Already in `silence-tools` tests |

**Key insight:** The product already has the right components; Phase 1 is correcting **control flow** (stage/apply, remember persistence, Windows reliability proofs), not inventing a new stack.

## Common Pitfalls

### Pitfall 1: Apply/Reject theater
**What goes wrong:** UI shows Apply/Reject but disk already changed; Reject only clears React state.
**Why it happens:** Tools historically auto-wrote and emitted Diff for display.
**How to avoid:** Integration test: after staged edit, file bytes == `before` until Apply; after Reject, still `before`.
**Warning signs:** `onRejectDiff={() => setDiff(null)}` without Engine call; `write`/`edit` calling `fs::write` before Apply.

### Pitfall 2: Remember that never remembers
**What goes wrong:** User Allows with remember; next `edit` prompts again every time; nothing survives restart.
**Why it happens:** `rpc.rs` passes `name_hint: None`; allowlist only in-memory.
**How to avoid:** Store name on pending permission; persist workspace allowlist; unit-test second call skips Ask.

### Pitfall 3: ConPTY vs shell tool confusion
**What goes wrong:** Team “fixes ConPTY” in `pty.rs` but agent `shell` tool still breaks on UTF/long paths.
**Why it happens:** Two execution paths.
**How to avoid:** METR-04 checklist covers **both** interactive PTY and `silence_tools::shell`.

### Pitfall 4: PowerShell encoding surprises
**What goes wrong:** Vietnamese text mojibake; files written with unexpected BOM (Windows PowerShell 5.1 `UTF8`).
**Why it happens:** Host is Windows PowerShell 5.1; PS7 differs (`utf8NoBOM` default).
**How to avoid:** Prefer explicit UTF-8 handling in tool output/`fs::write` (Rust UTF-8) for file tools; for shell, set console output encoding / use byte-safe capture; test with Vietnamese fixtures. [CITED: learn.microsoft.com PowerShell about_Character_Encoding]

### Pitfall 5: Long path denial
**What goes wrong:** Nested workspace paths >260 fail without `\\?\` or OS long-path opt-in.
**Why it happens:** Legacy Win32 MAX_PATH; apps must opt in. [CITED: learn.microsoft.com maximum-file-path-limitation]
**How to avoid:** Fixture + test; use extended path where APIs require; document OS long-path policy if needed.

### Pitfall 6: Protocol drift
**What goes wrong:** Engine emits new fields; Studio types stale.
**How to avoid:** Edit `crates/protocol` + `packages/protocol` + Studio copies in one change set.

### Pitfall 7: Eval YOLO leaking into product defaults
**What goes wrong:** Product session accidentally YOLO.
**Why it happens:** `eval_runner` uses `PermissionMode::Yolo` for unattended runs.
**How to avoid:** Keep eval YOLO isolated; Studio `session.create` stays `"ask"`.

## Code Examples

### Current permission modes (verbatim)
```rust
// Source: crates/protocol/src/lib.rs:93-100 [VERIFIED]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum PermissionMode {
    #[default]
    Ask,
    Allowlist,
    Yolo,
}
```

### Current permission decide RPC bug (verbatim call site)
```rust
// Source: crates/runtime/src/rpc.rs:87-96 [VERIFIED]
"session.permission" => {
    let p: PermissionDecision = serde_json::from_value(req.params)?;
    agent::decide_permission(
        &state.ctx,
        &p.session_id,
        &p.request_id,
        p.allow,
        p.remember,
        None, // ← name_hint always None — remember cannot push tool name
    )
```

### Current write applies immediately (verbatim)
```rust
// Source: crates/tools/src/lib.rs:271-282 [VERIFIED]
let before = std::fs::read_to_string(&path).unwrap_or_default();
let after = args["contents"].as_str().unwrap_or("").to_string();
std::fs::write(&path, &after)?;
Ok(ToolOutput {
    ok: true,
    output: format!("wrote {}", ws.rel(&path)),
    diff: Some(FileDiff {
        path: ws.rel(&path),
        before,
        after,
    }),
})
```

### Studio Reject currently UI-only (verbatim)
```tsx
// Source: apps/studio/src/renderer/App.tsx:830-831 [VERIFIED]
onApplyDiff={() => void applyDiff()}
onRejectDiff={() => setDiff(null)}
```

### Studio IPC bind (verbatim)
```ts
// Source: apps/studio/src/main/index.ts:136-138 [VERIFIED]
child = spawn(
  bin,
  ["serve", "--tcp", "127.0.0.1:0", "--config", path.join(repoRoot, "config/models.yaml")],
```

### Interactive ConPTY shell (verbatim)
```rust
// Source: crates/runtime/src/pty.rs:23-29 [VERIFIED]
let mut cmd = if cfg!(windows) {
    CommandBuilder::new("powershell.exe")
} else {
    CommandBuilder::new("bash")
};
cmd.cwd(cwd);
let _child = pair.slave.spawn_command(cmd).context("spawn pty cmd")?;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Auto-write + display Diff | Stage Diff → Apply commits | Phase 1 target | Matches LOOP-01 |
| Session-only allowlist | Workspace-persisted allowlist | Phase 1 target | PERM-01 |
| Assume ConPTY covers shell tool | Test both PTY and `shell` tool | Phase 1 METR-04 | Real Windows reliability |
| Greenfield desktop | Brownfield Studio + Engine | Already | Plan fills gaps only |

**Deprecated/outdated:**
- Treating Diff banner as sufficient for LOOP-01 without Engine-enforced apply/reject
- Relying on `localStorage` for security-sensitive permission state

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Staging file tools (not auto-apply + revert) is the intended LOOP-01 semantics | Architecture | If product owners prefer auto-apply-after-Ask, Reject must implement restore-`before` instead — still a plan task |
| A2 | `.silence/permissions.json` is acceptable on-disk format | Discretion / PERM-01 | Alternate Engine data_dir map may be preferred — low code risk if schema stays simple |
| A3 | Phase 1 can keep Studio on TCP `127.0.0.1:0` without named-pipe cutover | NET-01 | Named pipe may be preferred for ACLs later; loopback still satisfies “no LAN bind” |
| A4 | Windows PowerShell 5.1 remains the default shell on target machines | WIN-01 | PS7-only assumptions could break encoding tests |
| A5 | No new crates needed for Phase 1 | Standard Stack | Unexpected ConPTY bug might force `portable-pty` bump |

## Open Questions

1. **Staging vs revert-on-reject** `(RESOLVED)`
   - What we know: Locked text says review then apply/reject; code auto-writes today.
   - What's unclear: Product preference if Ask already approved the mutation.
   - Recommendation: Prefer staging (Apply is the disk commit). Planner should lock this in PLAN.md Wave 0.
   - **RESOLVED: stage-then-apply** — Apply commits pending bytes; Reject leaves disk at `before` (D-01; plans 01-01 / 01-02). Not auto-apply+revert.

2. **Permission remember granularity** `(RESOLVED)`
   - What we know: Allowlist matches tool name string today.
   - What's unclear: Remember per-tool vs per-tool+args pattern.
   - Recommendation: Remember by tool name (`edit`, `write`, `shell`) for Phase 1; arg-scoped keys later.
   - **RESOLVED: tool name** — remember keys are tool names only for Phase 1 (PERM-01 / D-03; plan 01-03). Arg-scoped keys deferred.

3. **Named pipe for Studio production** `(RESOLVED)`
   - What we know: ADR prefers named pipe; Studio uses TCP loopback ephemeral.
   - What's unclear: Whether Phase 1 must switch Studio to named pipe.
   - Recommendation: Keep TCP loopback for Phase 1 if bind guard + process isolation pass; track pipe as hardening follow-up (still NET-01 compliant).
   - **RESOLVED: keep TCP 127.0.0.1 for Studio in Phase 1; named pipe optional later** — Studio spawn stays `serve --tcp 127.0.0.1:0` with loopback bind guard (NET-01 / D-06; plan 01-04). Named-pipe cutover is not required in Phase 1.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Studio | ✓ | v20.20.2 | — |
| npm | Studio | ✓ | 10.8.2 | — |
| Rust / cargo | Engine | ✓ | rustc 1.99.1 / cargo 1.99.1 | `scripts/cargo-msvc.bat` |
| Windows PowerShell | WIN-01 shell | ✓ | Windows PowerShell 5.1 path observed | Document PS7 differences in tests |
| SILENCE_API_BASE / KEY | Optional live evals | ? | — | Unit tests without keys; note if evals skipped |
| graphify | Optional intel | ✗ disabled | — | Skip graph; research used direct code reads |

**Missing dependencies with no fallback:** none for code changes  
**Missing dependencies with fallback:** live model evals (keys) — use unit/integration without cloud when absent

Step 2.6: External tools checked (node/npm/cargo/powershell). Graphify disabled in config.

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json`.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Rust `cargo test` (crate-scoped); optional `npm run evals` (silence-engine eval runner) |
| Config file | Workspace `Cargo.toml`; `evals/v0/manifest.yaml` |
| Quick run command | `cargo test -p silence-tools` (or `.\scripts\cargo-msvc.bat test -p silence-tools`) |
| Full suite command | `cargo test -p silence-tools -p silence-engine -p silence-sandbox` + optional `npm run evals` if keys present |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LOOP-01 | Staged edit not on disk until Apply; Reject keeps `before` | unit + integration | `cargo test -p silence-tools` + Engine RPC test | ❌ Wave 0 |
| LOOP-03 | No renderer model/fs; audit on apply | manual boundary + audit unit | grep/guard + `cargo test -p silence-engine` | ⚠️ partial audit exists |
| WIN-01 | PowerShell + long path + Vietnamese UTF | unit | `cargo test -p silence-tools` UTF/long-path | ❌ Wave 0 |
| WIN-02 | Engine is separate OS process | smoke / code assert | spawn check / existing Studio main | ✅ pattern exists |
| PERM-01 | Ask default; remember persists workspace | unit | session allowlist + file round-trip | ❌ Wave 0 |
| NET-01 | Bind loopback/pipe only | unit | reject non-loopback addr | ❌ Wave 0 |
| METR-04 | Shell/ConPTY reliable | unit (+ optional 1 eval) | `cargo test -p silence-tools` / `silence-engine` pty smoke | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cargo test -p silence-tools` (and `-p silence-engine` when touching runtime/rpc)
- **Per wave merge:** `cargo test -p silence-tools -p silence-engine -p silence-sandbox`
- **Phase gate:** Above green; run `npm run evals` only if keys available — otherwise document skip (AGENTS.md)

### Wave 0 Gaps
- [ ] Unit tests for staged write/edit + apply/reject disk semantics
- [ ] Unit tests for permission remember + workspace persistence load/save
- [ ] UTF-8 Vietnamese + long-path shell/file fixtures under `crates/tools`
- [ ] Bind-address guard test for TCP serve
- [ ] Mandatory: ≥1 `evals/v0` shell UTF or staged-edit task definition (live run may skip without keys; not full suite)
- [ ] Framework install: none — use existing cargo/npm

## Security Domain

> `security_enforcement` enabled; ASVS level 1 in config.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (local single-user MVP) | — |
| V3 Session Management | partial | In-memory Engine sessions; abort RPC |
| V4 Access Control | yes | Permission Ask + workspace allowlist; path jail |
| V5 Input Validation | yes | Tool args validated; canonicalize paths; timeout/cap shell output |
| V6 Cryptography | no new crypto in Phase 1 | Do not hand-roll; API keys stay env (Phase 3 redaction) |

### Known Threat Patterns for local agent / Electron+Rust

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection → mutating tools | Elevation | Default Ask; no silent YOLO |
| Path escape outside workspace | Tampering | `Workspace::resolve` canonicalize + prefix check |
| Sidecar LAN exposure | Information disclosure | Bind `127.0.0.1` / named pipe only |
| Shell fork bomb / hang | Denial of service | Timeout + Job Object kill-on-close |
| Renderer as attacker | Spoofing | Narrow preload RPC; no direct fs/model |
| Permission remember bypass via UI-only store | Elevation | Engine-enforced allowlist + disk store read by Engine |

## Sources

### Primary (HIGH confidence)
- In-repo: `crates/protocol/src/lib.rs`, `crates/tools/src/lib.rs`, `crates/runtime/src/{agent,rpc,pty,main}.rs`, `apps/studio/src/{main/index.ts,renderer/App.tsx,components/ChatPane.tsx}`
- `docs/adr/0001-architecture.md`, `docs/threat-model.md`, `docs/PRD.md`, `AGENTS.md`
- `.cursor/rules/{rust-harness,frontend-boundary,protocol,frontend-shell}.mdc`
- crates.io legitimacy check via `gsd_run query package-legitimacy check`

### Secondary (MEDIUM confidence)
- [Microsoft Learn — Maximum Path Length Limitation](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation)
- [Microsoft Learn — about_Character_Encoding (PowerShell)](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_character_encoding)
- [Windows Command-Line — Introducing ConPTY](https://devblogs.microsoft.com/commandline/windows-command-line-introducing-the-windows-pseudo-console-conpty/)
- [Microsoft Learn — Named Pipe Security](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights)
- wezterm `portable-pty` ConPTY implementation (GitHub)

### Tertiary (LOW confidence)
- Community write-ups on loopback TCP needing app-level tokens (useful context; not a Phase 1 locked requirement)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — locked ADR + verified Cargo/Studio tree; no new packages
- Architecture: HIGH — seams read end-to-end; gaps are concrete line-level bugs/mismatches
- Pitfalls: HIGH for apply/reject and remember; MEDIUM for encoding/long-path edge cases (OS/policy dependent)

**Research date:** 2026-11-05  
**Valid until:** 2026-12-05 (stack stable; re-check if `portable-pty` major bump or Studio IPC transport changes)
