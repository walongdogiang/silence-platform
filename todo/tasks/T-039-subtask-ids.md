---
id: T-039
title: Việc cha / việc con với mã dấu chấm (T-070.1)
type: feature
status: todo
phase:
area: [agent-kit]
size: M
model: opus
depends: []
branch:
pr:
created: 2026-11-27
updated: 2026-11-27
---

## Mục tiêu

Việc lớn được chia thành việc con có mã nói rõ quan hệ: việc cha `T-070`, việc con `T-070.1`, `T-070.2`… Mọi việc con xong thì việc cha xong. Mỗi PR nhỏ, dễ duyệt, mỗi phiên làm trọn một phần.

User đã chọn dạng dấu chấm (2026-11-27), thay vì `T-070-001` hay mã độc lập kèm `parent:`.

## Phạm vi

**Làm (thiết kế đã chốt với user, chi tiết còn quyết ở pha design):**
- **Mã:**
  - Chỉ 2 cấp, cha `T-NNN` và con `T-NNN.k` (k = 1, 2, …, không đệm số 0). Không có cấp `T-070.1.1`.
  - Mã chỉ để định danh, không mang lĩnh vực hay loại việc.
  - Gạch nối chỉ dùng để ngăn mã với tên: `T-070.2-core-fs.md`, nhánh `feat/T-070.2-core-fs`.
- **Cấu trúc file:** mỗi việc cha một thư mục `todo/tasks/T-070-slug/`, gồm `README.md` của việc cha và các file `T-070.k-slug.md`. Có mẫu riêng cho việc cha (`_template-parent.md`).
- **Việc cha:**
  - Không có PR riêng.
  - Giữ mục tiêu, thiết kế chung, danh sách con và tiêu chí chung (có thể có dòng `(user)`).
  - Đóng trong PR của việc con cuối cùng, khi tiêu chí chung đã đạt; nếu chưa đạt thì chờ user.
- **Việc con:**
  - Một PR, xong trong 1–2 phiên, tối đa ~7 tiêu chí.
  - Nhận việc theo mã con (`claim T-070.2`).
  - Các việc con có vùng file không chồng nhau thì chạy song song được (`--areas`).
- **Mục lục:**
  - Next chỉ ghi việc cha, một dòng kèm tiến độ và việc con kế tiếp, ví dụ `T-070 Xoá Engine Rust ▓▓░░░ 2/5 · tiếp: T-070.3`.
  - Hook và `/todo` gợi ý việc con kế tiếp.
- **Quy tắc:** việc cỡ L không được vào Now khi chưa tách con; pha design của việc cha sinh ra danh sách con.
- **`/todo doctor` kiểm thêm:** việc con mồ côi, việc cha đã đóng mà còn con mở, mã con trùng.
- **Sửa script đọc mã** (hiện đều dùng `/T-\d+/`, sẽ đọc `T-070.2` thành `T-070`):
  - `scripts/todo-claims.mjs`: kiểm mã, doctor, cấp mã con.
  - `scripts/todo-events.mjs`: `TASK`, `TO`, sự kiện `merged`.
  - `scripts/todo-brief.mjs`: đọc mục lục, `blocked-by`.
  - `scripts/pr-merge.mjs`: suy mã việc từ tên nhánh và tiêu đề PR.
  - Kiểm thêm `scripts/todo-owner.mjs` (chưa kiểm có suy mã từ nhánh không).
  - Kèm test trong `scripts/todo.test.mjs`.
- **Sửa skill:** `.claude/skills/todo/SKILL.md` và `cards.md` (thẻ việc cha / con), `.claude/skills/task-git` nếu nhắc mẫu mã.

**Không làm:**
- Đánh số lại việc cũ (T-006, T-031…T-035 giữ nguyên mã, để không hỏng liên kết trong DONE.md, PR, sổ sự kiện).
- Bảng việc dạng cây trong Studio (để T-019).
- Tách T-038: làm ngay sau việc này, theo dạng mới.

## Bối cảnh

- Đụng `highRiskPaths` (`.claude/skills/`, `scripts/pr-merge.mjs`), nên user duyệt ở cổng duyệt trước khi merge.
- Ý tưởng kèm theo (quyết ở design, không bắt buộc): bỏ số lộ trình kiểu "2.1a" khỏi tên việc, cho lộ trình trỏ về mã việc cha (`docs/adapters/migration.md`).
