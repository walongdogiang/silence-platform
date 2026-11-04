# Phase 1: Trusted edit loop - Pattern Map

**Mapped:** 2026-11-05
**Files analyzed:** 16
**Analogs found:** 15 / 16

> **Tracked-source note:** Repo bootstrap currently tracks mainly `.planning/` while product trees (`crates/`, `apps/`, `packages/`, `evals/`) are present on disk as untracked sources (`git status` shows `??`). Analogs below are those on-disk product paths (not gitignored capability mirrors). Planner/executor should treat them as the brownfield source of truth.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `crates/tools/src/lib.rs` (`write`/`edit` stage; shell UTF/long-path) | service | file-I/O + request-response | `crates/tools/src/lib.rs` (`write`/`edit`/`shell` + `mod tests`) | exact |
| `crates/runtime/src/agent.rs` (stage pending edits; remember name; load allowlist) | service | event-driven + request-response | `crates/runtime/src/agent.rs` (`ask_perm` / tool dispatch / `decide_permission`) | exact |
| `crates/runtime/src/rpc.rs` (`session.permission` name_hint; `diff.apply`/`diff.reject`) | controller | request-response | `crates/runtime/src/rpc.rs` (`dispatch` match arms) | exact |
| `crates/runtime/src/permissions.rs` (**new** — workspace `.silence/permissions.json`) | service | file-I/O | `crates/runtime/src/org.rs` (`load` under `.silence/`) | role-match |
| `crates/runtime/src/audit.rs` (audit on Apply commit) | service | file-I/O | `crates/runtime/src/audit.rs` (`AuditLog::append`) | exact |
| `crates/runtime/src/main.rs` (TCP bind loopback guard) | config | request-response | `crates/runtime/src/main.rs` (`serve` + `TcpListener::bind`) | exact |
| `crates/runtime/src/pty.rs` (ConPTY UTF smoke / keep PowerShell) | service | streaming | `crates/runtime/src/pty.rs` (`TerminalSession::start`) | exact |
| `crates/sandbox/src/lib.rs` (Job Object keep) | utility | request-response | `crates/sandbox/src/lib.rs` (`wrap_pid`) | exact |
| `crates/protocol/src/lib.rs` (`DiffRejectParams` / permission fields if any) | model | transform | `crates/protocol/src/lib.rs` (`PermissionDecision`, `DiffApplyParams`) | exact |
| `packages/protocol/src/index.ts` (dual sync) | model | transform | `packages/protocol/src/index.ts` + `crates/protocol/src/lib.rs` | exact |
| `apps/studio/src/renderer/types.ts` (Studio protocol copy) | model | transform | `apps/studio/src/renderer/types.ts` | exact |
| `apps/studio/src/renderer/App.tsx` (apply/reject Engine path; remember flag) | component | request-response + event-driven | `apps/studio/src/renderer/App.tsx` (`applyDiff` / `answerPerm` / `createLiveSession`) | exact |
| `apps/studio/src/renderer/components/ChatPane.tsx` (Remember checkbox; disable in-flight) | component | event-driven | `apps/studio/src/renderer/components/ChatPane.tsx` (perm/diff banners) | exact |
| `apps/studio/src/renderer/components/DiffPane.tsx` (pending `after` read-only) | component | file-I/O display | `apps/studio/src/renderer/components/DiffPane.tsx` | exact |
| `apps/studio/src/main/index.ts` (keep `127.0.0.1:0` spawn) | config | request-response | `apps/studio/src/main/index.ts` (`startRuntime`) | exact |
| `evals/v0/manifest.yaml` (+1–2 shell UTF/long-path tasks) | test | batch | `evals/v0/manifest.yaml` (existing task entries) | role-match |

## Pattern Assignments

### `crates/tools/src/lib.rs` (service, file-I/O)

**Analog:** `crates/tools/src/lib.rs`

**Imports / workspace jail** (lines 1–39):
```rust
use anyhow::{anyhow, Context, Result};
use dunce::canonicalize; // via Workspace::new / resolve
// Workspace::resolve: canonicalize + starts_with root — keep for staged paths
```

