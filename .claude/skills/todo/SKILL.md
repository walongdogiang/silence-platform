---
name: todo
description: Danh sách việc cần làm của repo (todo/README.md). Dùng khi user gõ /todo, hỏi việc tiếp theo / làm tiếp / đang làm gì dở / xem bảng việc, muốn thêm một việc hay tính năng vào danh sách, báo một việc đã xong, khi mọi tiêu chí của việc ở Now vừa đạt, hoặc khi phiên sắp kết thúc mà việc đang làm chưa xong.
argument-hint: "[add <mô tả> | done | log]"
---

# Danh sách việc (todo/)

- `todo/README.md` — mục lục, nhóm **Now** (≤1 việc) / **Next** (có thứ tự, 3–7) / **Later** / **Ideas**, mỗi việc một dòng. Dòng `Mã tiếp theo: T-xxx` là bộ đếm mã.
- `todo/tasks/T-xxx-slug.md` — chi tiết việc (mẫu: `todo/tasks/_template.md`). Việc ở Later/Next cần hơn ~5 dòng mô tả mới có file; việc vào **Now** thì luôn có file (để chứa tiêu chí xong và nhật ký).
- `todo/DONE.md` — nhật ký việc đã xong, mới nhất ở trên. `todo/tasks/archive/` — file của việc đã xong.
- Hook SessionStart (`scripts/todo-brief.mjs`) đã nạp sẵn 2–3 dòng Now/Next vào đầu phiên.

Dạng dòng trong mục lục:

```
- T-014 Theo dõi PR ở khay · [chi tiết](tasks/T-014-pr-watch-tray.md)
- T-016 Mục 1.12 · blocked-by: T-014
- T-017 Sửa focus composer khi đổi tab
```

## Lệnh

| User gõ / nói | Làm |
|---|---|
| `/todo`, "việc tiếp theo", "làm tiếp", "xem bảng việc" | **Bảng** rồi **Việc tiếp theo** |
| `/todo add <mô tả>`, "thêm việc …" | **Thêm việc** |
| `/todo done`, "xong rồi" | **Đóng việc** |
| `/todo log`, "ghi lại rồi đóng chat" | **Ghi nhật ký** |

## Nguyên tắc

- Chỉ đọc `todo/README.md` rồi **đúng file của việc đang bàn**. Không mở các file task khác, không đọc `DONE.md` trừ khi cần tra lại.
- Không tự xếp lại Next, không tự chuyển việc giữa các nhóm, không tự đóng việc: đề xuất kèm lý do rồi chờ user chọn rõ (AGENTS.md → Tự chủ).
- Mã `T-xxx` cố định, không dùng lại. Thứ tự ưu tiên là **vị trí** trong Next, không phải con số.
- File task link tới docs/ADR/backlog, không chép lại nội dung.
- Sửa `todo/` cũng theo quy trình Git của repo (nhánh + PR); khi đang làm một việc có nhánh riêng thì cập nhật `todo/` trong chính PR đó.

## Bảng

In một khối code gọn, không dài hơn ~12 dòng:

```
NOW   T-002 Sửa điểm nhỏ sau chạy thử     ▓▓▓░░ 3/5 · PR #62 CI xanh
NEXT  T-003 1.12 Pane dev server
      T-004 Ngôn ngữ đợt 2
      T-005 Ngôn ngữ đợt 3            ⛔ chờ T-004
LATER 13 việc · IDEAS 1
```

- Thanh tiến độ = số tiêu chí đã tick / tổng trong file của việc ở Now (5 ô, làm tròn).
- Việc ở Now có nhánh/PR (ghi trong Nhật ký) → kiểm trạng thái bằng `gh pr view <n> --json state,statusCheckRollup` và ghi ngắn (mở / CI xanh / CI đỏ / đã merge).
- Sau bảng là tối đa 3 dòng **Gợi ý**, chỉ những dòng có thật:
  - việc tiếp theo nên làm và một lý do;
  - việc vừa hết bị chặn (mã trong `blocked-by` không còn trong mục lục);
  - việc ở Now mà Nhật ký mới nhất cũ hơn 3 ngày, hoặc đã qua hơn 3 phiên → hỏi còn làm không, có nên tách;
  - việc có hơn ~7 tiêu chí → đề xuất tách;
  - tiêu chí còn thiếu của việc ở Now (nêu tên, không chỉ con số).

## Việc tiếp theo

