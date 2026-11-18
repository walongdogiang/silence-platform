---
paths:
  - "apps/studio/src/renderer/**"
---

# Front-end boundary

Specs: `docs/frontend/README.md`. Do not put backend/infra notes in those files.

- Renderer never calls a model. fs/shell/MCP/session go through `window.silence.rpc` → silence-engine.
- No silent file writes. Diff + user approve. No fake mic/upload/automations — label “chưa gắn”.
- Speak Vietnamese to the user. Keep agent/system prompts in English.
- UI text: one language at a time (Settings → General → Language, VI/EN). New or edited UI strings go in `i18n.ts` (`useT`), never hard-coded; see `docs/frontend/i18n.md`.
