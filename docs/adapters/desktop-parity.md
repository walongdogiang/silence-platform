---
description: Danh mục clone Claude desktop app (tab Code) sang 5ilence — tính năng app, bản 5ilence, hiện trạng, ưu tiên, mã việc; nguồn để chọn việc ngang tính năng.
type: roadmap
status: draft
---
# Danh mục clone Claude desktop app

Mục đích 3 của [ADR 0004](../adr/0004-backend-adapters.md): desktop app có gì thì 5ilence có bản tương đương, làm theo thứ tự ưu tiên. Cách làm theo **Hoà giải với nguyên tắc cũ** và **thứ tự cơ chế** trong ADR (CLAUDE.md → skill → hook → MCP của lõi → app).

Lập 2026-11-28 (T-038) từ những gì desktop app có lúc đó. Cột:

- **Hiện trạng:** `có`, `một phần` (thiếu gì ghi ở ghi chú), `đường cũ` (có trong Studio nhưng còn chạy qua Engine Rust), `chưa`.
- **Ưu tiên:** `Now` (cần để thay app hằng ngày), `Next` (dùng hằng tuần), `Later` (chưa dùng hoặc hiếm).
- **Việc:** mã trong `todo/`, hoặc `đề xuất` (chưa có việc; người dùng chọn rồi mới thêm vào `todo/`).

Ưu tiên lấy từ những thứ người dùng dùng hằng tuần ghi trong ADR (session song song, theo dõi PR/Auto-fix, việc theo lịch, browser preview) cộng điều khiển từ điện thoại. Gặp điểm bất tiện mới thì sửa cột ưu tiên ở đây.

## Nền: Claude chạy như terminal

| Tính năng desktop app | Bản 5ilence | Hiện trạng | Ưu tiên | Việc |
| --- | --- | --- | --- | --- |
| Nạp cấu hình user/project/local, đủ tool của Claude Code, môi trường đầy đủ | Adapter theo ADR 0004 Decision 6 | một phần: chỉ `project`, 15 tool, env rút gọn | Now | T-074 |
| Câu hỏi có lựa chọn (`AskUserQuestion`) | Thẻ hỏi trong chat, trả lời qua hook | chưa | Now | T-074 |
| Plan mode, duyệt plan | Chế độ plan + duyệt plan 4 nút | có | — | — |

## Session

| Tính năng desktop app | Bản 5ilence | Hiện trạng | Ưu tiên | Việc |
| --- | --- | --- | --- | --- |
| Nhiều session song song | Chat song song, giới hạn + hàng đợi | có (1.11) | — | — |
| Worktree riêng cho session | Tự tách worktree khi trùng thư mục | có (1.11) | — | — |
| Lịch sử, tiếp tục session của terminal/app | Lịch sử + session ngoài (`listSessions`) | đường cũ | Now | T-032 |
| Rewind, fork | `session.rewind` / `fork` trên lõi | đường cũ | Now | T-032 |
| Tách việc sang session mới (thẻ "New task") | MCP của lõi cho agent đề xuất session, thẻ trong chat | chưa | Next | đề xuất |
| Chapter, mục lục transcript | MCP của lõi đánh dấu chapter, thanh mục lục | chưa | Later | đề xuất |
| Tìm trong transcript các session | Tìm trên event log | chưa | Later | đề xuất |
| Ghim, nhóm session ở thanh bên | Ghim/nhóm trong lịch sử | chưa | Later | đề xuất |

## Trong một lượt

| Tính năng desktop app | Bản 5ilence | Hiện trạng | Ưu tiên | Việc |
| --- | --- | --- | --- | --- |
| Danh sách task ghim dưới tin nhắn | Task list trong chat (từ `TodoWrite`) | có | — | — |
| Câu hỏi cuối thành nút bấm | `systemPrompt.append` quy ước dòng hỏi + nút trong chat | chưa | Next | đề xuất |
| Quota, usage | Sự kiện `quota`/`usage`, trang Số liệu | một phần: chưa có cảnh báo theo bước | Later | T-013 |

## Pane

| Tính năng desktop app | Bản 5ilence | Hiện trạng | Ưu tiên | Việc |
| --- | --- | --- | --- | --- |
| Diff của session | DiffPane | có; chưa nằm trong cột pane phải | Later | đề xuất |
| Terminal | Pane Terminal (`node-pty` trên lõi) | đường cũ | Now | T-031 |
| Xem file | Đọc file qua `fs.*` | đường cũ | Now | T-031 |
| Browser preview dev server | Tab Xem trước | có (T-003) | — | — |
| Thẻ dev server (chạy/dừng, mở vào Xem trước) | Quản lý tiến trình trên lõi | chưa | Later | đề xuất (sau T-034) |
| Chia đôi pane | Chia cột pane | chưa | Later | đề xuất (sau khi lõi quản lý tiến trình) |

## GitHub và nền

| Tính năng desktop app | Bản 5ilence | Hiện trạng | Ưu tiên | Việc |
| --- | --- | --- | --- | --- |
| Theo dõi PR, Auto-fix CI/xung đột/review | Theo dõi PR trên lõi ([ADR 0003](../adr/0003-pr-watch.md)) | chưa | Next | T-009 |
| Việc theo lịch | Lịch ở lõi, chạy bù khi máy thức | chưa | Next | T-010 |
| Chạy tiếp khi đóng cửa sổ | Lõi ở khay | chưa | Next | T-007 |
| Giữ máy thức khi đang chạy | Chặn ngủ khi có lượt chạy | chưa | Later | đề xuất |
| Thông báo khi xong / cần duyệt | Thông báo hệ điều hành, đẩy lên điện thoại | chưa | Next | T-016 |

## Từ xa và cloud (chỉ bản cục bộ)

| Tính năng desktop app | Bản 5ilence | Hiện trạng | Ưu tiên | Việc |
| --- | --- | --- | --- | --- |
| Remote Control, dùng từ điện thoại | WebSocket loopback + `tailscale serve` + PWA | chưa | Next | T-014, T-015, T-017 |
| Duyệt lệnh rủi ro từ xa | Duyệt có xác nhận thêm | chưa | Next | T-016 |
| Session chạy trên cloud | Không làm; container cục bộ cho job không người trông | chưa | Later | T-011 |
| Artifact (trang chia sẻ) | Trang HTML cục bộ mở trong Xem trước | chưa | Later | đề xuất |
| Connector claude.ai | MCP cục bộ do người dùng khai báo | có (MCP của project/plugin) | — | — |

## Làm sau cùng

| Tính năng desktop app | Bản 5ilence | Hiện trạng | Ưu tiên | Việc |
| --- | --- | --- | --- | --- |
| Computer use | Người dùng tự bật trong Settings; Risk Engine + audit riêng | chưa | Later | đề xuất |
| Điều khiển Chrome | Như trên | chưa | Later | đề xuất |

## Chỉ 5ilence có (không phải clone)

Risk Engine và audit, kiểm chứng theo phạm vi file, vòng học, hồ sơ cá nhân, số liệu so với Claude trần: xem tám trụ trong ADR 0004.
