---
paths:
  - "apps/studio/src/renderer/App.tsx"
  - "apps/studio/src/renderer/styles.css"
  - "apps/studio/src/renderer/components/{TitleBar,ChatTabBar,ChatHistoryPanel,ChatPane,DiffPane,BottomPanel}.tsx"
---

# Shell

- Full-width titlebar (logo, File…Help, ← →, folder name, Toggle Panel, Chat, Evals, Settings, − □ ×). Chat icon sits right after the panel toggle. Evals icon (dev checkout only) opens the Evals page and shows a progress chip while a run is going. No left vertical activity bar.
- PanelBottom toggles the bottom panel (Terminal, Output, Ports = agent background processes; other tabs stub). Shortcut Ctrl+J. It does not hide the composer.
- Chat icon toggles the entire Chat Workspace. Hidden = empty main, titlebar remains.
- Do not mount Explorer in Chat Workspace (no file-tree sidebar, no folder icon on the history panel).
- Chat Workspace: horizontal Cursor-style tabs (icon + title + close, + = New Agent) above the conversation | conversation + composer | history. Tabs do not overlay the history panel. Closing a tab does not delete history.
- Agents sidebar toggle (PanelRight on the history header, Ctrl+Alt+U) hides only the right history rail. Restore via the same shortcut or the button on the tab bar.
- Hide Diff/Changes until `(diff || file)` AND the user opened it (diff card, file chip). A new diff never auto-opens the panel. History: New Agent, Search, Automations (stub), Customize. Each row has a ⋯ menu (open in new tab, pin P, mark unread U, rename R, fork F, copy Markdown, copy session ID, archive A, delete D opens a confirm dialog: chat name + message count, focus on Cancel, Esc/backdrop cancel, "Archive instead" when not archived; after delete a "Deleted · Undo" toast at top-centre (never over the composer) with a seconds countdown + progress bar for 8s, hover/focus pauses it, Ctrl+Z also undoes). Pinned group first; archived chats leave tabs and sit in a collapsed "Archived" group at the end.
- Persist `silence.shell.view` (`chat` | `hidden`), `silence.shell.openTabs`, other `silence.shell.*`, and `silence.chat.history`. Opening a thread shows Chat Workspace, composer, and focuses it.
- `.log { min-height: 0 }` so the empty hub cannot clip the composer.
- Keep graphite + copper tokens (`docs/frontend/tokens.md`).
