---
id: T-019
title: Bảng "Việc" trong Studio đọc todo/
type: feature
status: todo
phase:
area: [studio]
size: M
model: opus
model-build: sonnet
depends: []
branch:
pr:
created: 2026-11-24
updated: 2026-11-28
---

## Ý bạn

- 👤 **Hỏi:** mở chat mới thì làm sao nhớ phải nhắn gì, làm sao biết một việc đã xong, khi nào nên kết thúc việc
- 👤 **Muốn:** AI giúp trực quan hoá các việc để xem được, có gợi ý
- 🤖 **Đề xuất:** ba cách — bảng chữ trong chat, trang HTML, bảng "Việc" ngay trong Studio; bảng Studio hợp nhất về lâu dài vì 5ilence là harness của bạn, nhưng là tính năng thật
- 👤 **Chọn:** làm bảng chữ `/todo` ngay; bảng trong Studio ghi lại làm sau (việc này)
- Nguồn: chat «Kiến trúc to-do list với AI» (`local_ac1a9b04`) · 2026-11-24

## Mục tiêu

Xem bảng việc trực quan ngay trong Studio thay cho bảng chữ của `/todo`: Now/Next, tiến độ tiêu chí, trạng thái PR/CI, việc nào đang ở chat nào.

## Phạm vi

**Làm:** bảng chỉ đọc `todo/` và sổ giữ việc (`scripts/todo-claims.mjs`); gợi ý việc tiếp theo như `/todo`.
**Không làm:** sửa việc từ trong bảng (chưa chốt; quyết ở pha design).
