# Việc cần làm

Nguồn sự thật duy nhất cho việc sắp làm. Mỗi việc một dòng; việc cần hơn ~5 dòng mô tả (và mọi việc ở Now) có file riêng trong `tasks/`.
Quy trình: skill `todo` (`.claude/skills/todo/SKILL.md`). Việc đã xong: [`DONE.md`](DONE.md).
Số `x.y` trong tên việc là mốc trong [lộ trình chuyển sang harness](../docs/adapters/migration.md) — nội dung chi tiết của mốc nằm ở đó.

```
/todo            xem bảng + việc tiếp theo
/todo add …      thêm việc (AI đề xuất chỗ đặt)
/todo done       đóng việc đang làm (kiểm tiêu chí trước)
/todo log        ghi nhật ký trước khi đóng chat
```

Mã tiếp theo: T-020

## Now

<!-- Tối đa 1 việc đang làm. -->

## Next

<!-- Có thứ tự, 3–7 việc. Việc tiếp theo = việc đầu tiên không bị blocked-by. -->

- T-002 Sửa các điểm nhỏ còn lại sau chạy thử 1.8–1.11 · [chi tiết](tasks/T-002-smoke-test-nits.md)
- T-003 1.12 Pane xem dev server / URL · [chi tiết](tasks/T-003-browser-preview.md)
- T-004 Ngôn ngữ đợt 2: file agent đọc mỗi phiên sang tiếng Anh · [chi tiết](tasks/T-004-lang-batch-2.md)
- T-005 Ngôn ngữ đợt 3: phần còn lại của `docs/` sang tiếng Anh, một PR · blocked-by: T-004

## Later

<!-- Không xếp thứ tự. Việc mới mặc định vào đây. -->

- T-001 Thử bước Apply của 1.9 (commit + push `~/.silence` thật — cần user đồng ý trước)
- T-006 2.1 Xoá Engine Rust (chia PR) · [chi tiết](tasks/T-006-remove-rust-engine.md)
- T-007 2.2 Lõi sống ở khay khi đóng cửa sổ; tự chạy cùng hệ điều hành (tuỳ chọn)
- T-008 2.3 Hàng đợi theo quota, dừng việc nền khi gần hết quota (giới hạn + hàng đợi cơ bản đã có ở 1.11)
- T-009 3.1 Theo dõi PR và tự sửa trên lõi mới ([ADR 0003](../docs/adr/0003-pr-watch.md), [spec](../docs/pr-watch.md))
- T-010 3.2 Việc theo lịch/sự kiện, chạy bù khi máy thức
- T-011 3.3 Container cho job không người trông
- T-012 3.4 Quy trình khai báo (plan → làm → kiểm → PR)
- T-013 3.5 Đổi model theo bước, cảnh báo quota
- T-014 4.1 Kênh WebSocket của API lõi (loopback + token)
- T-015 4.2 Renderer chạy trên web, PWA cho điện thoại
- T-016 4.3 Thông báo đẩy, duyệt lệnh rủi ro từ xa
- T-017 4.4 Hướng dẫn `tailscale serve`
- T-019 Bảng "Việc" trong Studio đọc `todo/` (Now/Next, tiến độ tiêu chí, PR/CI) — thay bảng chữ của `/todo`

## Ideas

<!-- Chưa chắc có làm. -->

- T-018 Giai đoạn 5: backend thứ hai (Codex `app-server` hoặc ACP) kèm bộ chuyển hồ sơ/skill
