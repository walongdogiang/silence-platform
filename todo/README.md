# Việc cần làm

Nguồn sự thật duy nhất cho việc sắp làm. Mỗi việc một dòng; việc cần hơn ~5 dòng mô tả (và mọi việc ở Now) có file riêng trong `tasks/`.
Quy trình: skill `todo` (`.claude/skills/todo/SKILL.md`). Việc đã xong: [`DONE.md`](DONE.md).
Số `x.y` trong tên việc là mốc trong [lộ trình chuyển sang harness](../docs/adapters/migration.md) — nội dung chi tiết của mốc nằm ở đó.

```
/todo            xem bảng + việc tiếp theo
/todo add …      thêm việc (AI đề xuất chỗ đặt)
/todo done       đóng việc đang làm (kiểm tiêu chí trước)
/todo log        ghi nhật ký trước khi đóng chat
/todo resume T-xxx   làm tiếp ở chat này việc đang dở ở chat khác
/todo release    trả việc chat này đang giữ
/todo doctor     kiểm mục lục, file task, sổ giữ việc có khớp không
```

Mỗi chat làm một việc; Now tối đa 2 việc. Việc nào đang ở chat nào: `node scripts/todo-claims.mjs list`.

Mã tiếp theo: T-040

## Now

<!-- Tối đa 2 việc đang làm, mỗi việc do đúng một chat giữ (scripts/todo-claims.mjs). -->


## Next

<!-- Có thứ tự, 3–7 việc. Việc tiếp theo = việc đầu tiên không bị blocked-by. -->

- T-039 Việc cha / việc con với mã dấu chấm (T-070.1) · [chi tiết](tasks/T-039-subtask-ids.md)
- T-038 Harness chỉ cộng thêm trên Claude CLI, mục đích clone desktop app (sửa ADR 0004) · [chi tiết](tasks/T-038-additive-harness.md)
- T-006 2.1a Kiểm kê RPC còn qua Engine Rust, quyết định mang sang lõi hay bỏ · [chi tiết](tasks/T-006-remove-rust-engine.md)
- T-031 2.1b Lõi nhận fs.* và terminal (node-pty) · [chi tiết](tasks/T-031-core-fs-terminal.md) · blocked-by: T-006
- T-032 2.1c Lõi nhận lịch sử chat, session.context, rewind, fork · [chi tiết](tasks/T-032-core-history-context.md) · blocked-by: T-006
- T-033 2.1d Bật lõi mặc định, bỏ công tắc SILENCE_CORE, dùng thử · [chi tiết](tasks/T-033-core-default-on.md) · blocked-by: T-031, T-032, T-038
- T-023 Chống các chat đụng nhau (phần 2): nhật ký sửa file, hỏi khi sửa trùng file · [chi tiết](tasks/T-023-file-activity-warn.md)

## Later

<!-- Không xếp thứ tự. Việc mới mặc định vào đây. -->

- T-004 Ngôn ngữ đợt 2: file agent đọc mỗi phiên sang tiếng Anh · [chi tiết](tasks/T-004-lang-batch-2.md)
- T-001 Thử bước Apply của 1.9 (commit + push `~/.silence` thật — cần user đồng ý trước)
- T-034 2.1e Xoá UI chỉ phục vụ Engine cũ · [chi tiết](tasks/T-034-remove-engine-ui.md) · blocked-by: T-033
- T-035 2.1f Xoá crates/, Cargo, job Rust trong CI, sửa docs · [chi tiết](tasks/T-035-remove-rust-crates.md) · blocked-by: T-034
- T-005 Ngôn ngữ đợt 3: phần còn lại của `docs/` sang tiếng Anh, một PR · blocked-by: T-004, T-035
- T-007 2.2 Lõi sống ở khay khi đóng cửa sổ; tự chạy cùng hệ điều hành (tuỳ chọn) · blocked-by: T-035
- T-008 2.3 Hàng đợi theo quota, dừng việc nền khi gần hết quota (giới hạn + hàng đợi cơ bản đã có ở 1.11) · blocked-by: T-035
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
- T-024 Lời báo hook chủ worktree: chat chủ đang làm T-xxx nào + tên chat dễ nhận ra · [chi tiết](tasks/T-024-owner-msg-context.md)
- T-025 Phiên con dùng đúng mã phiên của chính nó · [chi tiết](tasks/T-025-side-session-id.md)
- T-026 Sổ chủ worktree tự bỏ mục của worktree đã bị xoá · [chi tiết](tasks/T-026-stale-worktree-owner.md)
- T-036 Chat mở lại (đổi model, mã phiên mới) vẫn được nhận là cùng chat chủ worktree · [chi tiết](tasks/T-036-chat-reopen-identity.md)
- T-028 Bật Dependabot alerts (báo lỗ hổng thư viện npm/cargo; user bật trong Settings → Advanced Security)
- T-029 Ghim GitHub Actions theo SHA thay vì tag (`actions/checkout@v4`, `dorny/paths-filter@v3`, `dtolnay/rust-toolchain@stable`, `Swatinem/rust-cache@v2`) — repo public dễ bị nhắm; bỏ qua `dtolnay/rust-toolchain`, `Swatinem/rust-cache` nếu T-035 (xoá Rust) làm trước
- T-030 `cache-cleanup.yml` bỏ qua PR từ fork (token chỉ đọc nên job đỏ)

## Ideas

<!-- Chưa chắc có làm. -->

- T-018 Giai đoạn 5: backend thứ hai (Codex `app-server` hoặc ACP) kèm bộ chuyển hồ sơ/skill
