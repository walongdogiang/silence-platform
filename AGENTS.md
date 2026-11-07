# 5ilence — hướng dẫn Cursor (build repo này)

Repo monorepo xây nền tảng 5ilence (Electron Studio + Rust Engine).

Danh mục tài liệu: [`docs/README.md`](docs/README.md) — đọc mục lục đó rồi mới mở file docs cần thiết. Brand ↔ code: mục **Tên sản phẩm** trong file đó.

Kit agent trong app: `templates/silence/` (copy thành `.silence/`). Không sửa trừ khi task yêu cầu rõ.

## Stack và lệnh

- Studio (UI): `apps/studio` — renderer chỉ `window.silence.rpc` → main → TCP JSON-RPC `127.0.0.1` → Engine (`silence-engine`).
- Engine / harness: `crates/{runtime,tools,mcp,router,sandbox,protocol}` — binary `silence-engine`; Agent loop nằm trong `runtime`.
- Protocol: `packages/protocol` (TS) và `crates/protocol` (Rust) — đổi cả hai.
- Shell: PowerShell. Rust khi thiếu SDK: `.\scripts\cargo-msvc.bat <cargo-args>`.
- Chạy UI: `npm install` rồi `npm run studio` (`npm run desktop` vẫn alias). Engine CLI: `npm run runtime`.
- Test crate: `cargo test -p <crate>` (hoặc qua `cargo-msvc.bat`).
- Evals: `npm run evals` cần `SILENCE_API_BASE` / `SILENCE_API_KEY`.

## Tự chủ

- Được: sửa code, chạy build/test, đọc log (không in API key).
- Hỏi trước: `git commit`, push, tag, amend, force. Ngoại lệ: `/gsd-execute-phase` — `.cursor/rules/gsd-commit.mdc`.
- Không commit `.env`, secrets, `node_modules/`.

## Bắt buộc

- Renderer không gọi model; không fs/shell/MCP trực tiếp; không napi-rs làm IPC chính; không fork VS Code năm 1.
- Sản phẩm: diff + audit; permission mặc định `ask`; không silent YOLO; không bind LAN.
- Đổi harness/agent loop: thêm hoặc sửa eval task; chạy eval nếu có key, không thì ghi rõ chưa chạy. Không full 20 eval cho mọi PR.
- Đổi UI: `docs/frontend/` + `.cursor/rules/frontend-*.mdc`.
- Câu trả lời agent trong app (Markdown user-facing): sửa `SYSTEM` trong `crates/runtime/src/agent.rs`; hợp đồng UI/Copy: `docs/frontend/chat.md`; việc chưa làm: `docs/frontend/chat-markdown-roadmap.md`.
- Plan GSD: `/gsd-plan-phase --prd docs/PRD.md`. Không `/gsd-new-project` đè PRD.
- Nói với user tiếng Việt.

## Test theo phạm vi

- `crates/**`: `cargo test -p <crate>` liên quan.
- UI thuần: không bắt eval; kiểm theo spec frontend.
- `evals/**` hoặc vòng agent: `npm run evals` khi có key.
