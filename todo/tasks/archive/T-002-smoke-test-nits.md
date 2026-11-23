---
id: T-002
title: Sửa các điểm nhỏ còn lại sau chạy thử 1.8–1.11
status: done
depends: []
created: 2026-11-23
---

## Mục tiêu

Dọn các lỗi nhỏ thấy khi chạy thử thật Studio (`SILENCE_CORE=1`) ngày 2026-11-23, sau PR #60.

## Bối cảnh

Chạy thử trên repo `D:\vuhieu\test\test-python` (có `.silence/verify.yaml` chạy `python -m compileall -q .`). Spec liên quan: `docs/frontend/chat.md`, `docs/frontend/layout.md`.

Trước khi làm: kiểm nhánh `fix/worktree-card-after-merge` (worktree `5ilence-wt2`) và `fix/perm-card-design` (`5ilence-wt`) — phiên khác có thể đã đang sửa một phần.

## Tiêu chí xong

PR #62 đã sửa thẻ gộp tràn cột và đường dẫn tuyệt đối ở thẻ diff (có test), nên hai dòng đó bỏ khỏi danh sách.

- [x] Lượt dừng không có dòng `worked` không còn "Worked for —" mà hiện nhãn không kèm thời gian (`ChatPane.tsx::formatWorked`, `meta.workedNoTime`; test `ChatPane.turns.test.tsx`, 367 vitest pass). Chưa ngắt thử trên Studio thật
- [x] Worktree sau khi gộp: user chọn **giữ như #62** (sống cùng chat, bấm Close để xoá), không đổi code; spec `chat.md` đã nói thẻ gộp chỉ còn Close
- [x] Trang Số liệu: đọc transcript ngoài song song tối đa 8 (`manager.ts::metricsSummary`, `EXTERNAL_READ_CONCURRENCY`); test `metrics.test.ts` (40 transcript, peak 2..8, bỏ qua file lỗi). Chưa đo giây thật trên máy có ~500 transcript
- [x] `npx tsc --noEmit -p apps/studio` (exit 0), vitest Studio (367 pass) và `npm test --workspace @silence/core` (133 pass) xanh
- [x] Spec `docs/frontend/chat.md` cập nhật (nhãn lượt dừng không có `worked`)
- [x] PR đã merge (PR #64, squash 5a96cc9, CI xanh)

## Nhật ký

### 2026-11-24
- Đã làm: chốt lại tiêu chí (user duyệt), tạo nhánh `fix/smoke-test-nits` trong worktree `5ilence-wt2`.
- Nhánh/PR: `fix/smoke-test-nits`, chưa có PR.
- Bước kế: `appendTurnMeta` (`apps/studio/src/renderer/App.tsx`) cho lượt abort; `metricsSummary` (`packages/core/src/sessions/manager.ts:637`) đọc transcript ngoài tuần tự.
- Đã làm tiếp: sửa `formatWorked`, đọc song song ở `metricsSummary`, spec chat.md. Worktree: user chọn giữ như #62.
- Còn: mở PR, đợi CI xanh, squash merge; nên thử bằng Studio thật (`SILENCE_CORE=1`) khi có dịp.

### 2026-11-24 (đóng)
- PR #64 đã squash merge, CI xanh. Việc đóng.
