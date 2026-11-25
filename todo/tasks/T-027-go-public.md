---
id: T-027
title: Chuẩn bị chuyển repo 5ilence sang public
type: chore
status: todo
phase:
area: [ci, docs, agent-kit]
size: M
model: opus
depends: []
branch:
pr:
created: 2026-11-26
updated: 2026-11-26
---

## Mục tiêu

Repo private trên gói Free bị giới hạn 2.000 phút Actions mỗi tháng (tháng 11 dùng khoảng 2.273 phút; CI bị dừng từ 25/11) và không có branch protection. Chuyển sang public để CI không giới hạn phút và bật được branch protection, mà không lộ secrets hay thông tin user không muốn công khai. Model Opus vì có quyết định bảo mật và quyền riêng tư, không chỉ là chore đơn giản.

## Phạm vi sơ bộ

**Đã chốt (user, 2026-11-26):**
- Email trong commit cũ: **giữ nguyên** (phương án 1a). Không viết lại lịch sử, không force-push. Chỉ lộ địa chỉ email, không lộ mật khẩu.
- Chuyển public chứ không giảm phút CI hay dùng self-hosted runner.

**Làm:**
- Quét secrets toàn bộ lịch sử bằng công cụ chuyên dụng (vd `gitleaks`). Quét nhanh theo mẫu ngày 2026-11-25 chỉ thấy khoá giả trong test.
- Rà `docs/`, `todo/`, `.claude/`, `templates/` để tìm thông tin riêng tư (đường dẫn máy, ghi chú cá nhân), rồi lập danh sách nên xoá / nên sửa / ổn cho user chọn.
- Chọn giấy phép (không có / MIT / AGPL…) ở cổng duyệt.
- Đổi `git config user.email` sang email `noreply` của GitHub cho các commit từ nay.
- Hướng dẫn từng bước cho user: bấm public; bật branch protection cho `main` (bắt `ci-ok`); bật duyệt CI cho PR từ người đóng góp lần đầu.
- Cập nhật `AGENTS.md` / skill nếu luật đổi khi có branch protection (vd `main-guard`, `pr-merge.mjs`).

**Không làm:** agent tự bấm public (user làm trong Settings); viết lại lịch sử git.

Bối cảnh: chat 2026-11-25/26 (PR #82, #83), sau khi CI hết phút.
