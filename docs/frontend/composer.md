---
description: Spec ô nhập chat — context usage, danh sách file, textarea, chọn mode, Auto model, cụm tool bên phải.
type: spec
code:
  - apps/studio/src/renderer/components/Composer.tsx
  - apps/studio/src/renderer/modes.ts
  - apps/studio/src/renderer/models.ts
  - apps/studio/src/renderer/contextUsage.ts
---
# Composer

Bám Cursor chat input. File: `components/Composer.tsx`.

## Cấu trúc (trên → dưới)

1. **Context Usage panel** — chỉ khi bấm vòng gauge.
2. **Files + Review** — chỉ khi `files.length > 0` (tree workspace). Ẩn khi 0 Files.
3. **Textarea** — placeholder luôn: `Plan, Build, / for skills, @ for context`.
4. **Hàng dưới:** mode + Auto (trái) · tools (phải).

## Mode

Thứ tự menu: **Plan → Agent → Debug → MultiTask → Review → Ask**. Icon: List, Infinity, Bug, Users, GitCompare, MessageCircle.

Nút trigger: pill 22px, `border-radius: 999px`, nền `--accent`, chữ/icon `--on-accent` (đen trên copper). Auto **sát phải** mode, **không viền**.

Mỗi mode gửi đúng `mode` cho Engine (hồ sơ ở `profile()` trong `crates/runtime/src/agent.rs`). Hover mục menu hiện mô tả.

| Mode | `mode` | Hành vi |
| --- | --- | --- |
| Plan | `plan` | Chỉ đọc + `submit_plan`. Banner: **Duyệt plan** (Engine lưu `.silence/plans/<ts>.md`, chuyển Agent và tự chạy lượt implement) và **Góp ý / sửa** (giữ Plan, model nộp lại plan). |
| Agent / Code | `agent` | Đủ tool; ghi qua permission + diff. |
| Debug | `debug` | Như Agent + quy trình tái hiện → giả thuyết → bằng chứng → sửa nhỏ nhất → chạy lại. Auto dùng tier `strong`. Gửi kèm 60 dòng cuối tab Output (`context` của `session.prompt`, Engine redact). |
| MultiTask | `multitask` | Như Agent; tách việc độc lập và giao cho sub-agent `task` (hiện chạy tuần tự). |
| Review | `review` | Chỉ đọc; review thay đổi chưa commit, báo lỗi theo mức độ kèm `path:line`. Auto dùng `strong`. Nút **Review** ở hàng Files chọn mode này và điền sẵn yêu cầu. |
| Ask | `ask` | Chỉ đọc, hỏi đáp; không sửa. |

Ask/Review có thêm tool `suggest_mode` (xem "Gợi ý đổi mode" trong `chat.md`). Mode chỉ đọc (Plan/Ask/Review): không có `write`/`edit`/`shell`/`task`, chỉ MCP tool có `readOnlyHint`; Engine từ chối tool ghi kể cả khi model tự gọi. Sub-agent ghi file luôn đi qua permission + diff như agent chính. Mode được đồng bộ bằng `session.set_mode` trước mỗi `session.prompt`.

## Cụm phải

| Trạng thái | Icon |
| --- | --- |
| Ô trống | gauge context · kẹp giấy (tệp) · mic (chưa gắn) · waveform (chưa gắn) |
| Có chữ (`prompt.trim()`) | gauge · kẹp giấy · **mũi tên Enter** (ẩn mic + waveform) |

- **Vòng gauge** = Show context usage, **không** phải Image. Tooltip CSS (không native Windows): `Context · 6.2K / 1M (1%)`.
- **Context của một đoạn chat** = những gì model nhận ở request kế tiếp của session đó. Lấy từ `session.context` (`{ session_id, mode, model }` — mode/model đang chọn trên UI, vì UI chỉ đồng bộ sang session lúc gửi). **Không** dùng `cost.summary`: đó là tổng input token mọi lần gọi của mọi session (số 382K cũ là lỗi này).
  - Các phần: System prompt (`SYSTEM` + system theo mode) · Rules (workspace, `org::system_append`) · Tool definitions (built-in + `submit_plan`/`suggest_mode`/`task`) · MCP tools · Summarized (ghi chú do `compact_if_needed` chèn) · Conversation (user/assistant/tool).
  - Mẫu số = `context_window` của model lượt kế tiếp (Auto → model đã route ở lượt trước; chưa có lượt nào thì router chọn). Không hard-code 256K.
  - Đo vs ước lượng: sau mỗi lần gọi model, Engine lưu `input + output` provider báo về → tổng là số đo, các phần chia theo tỷ lệ ước lượng. Chưa có lượt nào → ước lượng chars/4, hiển thị `~`.
  - Chat trống = System + Rules + Tools (vài nghìn token).
  - Màu: thường < 70% · `--warning` ≥ 70% (Engine tự tóm tắt ở 70%) · `--error` ≥ 90%.
  - Làm mới khi đổi session/thread, mode, model và khi lượt kết thúc. Lỗi (session không còn sau khi Engine restart) → gauge trống đến lượt gửi kế tiếp.
- Panel usage: tổng `used / window`, thanh màu theo phần, chỉ liệt kê phần > 0, dòng ghi chú "Số đo từ lượt gần nhất" / "Ước lượng".
- Hạn chế đã biết: mở lại thread sau khi khởi động lại app → Engine tạo session mới chưa replay lịch sử, nên context chỉ còn phần nền (đúng với cái model thấy). Chi phí `cost.summary` vẫn là tổng toàn cục.
- Enter xóa ô **ngay**. Nút gửi disable nếu chưa session/busy.

## Files menu

Mở xuống từ chip (khi có file) hoặc lên từ kẹp giấy (khi 0 file, chỉ usage). “Show context usage” một dòng, `min-width: 240px`.
