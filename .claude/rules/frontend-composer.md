---
paths:
  - "apps/studio/src/renderer/components/Composer.tsx"
---

# Composer

Full spec: `docs/frontend/composer.md`.

- Mode order: Plan, Agent, Debug, MultiTask, Review, Ask. Trigger: pill, `--accent` fill, `--on-accent` text. Auto immediately to the right, no border.
- Placeholder always: `Plan, Build, / for skills, @ for context`.
- Files+Review row only if `files.length > 0`.
- Empty tools: context **gauge** (not Image), paperclip, mic stub, waveform stub.
- Any text in the input: hide mic+waveform, show Enter (arrow up). Clear the input **before** `session.prompt`.
- Gauge = Show context usage. Fill = `input_tokens / 256000` (0 = empty track, 256k = full). Opens the report panel above the input.
