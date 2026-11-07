---
paths:
  - "apps/studio/src/renderer/**"
---

# Front-end boundary

Specs: `docs/frontend/README.md`. Do not put backend/infra notes in those files.

- Renderer never calls a model. fs/shell/MCP/session go through `window.silence.rpc` → silence-engine.
- No silent file writes. Diff + user approve. No fake mic/upload/automations — label “chưa gắn”.
- Speak Vietnamese to the user. Keep agent/system prompts in English.
- Unused: `ProjectHeader.tsx`, `ContextPanel.tsx`, `Sidebar.tsx` (do not remount Explorer / Agents Window chrome in chat).
- Historical `docs/archive/ui-app.md` is not the current layout source of truth.
