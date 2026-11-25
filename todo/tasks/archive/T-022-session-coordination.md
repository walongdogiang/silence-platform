---
id: T-022
title: Điều phối nhiều phiên — sổ sự kiện chung, vùng file, hộp thư, vai master
type: feature
status: done
phase: verify
area: [agent-kit]
size: M
model: opus
model-build: sonnet
depends: []
branch: feat/T-022-session-coordination
pr: 78
created: 2026-11-25
updated: 2026-11-25
---

## Mục tiêu

Mọi phiên Claude Code trên repo biết phiên khác vừa làm gì có ảnh hưởng tới mình (merge đụng vùng mình sửa, đổi hợp đồng chung, lời nhắn), không cần hỏi qua ai. Có vai master tuỳ chọn để chia việc, nhưng sự thật nằm trong sổ do script giữ.

## Phạm vi

**Làm:** sổ sự kiện `todo-events.jsonl` (thư mục git chung) + schema; `claim --areas` cảnh báo trùng vùng; `event`, `feed`, `master` trong `scripts/todo-claims.mjs`; `pr-merge.mjs` tự ghi `merged`; hook SessionStart/UserPromptSubmit đẩy ≤3 dòng sự kiện mới liên quan; skill `todo`/`task-git`; ADR 0006.
**Không làm:** chủ worktree, trạng thái 🟢🟡⚪, chặn commit bằng PreToolUse (T-020); sửa `.claude/settings.json` (hook cũ đủ dùng); UI Studio (T-019).

## Bối cảnh

[ADR 0006](../../../docs/adr/0006-session-coordination.md) (quyết định + lý do). T-020 cũng sửa `scripts/todo-claims.mjs` → logic sự kiện để ở module riêng `scripts/todo-events.mjs`, móc vào script cũ ít nhất có thể.

Phát hiện khi bắt đầu: thư mục chính còn ở `387c629`, trong khi `origin/main` đã dùng mã T-021 (PR #77) — chính loại va chạm việc này muốn báo sớm.

## Thiết kế

**Đã chốt (user chọn 2026-11-25):** phương án lai — sổ do script + hook giữ, master là một phiên điều phối tuỳ chọn; mọi phiên đọc thẳng sổ, ghi chỉ qua CLI có kiểm schema; làm thành tooling repo trước, sau chuyển vào event log của lõi.

- Sự kiện: `{v, ts, kind, session, task?, pr?, areas?, files?, to?, text?}`. `kind`: `claim | release | handoff | pr_opened | ci_red | merged | contract_changed | blocked | note`. Trường lạ, mã sai, `text` > 200 ký tự → từ chối.
- Tự sinh: `claim`/`release`/takeover (todo-claims), `merged` (pr-merge). Ghi tay: `pr_opened`, `ci_red`, `contract_changed`, `blocked`, `note`.
- Liên quan tới một phiên: `note`/`blocked` gửi việc mình, `all`, hoặc `master` khi mình là master; `merged` có file khớp `areas` của mình → "cần rebase"; `contract_changed`; còn lại (merged khác) chỉ đếm. Không tính sự kiện của chính phiên.
- Con trỏ đọc: `sessions[id].lastEvent` (ts). Phiên mới: xem 24 giờ gần nhất.
- `areas`: glob kiểu `packages/protocol/**`; trùng = tiền tố tĩnh của glob này là tiền tố của glob kia. Chỉ cảnh báo.

## Kế hoạch

1. [x] `scripts/todo-events.mjs`: `eventsPathFor`, `makeEvent` (kiểm schema), `appendEvent`, `readEvents`, `areasOverlap`, `matchArea`, `relevantFor`, `formatEvent` — kiểm: test.
2. [x] `scripts/todo-claims.mjs`: `claim --areas` (lưu + cảnh báo trùng + sự kiện), sự kiện cho release/takeover, lệnh `event`, `feed`, `master`; heartbeat in sự kiện liên quan và dời con trỏ — kiểm: test + chạy tay.
3. [x] `scripts/pr-merge.mjs`: merge xong → `merged` (pr, task từ nhánh/tiêu đề, files, `--session`) — kiểm: test hàm dựng sự kiện.
4. [x] `scripts/todo-brief.mjs`: dòng `[todo] Từ lần trước: …`, master hiện tại — kiểm: test `brief`.
5. [x] Skill `todo` (mục Điều phối), `task-git` (areas, `pr_opened`, `--session` cho pr-merge); ADR 0006 + `docs/README.md` — kiểm: `npm run check:docs`, `npm run check:rules`.

## Tiêu chí xong

- [x] Schema từ chối kind lạ, trường lạ, mã sai, text dài — kiểm: `npm run test:todo` → `makeEvent` test pass; chạy tay: `event progress` và text 210 ký tự bị từ chối
- [x] Merge đụng `areas` của phiên A → heartbeat của A in "cần rebase"; phiên gây ra không tự nhận — kiểm: `npm run test:todo` → test `relevantFor`, chạy tay heartbeat A in `cần rebase` cho PR #80 giả
- [x] `note --to T-xxx` / `--to master` tới đúng phiên, chỉ một lần (con trỏ) — kiểm: `npm run test:todo` → test `pullEvents` (lượt 2 rỗng), chạy tay master nhận `--to master`
- [x] `claim --areas` trùng vùng việc khác → cảnh báo, vẫn nhận — kiểm: `npm run test:todo` → test `overlaps`, chạy tay in `Cảnh báo: vùng chồng với T-022`
- [x] `pr-merge.mjs` dựng sự kiện `merged` đúng task/files — kiểm: `npm run test:todo` → test `mergedEvent` pass
- [x] Docs + rule hợp lệ — kiểm: `npm run check:docs` · `npm run check:rules` → 26 docs OK · 6 rule OK
- [ ] (user) Sau khi pull main ở thư mục chính: hai chat, chat B `event note --to T-xxx`, chat A thấy ở lượt kế

## Phát sinh

- T-020 cũng sửa `scripts/todo-claims.mjs` (worktree, trạng thái phiên): làm sau việc này thì rebase; có thể ghi `claim` theo worktree vào sổ sự kiện luôn.
- Thư mục chính đang ở `387c629`, sau `origin/main`: hook chạy bản script cũ tới khi user cập nhật thư mục chính.

## Nhật ký

### 2026-11-25 · bắt đầu · Opus
- Quyết định: mã T-022 (T-021 đã bị PR #77 dùng); worktree `D:\vuhieu\5ilence-t021` (tên thư mục giữ từ lúc tạo).
- Bước kế: bước 1.

### 2026-11-25 · verify · Opus
- Quyết định: logic sự kiện ở module riêng `scripts/todo-events.mjs` để T-020 ít đụng; `touchSession` giữ field cũ của phiên (trước đó ghi đè, sẽ mất con trỏ `lastEvent`).
- Đã kiểm: `npm run test:todo` 16 pass; chạy tay đủ luồng trong repo git tạm (không đụng sổ thật).