1. Có việc ở **Now** → đó là việc đang dở: mở file của nó, đọc **Nhật ký** và **Tiêu chí xong**, nói đã làm tới đâu, tiêu chí nào còn thiếu, bước kế.
2. Now trống → lấy việc **đầu tiên trong Next** mà không có `blocked-by` trỏ tới mã còn trong mục lục. Mở file của nó (nếu có), tóm tắt mục tiêu và chỗ cần đọc trong code/docs.
3. Hỏi user có bắt đầu không. Khi user đồng ý → **Bắt đầu việc**.
4. Next trống → nói vậy và đề xuất 1–3 việc từ Later kèm lý do; không tự chuyển.

## Bắt đầu việc (chốt tiêu chí xong)

1. Chưa có file → tạo từ mẫu.
2. Viết **Tiêu chí xong** trước khi code: mỗi dòng kiểm được bằng chứng cứ cụ thể (lệnh test, hành vi thấy được trên UI, docs/spec đã sửa, PR đã merge). Không có dòng mơ hồ kiểu "chạy ổn", "code sạch".
3. Đưa danh sách cho user duyệt; user sửa/đồng ý rồi mới làm.
4. Chuyển dòng sang **Now**, đặt `status: in-progress`.

## Trong lúc làm

- Tick một tiêu chí **chỉ khi đã kiểm thật**, ghi chứng cứ ngay trên dòng: `- [x] vitest Studio xanh (npm test --workspace @silence/studio, 214 pass)`. Không tick theo suy đoán.
- **Không nới phạm vi.** Gặp việc ngoài tiêu chí ("tiện sửa luôn…") → nói với user, đề xuất **Thêm việc** vào Later; việc hiện tại vẫn bám tiêu chí. Chỉ thêm tiêu chí khi user đồng ý rõ.
- Cuối mỗi lượt có sửa code cho việc ở Now: so trạng thái với tiêu chí. Đủ hết → hỏi "Đóng T-xxx chứ?". Còn thiếu → nêu ngắn tiêu chí còn lại.

## Khi nào kết thúc

| Tín hiệu | Làm |
|---|---|
| Mọi tiêu chí đã tick và PR đã merge | Hỏi đóng → **Đóng việc** |
| Mọi tiêu chí đã tick, PR chưa merge | Việc vẫn ở Now; ghi Nhật ký "chờ CI/merge" |
| Hơn ~7 tiêu chí, hoặc qua hơn 3 phiên chưa xong | Đề xuất tách thành nhiều việc, mỗi việc một PR |
| Phiên dài, ngữ cảnh đã nặng, hoặc user sắp đóng chat | Kết thúc **phiên**, không phải việc: **Ghi nhật ký**, nhắc user mở chat mới và gõ `/todo` |

## Thêm việc

1. Lấy mã ở dòng `Mã tiếp theo`, rồi tăng bộ đếm lên 1.
2. Việc cần hơn ~5 dòng (bối cảnh, tiêu chí, phụ thuộc) → tạo `todo/tasks/T-xxx-slug.md` từ mẫu; slug ngắn, tiếng Anh không dấu. Việc nhỏ → chỉ một dòng.
3. Mặc định thêm vào **Later**.
4. Nếu thấy nên vào **Next**, đề xuất vị trí cụ thể và lý do (gấp, đang chặn việc khác, việc khác phụ thuộc vào nó, rẻ mà lợi lớn). Chỉ chuyển khi user đồng ý. Ý tưởng chưa chắc → **Ideas**.
5. Ghi `blocked-by:` (trong dòng) và `depends:` (trong file) nếu phụ thuộc việc khác.
6. Mục lấy từ backlog theo mảng (`docs/security/backlog.md`, `docs/frontend/chat-markdown-roadmap.md`, …) thì link ngược về mục đó; backlog vẫn giữ lý do hoãn.

## Đóng việc

Xong = mọi tiêu chí đã tick **và** PR đã merge (kiểm bằng `gh`), hoặc user nói xong với việc không có PR. Còn tiêu chí chưa tick → nêu ra, không đóng.

1. Xoá dòng khỏi `todo/README.md`.
2. Thêm lên đầu `todo/DONE.md`: `YYYY-MM-DD · T-xxx Tên việc · PR #n`.
3. Đặt `status: done` trong file task, chuyển vào `todo/tasks/archive/`, link trong dòng DONE trỏ tới đó.
4. Việc khác đang `blocked-by` việc này → báo user rằng chúng đã hết bị chặn.
5. Hiện **Bảng** mới và đề xuất việc tiếp theo.

## Ghi nhật ký

Thêm vào cuối mục **Nhật ký** của file task:

```
### YYYY-MM-DD
- Đã làm: …
- Nhánh/PR: …
- Vướng: …
- Bước kế: …
```

Phần này là thứ phiên sau đọc để làm tiếp, nên ghi cụ thể (file, hàm, lệnh test) thay vì chung chung.
