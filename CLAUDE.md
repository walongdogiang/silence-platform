@AGENTS.md

# Ghi chú riêng cho Claude Code

- Rule theo đường dẫn nằm ở `.claude/rules/` (port từ `.cursor/rules/`, tự nạp khi đụng file khớp). Sửa rule thì sửa cả hai bản.
- Tìm tài liệu: đọc `docs/README.md`, rồi chỉ mở 1–2 file liên quan. Không đọc cả `docs/` hay `.planning/` nếu task không cần.
- Không đọc: `target/`, `node_modules/`, `Cargo.lock`, `package-lock.json`, `docs/archive/`, `.cursor/agents|skills|gsd-core` (bộ GSD của Cursor).
- GSD chỉ chạy trong Cursor; ở Claude Code không chạy `/gsd-*`, nên quyền commit tự động của GSD không áp dụng — commit/push luôn hỏi trước.
- Ưu tiên test hẹp: `cargo test -p <crate>` thay vì cả workspace; không chạy `npm run evals` trừ khi đổi agent loop.
