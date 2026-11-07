# 5ilence

Nền tảng lập trình AI (AI-native software development). Monorepo: **Studio** (desktop) + **Engine** (Rust sidecar) + **Agent** (trong Engine). **CLI** là backlog năm 1.

Studio Electron + React/TypeScript (`apps/studio`). Lõi harness Rust (`silence-engine` = Engine): tool loop, MCP, sub-agent, auto-model, audit. Agent dùng **model cloud**.

## Yêu cầu

- Windows 10+, Node 20+, Rust stable (MSVC), Python 3.11 (fixture evals)
- Endpoint OpenAI-compatible: `SILENCE_API_BASE`, `SILENCE_API_KEY`

## Chạy

```powershell
$env:SILENCE_API_BASE="http://127.0.0.1:11434/v1"
$env:SILENCE_API_KEY="..."
.\scripts\cargo-msvc.bat build -p silence-engine
npm install
npm run studio
```

`scripts/cargo-msvc.bat` bọc MSVC + Windows SDK (máy này thiếu `ucrt.lib` x64). Khi SDK đầy đủ, dùng `cargo` bình thường.

Sidecar TCP `127.0.0.1:0` khi Electron spawn; CLI:

```powershell
cargo run -p silence-engine -- serve --tcp 127.0.0.1:7420
cargo run -p silence-engine -- evals --dir evals/v0 --repo-root .
```

Copy `templates/silence` thành `.silence/` trong repo làm việc để bật skills/hooks.

GSD (Cursor, local): `/gsd-discuss-phase`, `/gsd-plan-phase --prd docs/PRD.md`, `/gsd-execute-phase`. Không `/gsd-new-project` đè PRD. Execute được commit atomic.

## Tài liệu

- [docs/README.md](docs/README.md) — mục lục (mục đích + khi nào đọc)
- [AGENTS.md](AGENTS.md) — playbook Cursor khi build repo này
- [docs/frontend/README.md](docs/frontend/README.md) — spec UI chi tiết
- [config/models.yaml](config/models.yaml)
- [evals/v0/manifest.yaml](evals/v0/manifest.yaml)
