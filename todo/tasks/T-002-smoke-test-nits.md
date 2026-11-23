---
id: T-002
title: Sửa các điểm nhỏ còn lại sau chạy thử 1.8–1.11
status: todo
depends: []
created: 2026-11-23
---

## Mục tiêu

Dọn các lỗi nhỏ thấy khi chạy thử thật Studio (`SILENCE_CORE=1`) ngày 2026-11-23, sau PR #60.

## Bối cảnh

Chạy thử trên repo `D:\vuhieu\test\test-python` (có `.silence/verify.yaml` chạy `python -m compileall -q .`). Spec liên quan: `docs/frontend/chat.md`, `docs/frontend/layout.md`.

Trước khi làm: kiểm nhánh `fix/worktree-card-after-merge` (worktree `5ilence-wt2`) và `fix/perm-card-design` (`5ilence-wt`) — phiên khác có thể đã đang sửa một phần.

## Tiêu chí xong

- [ ] "Worked for —" ở lượt bị ngắt hiện đúng (hoặc ẩn)
- [ ] Thẻ gộp không tràn rộng cột chat
- [ ] Worktree tự dọn sau khi gộp
- [ ] Thẻ diff ghi đường dẫn tương đối theo workspace, không tuyệt đối
- [ ] Trang Số liệu không còn tải ~10s
- [ ] `npx tsc --noEmit -p apps/studio` + vitest Studio xanh; spec cập nhật nếu đổi hành vi
- [ ] PR đã merge (có thể chia nhiều PR)

## Nhật ký
