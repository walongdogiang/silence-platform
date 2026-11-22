---
paths:
  - "crates/runtime/src/risk/**"
  - "packages/core/src/risk/**"
  - "packages/core/policy/**"
  - "packages/core/src/permissions/**"
  - "packages/core/src/sessions/manager.ts"
  - "crates/runtime/src/permissions.rs"
  - "crates/runtime/src/agent/policy.rs"
  - "crates/runtime/src/rpc.rs"
  - "crates/tools/**"
  - "crates/sandbox/**"
  - "crates/mcp/**"
  - "packages/protocol/**"
  - "crates/protocol/**"
---

# Security: permissions and Risk Engine

Read `docs/security/permissions.md` before changing permission flow; look up codes in `docs/security/risk-catalog.md`.

- Enforcement lives in code, never in prompt text. TS core: `risk/classify.ts` labels a call (tier + codes → level `safe | caution | danger | hard_block`, `permissions/modes.ts::levelOf`); the permission mode turns it into allow / ask / deny (`modeAction`); user rules (`permissions/rules.ts`) run first and deny wins. Rust Engine (frozen): `risk::classify` → tier `auto | logged | ask | block`.
- TS core modes: `ask` (read-only) · `manual` · `accept_edits` · `auto` (default) · `bypass`. Red (`danger`) is asked every time and never offered "Always allow"; an allow rule never covers it. `hard_block` codes (`hard_block` in `default_policy.yaml`) are refused outside Bypass. Bypass: `bypass_countdown` codes ask with a countdown that ends in a refusal, `bypass_ask` codes ask. Unattended: anything that would ask is denied. Repo config never sets the mode; a repo's `.claude/settings.json` rules only add ask/deny.
- Rules for a shell command: allow needs every segment of a compound command to match; ask/deny match any segment (`rules.ts::ruleMatches`). Permission rule files are `POLICY_TAMPER` targets.
- Rules only raise a tier. Unknown program/tool → `ask`. Unparseable shell (`$(…)`, backtick subshell, unclosed quote) → `ask`.
- Tier 3 is never rememberable and never lowered by workspace policy; each call stays blocked. The only way a blocked call runs is the escalation card (`agent/sandbox.rs::block_seen`): third block in a row in a turn, at most 3 per session, shows the real command and Engine-written reasons, and offers only "Dừng" for `never_escalate` codes. Only the Engine writes `.silence/permissions.json` and `.silence/network.json`.
- Autonomous mode: a shell call runs in the sandbox without asking only when sandbox status is Ready and `Verdict::sandbox_plan` says Cover (`sandbox_covers` / `always_ask` in `default_policy.yaml`); otherwise it behaves like Balanced. The Engine never falls back to an unsandboxed run on its own after a sandbox failure.
- RPC must never create a `yolo` session (`rpc::client_permission_allowed`); only `eval_runner` may.
- Permission card shows the real command; model-written text is never the basis for approval.
- New tool: add it to `risk::classify` (or it falls into `UNKNOWN_TOOL`) and to `silence_tools::mutates` if it writes.
- Changing a rule: edit `packages/core/policy/default_policy.yaml` + add cases to `corpus.yaml` (safe and attack) + update `risk-catalog.md`, then `npm test --workspace @silence/core`. The Rust copy (`crates/runtime/src/risk/`) is frozen and no longer kept identical; change it only for a Rust Engine fix, then run `.\scripts\cargo-msvc.bat test -p silence-engine --lib risk`.
- Changing `ask_perm`/agent loop: add an eval task; run evals only with API keys, otherwise say so.
