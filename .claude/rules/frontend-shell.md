---
paths:
  - "apps/studio/src/renderer/App.tsx"
  - "apps/studio/src/renderer/styles.css"
  - "apps/studio/src/renderer/components/{TitleBar,ChatTabBar,Sidebar,ChatHistoryPanel,ChatPane,DiffPane,BottomPanel}.tsx"
---

# Shell

- Full-width titlebar (logo, File…Help, ← →, folder name, Toggle Panel, Chat, Settings, − □ ×). Chat icon sits between the panel toggle and Settings. No left vertical activity bar.
- PanelBottom toggles the bottom panel (Terminal, Output; other tabs stub). Shortcut Ctrl+J. It does not hide the composer.
- Chat icon toggles the entire Chat Workspace. Hidden = empty main, titlebar remains.
- Do not mount Explorer in Chat Workspace (no file-tree sidebar, no folder icon on the history panel).
- Chat Workspace: horizontal Cursor-style tabs (icon + title + close, + = New Agent) above the conversation | conversation + composer | history. Tabs do not overlay the history panel. Closing a tab does not delete history.
- Agents sidebar toggle (PanelRight on the history header, Ctrl+Alt+U) hides only the right history rail. Restore via the same shortcut or the button on the tab bar.
- Hide Diff/Changes until `(diff || file)` AND the user opened it (diff card, file chip). A new diff never auto-opens the panel. History: New Agent, Search, Automations (stub), Customize.
- Persist `silence.shell.view` (`chat` | `hidden`), `silence.shell.openTabs`, other `silence.shell.*`, and `silence.chat.history`. Opening a thread shows Chat Workspace, composer, and focuses it.
- `.log { min-height: 0 }` so the empty hub cannot clip the composer.
- Keep graphite + copper tokens (`docs/frontend/tokens.md`).
