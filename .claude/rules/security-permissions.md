---
paths:
  - "crates/runtime/src/risk/**"
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

- Enforcement lives in the Engine (`risk::classify` → tier `auto | logged | ask | block`). Never rely on prompt text for safety.
- Rules only raise a tier. Unknown program/tool → `ask`. Unparseable shell (`$(…)`, backtick subshell, unclosed quote) → `ask`.
- Tier 3 is never rememberable and never lowered by workspace policy; each call stays blocked. The only way a blocked call runs is the escalation card (`agent/sandbox.rs::block_seen`): third block in a row in a turn, at most 3 per session, shows the real command and Engine-written reasons, and offers only "Dừng" for `never_escalate` codes. Only the Engine writes `.silence/permissions.json` and `.silence/network.json`.
- Autonomous mode: a shell call runs in the sandbox without asking only when sandbox status is Ready and `Verdict::sandbox_plan` says Cover (`sandbox_covers` / `always_ask` in `default_policy.yaml`); otherwise it behaves like Balanced. The Engine never falls back to an unsandboxed run on its own after a sandbox failure.
- RPC must never create a `yolo` session (`rpc::client_permission_allowed`); only `eval_runner` may.
- Permission card shows the real command; model-written text is never the basis for approval.
- New tool: add it to `risk::classify` (or it falls into `UNKNOWN_TOOL`) and to `silence_tools::mutates` if it writes.
- Changing a rule: edit `risk/default_policy.yaml` + add cases to `risk/corpus.yaml` (safe and attack) + update `risk-catalog.md`, then `.\scripts\cargo-msvc.bat test -p silence-engine --lib risk` (`catalog_lists_every_code`, `corpus_tiers`).
- Changing `ask_perm`/agent loop: add an eval task; run evals only with API keys, otherwise say so.
