---
description: Spec trang Evals trong Studio — chọn bộ/task/nguồn/model, ước tính chi phí, chạy và xem tiến độ, chi tiết task, cấu hình đã lưu, đặt lại mặc định.
type: spec
code:
  - apps/studio/src/renderer/components/EvalsPage.tsx
  - apps/studio/src/renderer/evalConfig.ts
  - apps/studio/src/renderer/evalLive.ts
  - crates/runtime/src/eval_rpc.rs
---

# Trang Evals

Chạy eval agent ngay trong Studio, thay cho `npm run evals …`. Cách eval chấm điểm, ghim model, lịch sử: `evals/README.md`.

## Mở trang

- Lối vào chính: icon **Evals** (bình thí nghiệm) trên TitleBar, giữa Chat và Settings. Ngoài ra: **View → Evals**, `Ctrl+Shift+E`, hoặc Settings → **Giới thiệu** → hàng **Evals** (lối tắt).
- Bấm lại icon, nút **×** ở đầu trang, hoặc mở chat/file khác thì trang đóng. Lượt chạy vẫn tiếp tục.
- Mọi lối vào chỉ hiện khi Engine thấy thư mục `evals/` ở repo root (`eval.catalog` trả `available: true`), tức là khi chạy từ checkout của repo 5ilence.

## Theo dõi khi chạy

- Trạng thái lượt chạy nằm ở App (`evalLive.ts`, `useEvalLive`), không nằm trong trang: đóng trang không mất tiến độ.
- Khi đang chạy, icon trên TitleBar có chip `Đang chạy x/y · $` (chuỗi `evals.running`); bấm để mở lại trang.
- Mở app hoặc reload cửa sổ: App gọi `eval.status` (`{running, events}`: mọi sự kiện `eval.progress` của lượt hiện tại hoặc lượt gần nhất) rồi phát lại qua cùng reducer, nên bảng kết quả hiện đủ.
- Chạy xong hoặc lỗi khi cửa sổ không được focus: thông báo OS theo Settings → Thông báo (dùng `notifyDone`, chỉ gửi tên bộ và số pass/fail).

## Bố cục

**Cột trái: cấu hình**
- **Cấu hình đã lưu:** dropdown (Hiện tại / các tên đã lưu), Lưu (ghi đè tên đang chọn), Lưu thành… (ô nhập tên ngay trên trang), Xoá, **Đặt lại mặc định**.
- **Mặc định:** bộ `v0`, mọi task, model riêng của từng task, 1 lần thử, không retry, trần $1, không ghi lịch sử.
- **Form:**
  - Bộ (đổi bộ thì chọn hết task của bộ đó).
  - Nguồn: "Model riêng của từng task" hoặc một nguồn. Nguồn chưa dùng được bị mờ, kèm lý do.
  - Model: theo ghim / Auto / một model của nguồn đã chọn.
  - Mức suy nghĩ, Số lần thử (1–5), Trần chi phí, Retry khi trượt, Ghi vào lịch sử.
- **Danh sách task:** checkbox, tìm theo id, lọc theo loại và theo kết quả lần trước (trượt / chưa chạy), các nút Chọn hết / Bỏ hết / Chỉ task trượt lần trước. Mỗi dòng có loại, mode, model sẽ chạy (sau khi quy đổi theo nguồn), lý do sẽ bị bỏ qua nếu có (vd. thiếu biến môi trường), và kết quả + chi phí lần trước.
- **Chân trang (dính đáy):** ước tính chi phí, rồi nút Chạy n task; khi đang chạy thì là nút Dừng.

**Cột phải: kết quả**
- **Kết quả trực tiếp** (`eval.progress`): thanh tiến độ, bảng task / kết quả / model / chi phí / thời gian; tổng kết khi xong; nút **Chạy lại task trượt (n)**, nút này chỉ đặt lại danh sách task chứ không tự chạy.
- **Chi tiết task:** bấm một dòng đã xong để mở, gồm:
  - tab Báo cáo (Markdown như chat), tab Thay đổi (file thêm/sửa/xoá so với fixture, trước/sau), tab Audit;
  - chọn lần thử khi có nhiều lần;
  - nút **Mở thư mục** (main chỉ cho phép đường dẫn trong `evals/results`).
- **Lần chạy gần đây:** 10 file `metrics-*.json` mới nhất, mỗi lần có nút "Dùng các task này" và "Chạy lại task trượt"; chip theo task (màu theo kết quả) mở chi tiết task.

## Quy tắc

- **Chọn nguồn thì giữ tier, đổi nguồn:** task ghim `claude-haiku` chạy `claude-haiku@api` khi chọn Anthropic API (cùng họ model, không có thì cùng tier); task `auto` chạy Auto trong nguồn đó. Không quy đổi được thì task bị bỏ qua, kèm lý do.
- **Ước tính chi phí:** trung bình 3 lần chạy gần nhất của task trên cùng họ model; không có thì trung bình theo loại task; vẫn không có thì báo "chưa có dữ liệu". Số này nhân với số lần thử. Lượt hiệu chỉnh không tính.
- **Mỗi lúc chỉ một lượt chạy;** Dừng thì huỷ lần thử đang chạy, các task còn lại thành SKIP ("cancelled").
- **Chạy từ Studio:**
  - mặc định không ghi `history/runs.jsonl` (bật bằng ô "Ghi vào lịch sử");
  - kết quả luôn ở `evals/results/<task>/attempt-<n>/` và `metrics-<run>.json`, với profile `studio`.
- **Renderer chỉ chọn chạy cái gì.** Không có tham số quyền: session eval do Engine tạo, trên bản sao fixture.
- Mọi chữ lấy từ `i18n.ts` (`evals.*`).
- Cấu hình lưu ở `localStorage` `silence.evals.v1`. Cấu hình cũ có task/nguồn không còn thì tự lọc bỏ (`sanitize`).
