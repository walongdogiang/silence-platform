@AGENTS.md

# Ghi chú riêng cho Claude Code

- Việc cần làm: `todo/README.md`. User hỏi việc tiếp theo, thêm việc/tính năng, báo xong việc, hay muốn làm tiếp việc dở ở chat khác → dùng skill `todo`. Mỗi chat một việc; việc do chat khác giữ thì không đụng.
- Rule theo đường dẫn nằm ở `.claude/rules/` (tự nạp khi đụng file khớp `paths:`).
- Tìm tài liệu: đọc `docs/README.md`, rồi chỉ mở 1–2 file liên quan. Không đọc cả `docs/` nếu task không cần. `rg -m1 "^description:" docs` cho biết file nào là gì mà không phải mở.
- File lớn như `agent/mod.rs`: grep tên hàm rồi đọc theo khoảng dòng.
- Path không cần đọc đã bị chặn bằng `permissions.deny` trong `.claude/settings.json`.
- **Kết thúc lượt.** Lượt nào có làm việc (việc trong `todo/` hoặc việc user nhờ trong chat) thì tin cuối có đúng một dòng trạng thái ở cuối, trước dòng ❓ nếu có (mẫu: `.claude/skills/todo/cards.md` → 5):
  - `🏁 Đã xong T-xxx: …` chỉ khi: việc trong `todo/` có mọi tiêu chí (trừ `(user)`) đã tick kèm kết quả kiểm và PR đã merge; việc nhờ trong chat thì đã làm hết điều user nhờ và kiểm theo phạm vi đã xanh.
  - `⏳ Đang dở T-xxx: n/m tiêu chí · bước kế: …` khi thiếu bất kỳ điều kiện nào ở trên.
  - `⛔ Chờ bạn T-xxx: …` khi cần user trả lời hoặc tự làm gì đó.
  - Sau dòng `🏁`, thêm **một dòng riêng** `➡️ **Tiếp:** …` (không gộp vào dòng 🏁) chỉ khi bước tiếp khác mặc định "xem `/todo`": nên làm tiếp ở chính chat này (vd sửa lỗi vừa tìm ra); việc kế có điều cần biết (vừa hết bị chặn, cần đổi model, cần user chuẩn bị). Không có gì đáng nói thì bỏ; có từ hai hướng khác nhau thì dùng ❓ thay cho ➡️.
  - User báo đã làm xong bước 👉 cuối cùng → lượt sau tự kiểm, rồi báo `🏁` kèm kết quả kiểm.
  - Lượt chỉ hỏi đáp thì không cần dòng này; không có mã việc thì bỏ mã.
- **Icon chú ý** (user đọc lướt đầu dòng). Mỗi dòng tối đa một icon, ở đầu dòng, theo sau là nhãn in đậm; không dùng icon trang trí chỗ khác:
  - `⚠️ **Lưu ý**`: rủi ro, mất dữ liệu, không hoàn tác được, chưa kiểm, kết quả khác điều user nghĩ. Gần đầu tin, tối đa 3 dòng.
  - `👉 **Bạn làm**`: việc user phải tự làm tay (chạy lệnh, kiểm trên app, bật cài đặt). Cuối tin, trước dòng trạng thái.
  - `➡️ **Tiếp:**`: bước tiếp nên làm, ngay sau dòng 🏁 (điều kiện ở **Kết thúc lượt**).
  - `❓ **Bạn chọn:** 1) … 2) …`: cần user quyết định. Luôn là dòng cuối cùng.
  - Không có gì để user làm hay chọn thì không có 👉 / ❓.