**Core mutate-today pattern to change** (lines 254–318) — copy `FileDiff` shape, **remove** immediate `fs::write` for product Ask/stage path:
```rust
fn write(ws: &Workspace, args: &Value) -> Result<ToolOutput> {
    // ... resolve path, create_dir_all parents ...
    let before = std::fs::read_to_string(&path).unwrap_or_default();
    let after = args["contents"].as_str().unwrap_or("").to_string();
    std::fs::write(&path, &after)?; // ← Phase 1: stage-only OR commit flag used only by diff.apply
    Ok(ToolOutput {
        ok: true,
        output: format!("wrote {}", ws.rel(&path)),
        diff: Some(FileDiff { path: ws.rel(&path), before, after }),
    })
}
```

**Recommended split (planner):** keep committing write for `diff.apply` (RPC already calls `execute(..., "write", ...)`), add stage/propose API or `commit: bool` so agent tool path returns `FileDiff` without disk write. Same for `edit`.

**Shell pattern** (lines 437–483) — harden UTF/cwd; keep Job Object wrap:
```rust
let mut cmd = if cfg!(windows) {
    let mut c = Command::new("powershell");
    c.args(["-NoProfile", "-NonInteractive", "-Command", command]);
    c
} else { /* bash */ };
cmd.current_dir(&ws.root).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
let child = cmd.spawn()?;
let _guard = silence_sandbox::wrap_pid(child.id().unwrap_or(0)).ok();
```

