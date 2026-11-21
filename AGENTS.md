# 5ilence — hướng dẫn cho agent (Claude Code) khi build repo này

Repo monorepo xây nền tảng 5ilence (Electron Studio + Rust Engine).

Danh mục tài liệu: [`docs/README.md`](docs/README.md) — đọc mục lục đó rồi mới mở file docs cần thiết. Brand ↔ code: mục **Tên sản phẩm** trong file đó.

Tìm code: [`docs/codemap.md`](docs/codemap.md) (câu hỏi → file + hàm) trước khi grep rộng.

Kit agent trong app: `templates/silence/` (copy thành `.silence/`). Không sửa trừ khi task yêu cầu rõ.

## Stack và lệnh

- Studio (UI): `apps/studio` — renderer chỉ `window.silence.rpc` → main → TCP JSON-RPC `127.0.0.1` → Engine (`silence-engine`).
- Engine / harness: `crates/{runtime,tools,mcp,router,sandbox,protocol}` — binary `silence-engine`; Agent loop nằm trong `runtime`.
- Protocol: `packages/protocol` (TS) và `crates/protocol` (Rust) — đổi cả hai.
- Shell: PowerShell. Rust khi thiếu SDK: `.\scripts\cargo-msvc.bat <cargo-args>`.
- Chạy UI: `npm install` rồi `npm run studio` (`npm run desktop` vẫn alias). Live watch (UI HMR + Engine tự build/restart khi sửa `crates/`): `npm run studio:watch` (README → Live watch). Engine CLI: `npm run runtime`.

## Ràng buộc

- Renderer không gọi model; không fs/shell/MCP trực tiếp; không napi-rs làm IPC chính.
- Không fork VS Code trong phạm vi năm 1 của [`docs/PRD.md`](docs/PRD.md).
- Sản phẩm: diff + audit; permission mặc định **Cân bằng** (an toàn/đảo ngược được thì tự chạy có hiển thị; rủi ro thì hỏi kèm giải thích; nguy hiểm thì chặn — `docs/security/permissions.md`); không silent YOLO; không bind LAN.
- Nói với user tiếng Việt.

## Sửa X thì đụng đâu

- Harness / agent loop: thêm hoặc sửa eval task; chạy eval nếu có key, không thì ghi rõ chưa chạy. Không full 20 eval cho mọi PR.
- UI: đọc spec `docs/frontend/` và rule `.claude/rules/frontend-*.md` trước khi sửa; đổi hành vi thì cập nhật spec + rule.
- Câu trả lời agent trong app (Markdown user-facing): sửa `SYSTEM` trong `crates/runtime/src/agent/modes.rs`; hợp đồng UI/Copy: `docs/frontend/chat.md`; việc chưa làm: `docs/frontend/chat-markdown-roadmap.md`.
- Rule agent: `.claude/rules/*.md` (frontmatter `paths:`) — sửa xong chạy `npm run check:rules`.
- Docs: mỗi file trong `docs/` có `description` ở frontmatter; sửa docs thì `npm run check:docs`.

## Test theo phạm vi

- `crates/**`: `cargo test -p <crate>` liên quan (hoặc qua `cargo-msvc.bat`). Chỉ chạy cả workspace khi đổi nhiều crate.
- `apps/studio/**`: `npx tsc --noEmit -p apps/studio` và `npm test --workspace @silence/studio` (vitest). UI thuần không bắt eval; kiểm theo spec frontend.
- `docs/**`, rule: `npm run check:docs` / `npm run check:rules`.
- `evals/**` hoặc vòng agent: `npm run evals` khi có key (`SILENCE_API_BASE` / `SILENCE_API_KEY`). Ngoài trường hợp này không chạy eval (tốn API).

## Tự chủ

- Được: sửa code, chạy build/test, đọc log (không in API key).
- Hỏi user trước: `git commit`, push, tag, amend, force.
- Không commit `.env`, secrets, `node_modules/`.
- **Không tự chọn thay user, không đoán ý.** Khi đã đưa phương án (a/b/c) hoặc hỏi user, phải chờ user chọn rõ rồi mới làm. Câu hỏi bị ngắt, bị từ chối hay chưa có trả lời thì **không** được coi là đồng ý với phương án khuyến nghị: dừng lại và hỏi lại. Việc, phạm vi hay thay đổi user chưa chọn thì không tự động sửa.
- Chỉ commit, push, merge khi đã xong trọn một chức năng hoặc một việc (code + test + docs đã kiểm); không commit lẻ tẻ giữa chừng.

## Quy trình Git

- Không push thẳng `main`. Mỗi việc một nhánh ngắn từ `origin/main`: `feat/…`, `fix/…`, `chore/…`, `docs/…`. Hook `.githooks/pre-push` từ chối push vào `main` (bật tự động khi `npm install`); agent trong 5ilence bị Risk Engine chặn (`GIT_PUSH_DEFAULT`, `GIT_NO_VERIFY`).
- Commit theo Conventional Commits. Xong việc thì mở PR vào `main`, đợi CI xanh, **squash merge**, xoá nhánh.
- CI chạy trên mọi PR, base là `main` hay nhánh khác (PR xếp chồng cũng có CI):
  - `ci.yml`: `cargo test --workspace`, `tsc` và `vitest` của Studio.
  - `docs-check.yml`: rule `.claude/rules` hợp lệ, frontmatter docs hợp lệ.
  - Không còn workflow eval trên CI (ADR 0004).
  - `main-guard.yml` chạy sau mỗi lần push `main`: commit không đi qua PR đã merge với CI xanh (hoặc force-push) thì mở issue nhãn `main-guard` và job đỏ. Repo không có branch protection, nên đây là lưới phát hiện, không chặn.
- Test RED chờ plan sau phải có `#[ignore = "RED until Plan …"]` kèm lý do; bỏ `#[ignore]` khi làm plan đó. Không để CI đỏ kéo dài.
