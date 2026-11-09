@AGENTS.md

# Ghi chú riêng cho Claude Code

- Rule theo đường dẫn nằm ở `.claude/rules/` (port từ `.cursor/rules/`, tự nạp khi đụng file khớp). Sửa rule thì sửa cả hai bản, rồi `npm run check:rules` (CI `docs-check.yml` cũng chặn nếu lệch).
- Tìm tài liệu: đọc `docs/README.md`, rồi chỉ mở 1–2 file liên quan. Không đọc cả `docs/` hay `.planning/` nếu task không cần. Mỗi file docs có `description` ở frontmatter: `rg -m1 "^description:" docs` cho biết file nào là gì mà không phải mở. Sửa docs thì chạy `npm run check:docs`.
- Tìm code: `docs/codemap.md` (câu hỏi → file + hàm) trước khi grep rộng; file lớn như `agent.rs` thì grep tên hàm rồi đọc theo khoảng dòng.
- Path không cần đọc đã bị chặn bằng `permissions.deny` trong `.claude/settings.json` (Cursor: `.cursorignore`). Thêm path mới thì sửa cả hai.
- GSD chỉ chạy trong Cursor; ở Claude Code không chạy `/gsd-*`, nên quyền commit tự động của GSD không áp dụng — commit/push luôn hỏi trước.
- Ưu tiên test hẹp: `cargo test -p <crate>` thay vì cả workspace; không chạy `npm run evals` trừ khi đổi agent loop.
