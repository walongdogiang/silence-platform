@AGENTS.md

# Ghi chú riêng cho Claude Code

- Việc cần làm: `todo/README.md`. User hỏi việc tiếp theo, thêm việc/tính năng, báo xong việc, hay muốn làm tiếp việc dở ở chat khác → dùng skill `todo`. Mỗi chat một việc; việc do chat khác giữ thì không đụng.
- Rule theo đường dẫn nằm ở `.claude/rules/` (tự nạp khi đụng file khớp `paths:`).
- Tìm tài liệu: đọc `docs/README.md`, rồi chỉ mở 1–2 file liên quan. Không đọc cả `docs/` nếu task không cần. `rg -m1 "^description:" docs` cho biết file nào là gì mà không phải mở.
- File lớn như `agent/mod.rs`: grep tên hàm rồi đọc theo khoảng dòng.
- Path không cần đọc đã bị chặn bằng `permissions.deny` trong `.claude/settings.json`.
- **Kết thúc lượt.** Lượt nào có làm việc (việc trong `todo/` hoặc việc user nhờ trong chat) thì tin cuối có đúng một dòng trạng thái ở cuối, trước câu hỏi chọn nếu có (mẫu: `.claude/skills/todo/cards.md` → 5):
  - `🏁 Đã xong T-xxx: …` chỉ khi: việc trong `todo/` có mọi tiêu chí (trừ `(user)`) đã tick kèm kết quả kiểm và PR đã merge; việc nhờ trong chat thì đã làm hết điều user nhờ và kiểm theo phạm vi đã xanh.
  - `⏳ Đang dở T-xxx: n/m tiêu chí · bước kế: …` khi thiếu bất kỳ điều kiện nào ở trên.
  - `⛔ Chờ bạn T-xxx: <một câu hỏi>` khi cần user trả lời hoặc tự làm gì đó.
  - Lượt chỉ hỏi đáp thì không cần dòng này; không có mã việc thì bỏ mã.