**Test pattern** (lines 536–575) — extend `tmp_ws()` fixtures:
```rust
#[cfg(test)]
mod tests {
    fn tmp_ws() -> (tempfile::TempDir, Workspace) { /* ... */ }
    #[test]
    fn edit_unique() { /* assert disk after edit — replace with stage semantics tests */ }
    #[test]
    fn jail_blocks_escape() { /* keep */ }
}
```
Add tests: staged write leaves `before` on disk; Vietnamese UTF round-trip; long nested path (>260 / `\\?\`).

---

### `crates/runtime/src/agent.rs` (service, event-driven)

**Analog:** `crates/runtime/src/agent.rs`

**Session state pattern** (lines 33–45) — extend with pending edits + tool name on pending perm:
```rust
pub struct Session {
    pub allowlist: Vec<String>,
    pub pending_perm: HashMap<String, oneshot::Sender<bool>>,
    // Phase 1: pending_edits: HashMap<path, PendingEdit { before, after }>
    // Phase 1: pending_perm_names: HashMap<request_id, tool_name>
}
```

**Mutating tool dispatch** (lines 480–536) — keep ask_perm → execute → emit Diff; change so write/edit stage into session and emit Diff **without** disk commit; move audit-of-mutation to Apply:
```rust
if silence_tools::mutates(&tc.name) {
    let allowed = ask_perm(ctx, session_arc, tx, &tc.name, &args).await?;
    if !allowed { return Ok("permission denied".into()); }
}
let result = silence_tools::execute(&ws, &tc.name, &args).await;
// On Ok + diff: emit SessionEvent::Diff { path, before, after }
```

**ask_perm / decide_permission** (lines 553–624):
```rust
// Ask path already emits SessionEvent::Permission { request_id, name, input, reason }
// decide_permission only pushes allowlist when name_hint is Some — store name at ask time
pub async fn decide_permission(..., remember: bool, name_hint: Option<String>) -> Result<()> {
    if remember {
        if let Some(n) = name_hint {
            s.allowlist.push(n);
        }
    }
    if let Some(tx) = s.pending_perm.remove(request_id) {
        let _ = tx.send(allow);
    }
}
```
**Copy:** resolve `name_hint` from `pending_perm_names` when RPC passes `None`, **or** fix RPC to pass name; on remember also persist via permissions module.

**create_session** (lines 67–97) — after `Workspace::new`, load workspace allowlist into `session.allowlist` (mirror `org::load`).

---

### `crates/runtime/src/rpc.rs` (controller, request-response)

**Analog:** `crates/runtime/src/rpc.rs`

**Imports pattern** (lines 1–14):
```rust
use silence_protocol::{
    ApprovePlanParams, DiffApplyParams, /* DiffRejectParams */, PermissionDecision, ...
};
```

**Bug site to fix** (lines 87–99):
```rust
"session.permission" => {
    let p: PermissionDecision = serde_json::from_value(req.params)?;
    agent::decide_permission(
        &state.ctx, &p.session_id, &p.request_id, p.allow, p.remember,
        None, // ← replace: lookup pending tool name / pass from params
    ).await?;
    Ok(json!({"ok": true}))
}
```

**diff.apply commit pattern** (lines 118–129) — keep as disk commit; after staging, Apply should write pending `after` + audit:
```rust
"diff.apply" => {
    let p: DiffApplyParams = serde_json::from_value(req.params)?;
    // resolve session workspace; silence_tools::execute write OR commit pending edit
    let out = silence_tools::execute(&ws, "write", &args).await?;
    Ok(json!({"ok": out.ok, "output": out.output}))
}
```

**Add adjacent arm** for `diff.reject`: drop pending edit; no `fs::write`; return `{ok:true}`. Copy response/error framing from bottom of `dispatch` (lines 174–178).

---

### `crates/runtime/src/permissions.rs` (**new**, service, file-I/O)

**Analog:** `crates/runtime/src/org.rs`

**Load-from-workspace pattern** (org.rs lines 27–64):
```rust
pub fn load(workspace: &Path) -> Result<OrgContext> {
    for name in ["AGENTS.md", ".silence/AGENTS.md"] {
        let p = workspace.join(name);
        if p.exists() {
            ctx.agents_md = std::fs::read_to_string(p)?;
            break;
        }
    }
    // hooks: read .silence/hooks/*.json via serde_json::from_str
}
```

**Copy for permissions:**
- Path: `workspace.join(".silence/permissions.json")`
- Schema: `{ "allow_tools": ["edit","write","shell"] }` (RESEARCH discretion)
- `load(workspace) -> Vec<String>`; `save(workspace, &allow_tools)` with `create_dir_all(.silence)`
- Call from `create_session` and `decide_permission` when `remember && allow`
- Do **not** use renderer `localStorage` as source of truth

---

### `crates/runtime/src/audit.rs` (service, file-I/O)

**Analog:** self — `AuditLog::append` (lines 28–48)

```rust
pub async fn append(&self, event: AuditEvent) -> Result<()> {
    let _g = self.lock.lock().await;
    let mut line = serde_json::to_string(&event)?;
    line.push('\n');
    // OpenOptions create+append audit.jsonl
}
```

**Apply to:** audit on **Apply commit** (and optionally keep tool-call audit with `staged: true` detail). Reuse `now_event` helper from agent tool path.

---

### `crates/runtime/src/main.rs` (config, request-response)

**Analog:** `crates/runtime/src/main.rs` serve (lines 70–104)

```rust
if let Some(addr) = tcp {
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    // Phase 1: before bind, refuse non-loopback hosts (0.0.0.0, *, LAN IPs)
}
```

**Studio spawn analog** (must stay aligned): `apps/studio/src/main/index.ts` lines 136–138 `"serve", "--tcp", "127.0.0.1:0"`.

---

### `crates/runtime/src/pty.rs` (service, streaming)

**Analog:** self (lines 12–30)

```rust
let mut cmd = if cfg!(windows) {
    CommandBuilder::new("powershell.exe")
} else {
    CommandBuilder::new("bash")
};
cmd.cwd(cwd);
let _child = pair.slave.spawn_command(cmd)?;
```

**Apply to:** METR-04 interactive path — keep ConPTY + PowerShell; add smoke/unit only if needed. Do not treat this as fixing `silence_tools::shell` (separate path).

---

### `crates/sandbox/src/lib.rs` (utility)

**Analog:** self — `wrap_pid` + Job Object `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (lines 16–76). Keep wiring from `shell`; no redesign.

---

### `crates/protocol/src/lib.rs` + `packages/protocol/src/index.ts` + Studio copies (model)

**Analog:** dual protocol pair

**Rust PermissionDecision / DiffApply** (`crates/protocol/src/lib.rs` 114–120, 201–205):
```rust
pub struct PermissionDecision {
    pub session_id: String,
    pub request_id: String,
    pub allow: bool,
    #[serde(default)]
    pub remember: bool,
}
pub struct DiffApplyParams {
    pub session_id: String,
    pub path: String,
    pub after: String,
}
```

**TS SessionEvent** (`packages/protocol/src/index.ts` 20–33) mirrors `apps/studio/src/renderer/types.ts` 1–14.

**Pattern:** any new `DiffRejectParams` / method docs → edit Rust + `packages/protocol` + Studio `types.ts` in one change set; keep `PROTOCOL_VERSION` identical (`"0.1.1"` until intentional bump).

---

### `apps/studio/src/renderer/App.tsx` (component, request-response)

**Analog:** self

**Session Ask default** (lines 485–493):
```tsx
async function createLiveSession(dir: string) {
  const created = await window.silence.rpc("session.create", {
    workspace: dir, model, mode, permission: "ask",
  });
  // ...
}
```

**Apply** (687–694) — keep RPC; add error surfacing per UI-SPEC:
```tsx
await window.silence.rpc("diff.apply", {
  session_id: sessionId, path: diff.path, after: diff.after,
});
setDiff(null);
```

**Reject today (broken)** (831) — replace UI-only clear:
```tsx
onRejectDiff={() => setDiff(null)}
// → async rejectDiff(): rpc("diff.reject", { session_id, path }) then setDiff(null)
```

**Permission remember** (741–749):
```tsx
void window.silence.rpc("session.permission", {
  session_id: sessionId,
  request_id: perm.request_id,
  allow,
  remember: allow, // ← wire to ChatPane checkbox; Deny → remember false
});
```

**Boundary:** only `window.silence.rpc` / `onEvent` — never model/fs.

---

### `apps/studio/src/renderer/components/ChatPane.tsx` (component, event-driven)

**Analog:** self banners (lines 589–616)

```tsx
{props.perm && (
  <div className="banner warn">
    <h4>Cho phép {props.perm.name}?</h4>
    <pre>{JSON.stringify(props.perm.input, null, 2)}</pre>
    <div className="row">
      <button type="button" className="primary" onClick={props.onAllow}>Cho phép</button>
      <button type="button" className="ghost" onClick={props.onDeny}>Từ chối</button>
    </div>
  </div>
)}
{props.diff && (
  <div className="banner">
    <h4>Diff {props.diff.path}</h4>
    {/* Apply / Reject */}
  </div>
)}
```

**Phase 1 UI-SPEC additions (copy patterns, do not redesign shell):**
- Checkbox **Nhớ cho workspace này** (default checked on Allow path)
- Disable buttons while RPC in flight; error text `--error` on failure
- Keep English **Apply** / **Reject**; Vietnamese permission CTAs

Props today: `onAllow` / `onDeny` with no remember arg — extend to `onAllow(remember: boolean)` or lift checkbox state to App.

---

### `apps/studio/src/renderer/components/DiffPane.tsx` (component)

**Analog:** self (lines 20–88)

```tsx
const value = props.diff ? props.diff.after : props.fileText;
// options.readOnly: Boolean(props.diff)
// Empty: "Chưa có thay đổi" / "Chọn file hoặc chờ agent tạo diff"
```

**Keep:** tracer shows pending `after` read-only; `M` marker; hide until parent `diff || file`. No multi-file queue / hunk IDE in Phase 1.

---

### `apps/studio/src/main/index.ts` (config)

**Analog:** self `startRuntime` (lines 131–145)

```ts
child = spawn(bin, [
  "serve", "--tcp", "127.0.0.1:0",
  "--config", path.join(repoRoot, "config/models.yaml"),
], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
```

**Apply:** do not change to `0.0.0.0`; keep separate Engine process (WIN-02).

---

### `evals/v0/manifest.yaml` (test, batch)

**Analog:** existing task entries (lines 9–16)

```yaml
  - id: E01-edit-add-pow
    kind: edit
    prompt: "..."
    pass_if:
      grep:
        - path: src/calc.py
          pattern: "def pow_int"
```

**Apply:** add **at most 1–2** tasks exercising `shell` (Vietnamese echo + long nested path). Do not gate Phase 1 on full 20-task suite. Prefer primary coverage in `cargo test -p silence-tools`.

---

## Shared Patterns

### Renderer ↔ Engine boundary
**Source:** `apps/studio/src/renderer/App.tsx`, `.cursor/rules/frontend-boundary.mdc`  
**Apply to:** All Studio files  
Renderer only `window.silence.rpc` / `onEvent`. No model, fs, shell, or permission store as sole gate.

### Permission default Ask + Engine allowlist
**Source:** `crates/protocol/src/lib.rs` (`PermissionMode::Ask` default); `App.tsx` `permission: "ask"`; `agent.rs` `ask_perm`  
**Apply to:** session create, mutating tools, UI banners  
Product path stays Ask; eval YOLO stays isolated in `eval_runner`.

### Diff event + Apply commit
**Source:** `SessionEvent::Diff` + `diff.apply` → `silence_tools::execute("write")`  
**Apply to:** staged write/edit + Studio Apply  
Disk mutation only on Apply (or explicit commit helper). Reject must call Engine.

### Workspace-local `.silence/` config
**Source:** `crates/runtime/src/org.rs`  
**Apply to:** new permissions persistence  
Read/write under workspace `.silence/`; Engine enforces.

### Dual protocol sync
**Source:** `.cursor/rules/protocol.mdc`, `crates/protocol` + `packages/protocol` + Studio `types.ts`  
**Apply to:** any new RPC (`diff.reject`) or fields  
Same `PROTOCOL_VERSION`; update all three surfaces together.

### Path jail + Job Object
**Source:** `crates/tools/src/lib.rs` `Workspace::resolve`; `crates/sandbox::wrap_pid`  
**Apply to:** staged paths, shell, Apply writes  
`dunce::canonicalize` + prefix check; wrap shell PIDs.

### Audit append-only JSONL
**Source:** `crates/runtime/src/audit.rs`  
**Apply to:** Apply (and tool lifecycle as needed)  
`AuditLog::append` under Engine data dir — not Phase 6 UI.

### Error / RPC response framing
**Source:** `crates/runtime/src/rpc.rs` lines 174–178  
**Apply to:** new `diff.reject` and hardened permission/apply  
```rust
Ok(v) => RpcResponse::ok(id, v),
Err(err) => RpcResponse::err(id, -32000, err.to_string()),
```
Studio: keep banners mounted on failure; show UI-SPEC error copy.

### Graphite + copper UI chrome
**Source:** `ChatPane` `.banner.warn` / `.primary` / `.ghost`; DiffPane Monaco theme  
**Apply to:** Remember checkbox + loading disables  
No shell redesign; no shadcn; tokens from existing CSS.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| *(none blocking)* | — | — | Staging is a control-flow change on existing `write`/`edit`+`diff.apply`; closest analog is those same functions. New `permissions.rs` maps to `org.rs`. |

Optional greenfield-ish only if planner splits modules:

| File | Role | Data Flow | Closest substitute |
|------|------|-----------|-------------------|
| In-session `PendingEdit` map | model | transform | `FileDiff` in `crates/tools/src/lib.rs` + `Session.pending_perm` HashMap pattern |

## Metadata

**Analog search scope:** `crates/{tools,runtime,protocol,sandbox}`, `packages/protocol`, `apps/studio/src/{main,renderer}`, `evals/v0`  
**Files scanned:** ~40 primary sources (rpc/agent/tools/protocol/studio UI/org/audit/pty/sandbox/evals)  
**Pattern extraction date:** 2026-11-05  
**Planner priority (Walking Skeleton):** (1) stage write/edit + `diff.reject` + App Reject wiring → (2) permission name_hint + Remember checkbox + `.silence/permissions.json` → (3) shell UTF/long-path tests + bind guard → (4) optional 1–2 evals  
