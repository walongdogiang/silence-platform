---
paths:
  - "apps/studio/src/renderer/components/Composer.tsx"
---

# Composer

Full spec: `docs/frontend/composer.md`.

- Work mode order: Ask, Agent, Plan, Debug, Review. Debug and Review are not built yet: listed but disabled ("Coming soon"), no mode id, no logic. No MultiTask. Permission mode menu (`PermModeMenu`: Auto, Manual, Accept edits, Bypass permissions; no "(default)" label) sits right after the mode menu; Bypass keeps it red. Worktree switch (`WorktreeMenu`, core only) follows it and locks after the first message. Trigger: pill, `--accent` fill, `--on-accent` text. Auto immediately to the right, no border.
- Placeholder from `i18n.ts` (`composer.placeholder`), in the UI language: EN `Plan, Build, / for skills, @ for context`, VI `Lập kế hoạch, xây dựng, / để dùng skill, @ để thêm ngữ cảnh`.
- Files row only if `files.length > 0` (no Review shortcut).
- Permission card docks right above the composer (`ChatPane` `.perm-dock`, outside the scroll). "Deny with a note" (or typing while a TS core card waits) puts the composer in note mode: `--warning` border, chip + Cancel (Esc), Enter denies, aborts the turn and sends the note as the next message (`App.denyWithNote`). Spec: `docs/frontend/chat.md` → "Card xin quyền".
- Empty tools: context **gauge** (not Image), paperclip, mic stub, waveform stub.
- Any text in the input: hide mic+waveform, show Enter (arrow up). Clear the input **before** `session.prompt`.
- Images: paste (Ctrl+V), drag-drop onto the composer, or paperclip → "Add images…" / "Thêm ảnh…"; all go through `imagesFromFiles` (auto-downscale to 2048px / ≤5 MB, GIF untouched). Thumbnails above the textarea: click = lightbox, × = remove; sent as `images` (data URLs) on `session.prompt`, max 4. Text or an image enables Enter. Explicit model without `vision` → hint + "Use Auto" / "Dùng Auto", send blocked. History: localStorage keeps `imageIds` + count, the images live in IndexedDB (`imageStore.ts`).
- Lightbox (`ImageLightbox.tsx`): Esc / backdrop / × close, ←/→, click toggles fit ↔ actual size, Copy (PNG) and Save / Lưu (Electron save dialog).
- Gauge = Show context usage of the **current session** (`session.context` with the UI's mode/model), never `cost.summary` (global cost). Fill = `used / window` (window = that model's `context_window`). Warning color ≥70% (engine auto-compacts there), error ≥90%. `~` prefix = estimate. Opens the report panel above the input.
