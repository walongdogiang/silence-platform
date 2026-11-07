---
paths:
  - "packages/protocol/**"
  - "crates/protocol/**"
  - "apps/studio/src/renderer/types.ts"
  - "apps/studio/src/renderer/global.d.ts"
---

# Protocol

- Source of truth is dual: `packages/protocol` (TS) and `crates/protocol` (Rust). Change both in the same edit.
- Keep `PROTOCOL_VERSION` identical (`packages/protocol/src/index.ts` and `crates/protocol/src/lib.rs`).
- Studio does not import `@silence/protocol` yet. `apps/studio/src/renderer/types.ts` and `global.d.ts` are copies — do not update only those files.
- RPC methods and events live in `crates/runtime/src/rpc.rs`. New fields need serde + TS types together.
