# 5ilence

Nền tảng lập trình AI (AI-native software development). Monorepo: **Studio** (desktop) + **Engine** (Rust sidecar) + **Agent** (trong Engine). **CLI** là backlog năm 1.

Studio Electron + React/TypeScript (`apps/studio`). Lõi harness Rust (`silence-engine` = Engine): tool loop, MCP, sub-agent, auto-model, audit. Agent dùng **model cloud**.

## Yêu cầu

- Windows 10+, Node 20+, Rust stable (MSVC), Python 3.11 (fixture evals)
- Ít nhất một nguồn model (nhập key ở Settings → Model sources, lưu mã hoá trên máy; chọn nguồn đang dùng ở dòng Source trong menu model):
  - **OpenRouter** / endpoint OpenAI-compatible: `SILENCE_API_BASE`, `SILENCE_API_KEY`
  - **Claude API** trực tiếp: `ANTHROPIC_API_KEY` (tuỳ chọn `ANTHROPIC_BASE_URL`)
  - **Claude CLI** (thử nghiệm, chỉ dùng cá nhân / nội bộ; **nguồn mặc định** của Studio và evals): lệnh `claude` đã đăng nhập; đổi đường dẫn bằng `SILENCE_CLAUDE_CLI`. Auto ở nguồn này chọn trong các model `@cli`; tool vẫn chạy trong Engine qua MCP bridge.
- Nguồn mặc định của Studio đặt ở Settings → Model sources → **Nguồn mặc định**. Studio không tự đổi sang nguồn khác khi nguồn mặc định không dùng được. Dòng Source trong menu model chỉ đổi cho lần chạy hiện tại.
- Effort (Low → Max) chọn trong menu model của Composer; Chưa chọn mức nào thì Engine gửi mức Recommended của model (Medium cho mọi model Claude).

## Chạy

```powershell
$env:SILENCE_API_BASE="http://127.0.0.1:11434/v1"
$env:SILENCE_API_KEY="..."
npm install
npm run studio
```

`npm run studio` tự build Engine trước (`prestudio` → `npm run build:engine`), nên Studio luôn chạy bản Engine khớp code. Đóng Studio trước khi chạy lại, vì Engine đang chạy giữ khóa file `silence-engine.exe` và build sẽ báo "Access is denied".

### Live watch

```powershell
npm run studio:watch
```

- Sửa renderer (React/CSS): HMR như `npm run studio`. Sửa `apps/studio/src/main` hoặc `preload`: không tự nạp, Ctrl+C rồi chạy lại.
- Sửa `crates/**`, `Cargo.toml`/`Cargo.lock`: `scripts/studio-watch.mjs` build lại Engine, xong thì Studio khởi động lại Engine (không đóng cửa sổ). Session đang chạy bị cắt; lượt gửi sau tự tạo session mới, lịch sử chat giữ nguyên. Build lỗi thì Engine cũ vẫn chạy.
- Sửa `config/*.yaml`: chỉ khởi động lại Engine.
- Watch mode chạy bản copy `target/debug/silence-engine.live.exe`, nên cargo ghi đè được exe gốc trong lúc app đang mở.

Lệnh tắt `run studio watch` (gõ ở thư mục nào cũng được): thêm dòng sau vào `$PROFILE` (`notepad $PROFILE`):

```powershell
. "<thư mục repo>\scripts\silence.ps1"
```

`run a b c` = `npm run a:b:c` ở gốc repo, ví dụ `run studio`, `run runtime`.

`scripts/cargo-msvc.bat` bọc MSVC + Windows SDK (máy này thiếu `ucrt.lib` x64). Khi SDK đầy đủ, dùng `cargo` bình thường.

Sidecar TCP `127.0.0.1:0` khi Electron spawn; CLI:

```powershell
cargo run -p silence-engine -- serve --tcp 127.0.0.1:7420
```

Eval chạy thủ công ở local: `npm run evals` (mặc định qua Claude CLI; `npm run evals -- --help`, chi tiết ở `evals/README.md`).

Copy `templates/silence` thành `.silence/` trong repo làm việc để bật skills/hooks.

GSD (Cursor, local): `/gsd-discuss-phase`, `/gsd-plan-phase --prd docs/PRD.md`, `/gsd-execute-phase`. Không `/gsd-new-project` đè PRD. Execute được commit atomic.

## Tài liệu

- [docs/README.md](docs/README.md) — mục lục (mục đích + khi nào đọc)
- [AGENTS.md](AGENTS.md) — playbook Cursor khi build repo này
- [docs/frontend/README.md](docs/frontend/README.md) — spec UI chi tiết
- [config/models.yaml](config/models.yaml)
- [evals/v0/manifest.yaml](evals/v0/manifest.yaml)
