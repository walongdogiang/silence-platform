---
id: T-021
title: Thẻ xin quyền lõi TS — tô đoạn nguy hiểm, khung mới (cứu từ worktree perm-card-design)
type: feature
status: done
phase: verify
area: [studio, docs]
size: S
model: opus
model-build: sonnet
depends: []
branch: feat/T-021-perm-card-marks
pr: 77
created: 2026-11-25
updated: 2026-11-25
---

## Mục tiêu

Đưa lên `main` phần **lõi TS** của đợt thiết kế lại thẻ xin quyền đang nằm chưa commit ở worktree `D:/vuhieu/5ilence-wt` (nhánh `fix/perm-card-design`, sau PR #58). Xong thì thẻ lõi TS tô đúng đoạn nguy hiểm trong lệnh theo dữ liệu lõi gửi, có khung/nút mới; thẻ Engine Rust giữ nguyên như `main`.

## Phạm vi

**Làm:** `permMarks` + tô `<mark>` trong lệnh (thẻ B và C); khung viền trái theo mức, nhãn mức có nền; thứ tự nút Cho phép ▾ · Từ chối · Từ chối kèm lời dặn · JSON phải; nút chính màu `--accent`; menu ▾ neo trái (C neo phải); tách helper dùng chung (`useCardFocus`, `keyTarget`, `AllowSplit`, `MarkedLine`, `CompactCmd`); spec `chat.md` phần lõi TS, roadmap, rule `security-permissions.md`.
**Không làm (user chọn b, 2026-11-25):** mọi thay đổi `EngineCard` — Engine Rust đóng băng và sẽ xoá ở T-006. Không có `engineKeyAction`, nhánh Engine trong `permLayout`, chuỗi `perm.net` / `perm.saveHostHint` / "…" của `perm.esc.run`, CSS `perm-level-net` / `perm-risk-net` / `perm-danger-ghost` / `perm-blocked`, mục Engine trong `chat.md`.

## Đọc trước

- Patch gốc: `git -C D:/vuhieu/5ilence-wt diff` (bản lưu tạm: scratchpad phiên f6a228ce, `perm-card-wt.patch`; có thể mất khi dọn máy — worktree cũ là nguồn chính).
- `apps/studio/src/renderer/components/PermissionCard.tsx` → `CoreCard`, `EngineCard`, `CallText`.
- `apps/studio/src/renderer/permissionUi.ts` → `permLayout`, `permMarks` (mới).
- `docs/frontend/chat.md` → "Card xin quyền"; `.claude/rules/frontend-*.md`.

## Thiết kế

- **Đã chốt (user, 2026-11-25):** phương án b — cứu phần lõi TS, bỏ phần Engine Rust.
- `EngineCard` giữ nguyên thân như `main`; `CallText` nhận `markTitle` tuỳ chọn, Engine không truyền → không tô (Engine không gửi `segments`). `permMarks` vẫn xử lý `risk.hosts` (mức `net`) vì không tốn gì; class `.perm-mark-net` giữ.
- CSS: **giữ** các luật cũ thẻ Engine đang dùng (`.perm-card h4`, `.perm-tier*`, `.perm-actions`, `.perm-hosts`, `.perm-esc-desc`), vì patch gốc xoá chúng khi Engine chuyển sang khung mới. Thẻ Engine vẫn nhận khung `.perm-card` mới (viền trái xám `--border-strong`) — chấp nhận, user xem ở tiêu chí (user).
- Áp patch: `git apply --3way` báo xung đột ở `styles.css`, `chat.md`, `chat-markdown-roadmap.md` (main đã sửa cạnh đó từ #58) → gỡ tay.

## Kế hoạch

1. [x] Áp patch vào worktree `D:/vuhieu/5ilence-wt3`, gỡ xung đột 3 file trên, giữ phần main mới thêm — kiểm: `git diff --stat origin/main` chỉ gồm 9 file của patch + `todo/`.
2. [x] Gỡ phần Engine trong code: `PermissionCard.tsx` → `EngineCard` trả về như `main` (chỉ đổi lời gọi `CallText`); bỏ import thừa (`ShieldX`, `engineKeyAction`, `hostsText` nếu không dùng). `permissionUi.ts` → bỏ `engineKeyAction`, `permLayout` về logic chỉ lõi TS (giữ `shortCommand` nếu gọn). `i18n.ts` → bỏ 3 thay đổi Engine. — kiểm: `npx tsc --noEmit -p apps/studio`.
3. [x] CSS: giữ luật Engine cũ, bỏ luật chỉ Engine mới dùng (Thiết kế) — kiểm: grep class trong `PermissionCard.tsx` ↔ `styles.css`.
4. [x] Test: bỏ khối `describe("PermissionCard (Rust Engine)")`, test `engineKeyAction`, test C cho Engine; khôi phục test "keeps the Rust Engine card for cards without a level"; giữ test thứ tự nút và tô đoạn — kiểm: vitest Studio.
5. [x] Docs: `chat.md` giữ phần lõi TS (Khung, C, B đầu thẻ, Tô đoạn nguy hiểm, B chân), mục Engine Rust trả về như `main`, bỏ câu "Thẻ Engine Rust cũng dùng cùng bố cục"; roadmap tick; rule giữ — kiểm: `npm run check:docs`, `npm run check:rules`.

## Tiêu chí xong

- [x] Thẻ lõi TS tô `<mark>` đúng đoạn `risk.segments` (không phải `safe`), tooltip = tiêu đề lý do; đoạn phủ cả lệnh không tô — kiểm: test `permMarks` + test "marks the flagged segment" trong `npm test --workspace @silence/studio` → xanh
- [x] Thứ tự nút thẻ B: Cho phép ▾ → Từ chối → Từ chối kèm lời dặn → JSON — kiểm: test "full card: Allow ▾ first…" → xanh
- [x] Thẻ Engine Rust render như `main` (bố cục cũ, nút phạm vi theo `risk.pattern`) — kiểm: test "keeps the Rust Engine card for cards without a level" → xanh; `EngineCard` giống hệt `origin/main` (diff rỗng)
- [x] Không còn `engineKeyAction`, `perm.net`, `perm.saveHostHint` — kiểm: `rg "engineKeyAction|perm\.net\"|saveHostHint" apps/studio` → trống
- [x] tsc + toàn bộ vitest Studio xanh — kiểm: `npx tsc --noEmit -p apps/studio`; `npm test --workspace @silence/studio` → tsc exit 0; 57 file, 370 test pass
- [x] Docs/rule hợp lệ — kiểm: `npm run check:docs`; `npm run check:rules` → 25 docs OK, 6 rule OK
- [ ] (user) Mở Studio, gặp một thẻ quyền lõi TS: thấy viền trái màu, đoạn nguy hiểm được tô, nút đồng; thẻ Engine (nếu còn gặp) vẫn dùng được

## Nhật ký

### 2026-11-25 · design/plan · Opus
- Nguồn: worktree `5ilence-wt` (+620/−215, 9 file, chưa commit; tsc + 30 test thẻ quyền xanh ở đó trước khi tách).
- Quyết định: user chọn b (bỏ phần Engine Rust).
- Bước kế: bước 1 của Kế hoạch.

### 2026-11-25 · bước 1–5 · Opus
- Cách áp: `git stash create` ở worktree cũ rồi `git cherry-pick -n -m1` sang worktree mới (patch thường hỏng vì CRLF). Xung đột ở `PermissionCard.tsx` và `chat.md` do main thêm `scopeHint` (#74) → dùng `scopeHint` ở menu ▾.
- Phát hiện: `.perm-deny` không có CSS riêng từ trước (dùng kiểu `.perm-btn`), không phải lỗi mới.
- Phát hiện: worktree cũ `5ilence-wt` (nhánh `fix/perm-card-design`) vẫn giữ phần Engine; xoá được sau khi PR này merge, nếu user không cần phần Engine.
