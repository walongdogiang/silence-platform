---
name: todo
description: Danh sách việc cần làm của repo (todo/README.md). Dùng khi user hỏi việc tiếp theo / review việc tiếp theo / đang làm gì dở, muốn thêm một việc hay tính năng vào danh sách, báo một việc đã xong, hoặc khi phiên kết thúc mà việc đang làm chưa xong.
---

# Danh sách việc (todo/)

- `todo/README.md` — mục lục, nhóm **Now** (≤1 việc) / **Next** (có thứ tự, 3–7) / **Later** / **Ideas**, mỗi việc một dòng. Dòng `Mã tiếp theo: T-xxx` là bộ đếm mã.
- `todo/tasks/T-xxx-slug.md` — chi tiết việc (mẫu: `todo/tasks/_template.md`). Chỉ việc cần hơn ~5 dòng mô tả mới có file; việc nhỏ chỉ là một dòng trong mục lục.
- `todo/DONE.md` — nhật ký việc đã xong, mới nhất ở trên. `todo/tasks/archive/` — file của việc đã xong.

Dạng dòng trong mục lục:

```
- T-014 Theo dõi PR ở khay · [chi tiết](tasks/T-014-pr-watch-tray.md)
- T-016 Mục 1.12 · blocked-by: T-014
- T-017 Sửa focus composer khi đổi tab
```

## Nguyên tắc

- Chỉ đọc `todo/README.md` rồi **đúng file của việc đang bàn**. Không mở các file task khác, không đọc `DONE.md` trừ khi cần tra lại.
- Không tự xếp lại Next, không tự chuyển việc giữa các nhóm, không tự đóng việc: đề xuất kèm lý do rồi chờ user chọn rõ (AGENTS.md → Tự chủ).
- Mã `T-xxx` cố định, không dùng lại. Thứ tự ưu tiên là **vị trí** trong Next, không phải con số.
- File task link tới docs/ADR/backlog, không chép lại nội dung.
- Sửa `todo/` cũng theo quy trình Git của repo (nhánh + PR); khi đang làm một việc có nhánh riêng thì cập nhật `todo/` trong chính PR đó.

## Việc tiếp theo (`next`)

1. Đọc `todo/README.md`.
2. Có việc ở **Now** → đó là việc đang dở: mở file của nó, đọc **Nhật ký**, tóm tắt đã làm tới đâu và bước kế.
3. Now trống → lấy việc **đầu tiên trong Next** mà không có `blocked-by` trỏ tới việc chưa xong. Mở file của nó (nếu có), tóm tắt mục tiêu, tiêu chí xong, chỗ cần đọc trong code/docs.
4. Hỏi user có bắt đầu không. Khi user đồng ý: chuyển dòng sang **Now**, đặt `status: in-progress` trong file task.
5. Next trống → nói vậy và đề xuất 1–3 việc từ Later kèm lý do; không tự chuyển.

## Thêm việc (`add`)

1. Lấy mã ở dòng `Mã tiếp theo`, rồi tăng bộ đếm lên 1.
2. Việc cần hơn ~5 dòng (bối cảnh, tiêu chí xong, phụ thuộc) → tạo `todo/tasks/T-xxx-slug.md` từ mẫu; slug ngắn, tiếng Anh không dấu. Việc nhỏ → chỉ một dòng.
3. Mặc định thêm vào **Later**.
4. Nếu thấy nên vào **Next**, đề xuất vị trí cụ thể và lý do (gấp, đang chặn việc khác, việc khác phụ thuộc vào nó, rẻ mà lợi lớn). Chỉ chuyển khi user đồng ý. Ý tưởng chưa chắc → **Ideas**.
5. Ghi `blocked-by:` (trong dòng) và `depends:` (trong file) nếu phụ thuộc việc khác.
6. Mục lấy từ backlog theo mảng (`docs/security/backlog.md`, `docs/frontend/chat-markdown-roadmap.md`, …) thì link ngược về mục đó; backlog vẫn giữ lý do hoãn.

## Đóng việc (`done`)

Xong = PR đã merge (hoặc user nói xong với việc không có PR). PR mới mở / chờ CI thì việc vẫn ở Now; ghi vào Nhật ký.

1. Xoá dòng khỏi `todo/README.md`.
2. Thêm lên đầu `todo/DONE.md`: `YYYY-MM-DD · T-xxx Tên việc · PR #n`.
3. Có file task → đặt `status: done`, chuyển vào `todo/tasks/archive/`, link trong dòng DONE trỏ tới đó.
4. Việc khác đang `blocked-by` việc này → báo user rằng chúng đã hết bị chặn.

## Ghi nhật ký (phiên kết thúc mà việc chưa xong)

Thêm vào cuối mục **Nhật ký** của file task (việc nhỏ chưa có file thì tạo file khi cần ghi):

```
### YYYY-MM-DD
- Đã làm: …
- Nhánh/PR: …
- Vướng: …
- Bước kế: …
```

Phần này là thứ phiên sau đọc để làm tiếp, nên ghi cụ thể (file, hàm, lệnh test) thay vì chung chung.
