# 01-03 Summary — PERM-01 Remember per workspace

**Decision:** allowlist stored at workspace `.silence/permissions.json` (`{"allow_tools": [...]}`), Engine is the only writer.

## Done
- `permissions.rs`: `load` (missing file → empty; unknown tool names dropped), `save` (create_dir_all), `is_rememberable` (`write|edit|shell|mcp__*`).
- `agent.rs`: `create_session` loads allowlist; `pending_perm` now holds `(tool name, sender)` so the name is resolved server-side; `decide_permission` persists only on Allow + Remember; Deny never writes. `name_hint` param removed.
- `rpc.rs`: `session.permission` no longer drops the tool name.
- Studio: "Nhớ cho workspace này" checkbox (default on), buttons/checkbox disabled while RPC in flight, retry banner + error copy on RPC failure, Deny forces remember=false.

## Tests
- `cargo test -p silence-engine --lib`: 13/13 (permissions round-trip/missing file, remember, second-call-skips-ask, create_session loads allowlist, deny never persists, unknown names dropped).
- Renderer `tsc --noEmit` clean; vitest 8/8.
- NOT run: `npm run evals` (key is available in env; held back because no permission eval task exists yet and evals call the real API); no eval task added. Manual UI check (banner + reload) not done.
- `bind_guard` still RED — belongs to plan 01-04.
