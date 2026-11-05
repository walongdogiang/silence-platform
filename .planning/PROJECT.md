# 5ilence

## What This Is

Monorepo for the **5ilence** platform: **Studio** (`apps/studio`) + **Engine** (`silence-engine` and related crates) + **Agent** (inside Engine). **CLI** is year-1 backlog. Desktop Electron + React/TypeScript with a Rust sidecar: tool loop, MCP, sub-agent, auto-model, audit. Cursor / Claude Code class — **cloud models**.

## Core Value

Harness that can edit a local workspace with permission, plan-approve, and eval. Not a VS Code fork. BMAD/GSD/ECC stay out of the product UI.

## Requirements

Canonical product spec: `docs/PRD.md`. Architecture: `docs/adr/0001-architecture.md`. UI spec: `docs/frontend/`.

GSD in this repo is for **Cursor building 5ilence**, not for shipping GSD into the app.

Do **not** run `/gsd-new-project` in a way that overwrites `docs/PRD.md`. Plan with `/gsd-plan-phase --prd docs/PRD.md`.

GSD `project_code` in `.planning/config.json` is **`SILENCE`** (technical prefix only). Product/repo brand remains **`5ilence`**. Do not set `project_code` to a digit-leading string.
