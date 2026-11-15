@AGENTS.md

# Ghi chú riêng cho Claude Code

- Rule theo đường dẫn nằm ở `.claude/rules/` (port từ `.cursor/rules/`, tự nạp khi đụng file khớp).
- Tìm tài liệu: đọc `docs/README.md`, rồi chỉ mở 1–2 file liên quan. Không đọc cả `docs/` nếu task không cần. `rg -m1 "^description:" docs` cho biết file nào là gì mà không phải mở.
- File lớn như `agent/mod.rs`: grep tên hàm rồi đọc theo khoảng dòng.
- Path không cần đọc đã bị chặn bằng `permissions.deny` trong `.claude/settings.json` (Cursor: `.cursorignore`). Thêm path mới thì sửa cả hai.