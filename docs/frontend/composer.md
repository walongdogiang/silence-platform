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

Mode chỉ đọc (Plan/Ask/Review): không có `write`/`edit`/`shell`/`task`, chỉ MCP tool có `readOnlyHint`; Engine từ chối tool ghi kể cả khi model tự gọi. Sub-agent ghi file luôn đi qua permission + diff như agent chính. Mode được đồng bộ bằng `session.set_mode` trước mỗi `session.prompt`.

## Cụm phải

| Trạng thái | Icon |
| --- | --- |
| Ô trống | gauge context · kẹp giấy (tệp) · mic (chưa gắn) · waveform (chưa gắn) |
| Có chữ (`prompt.trim()`) | gauge · kẹp giấy · **mũi tên Enter** (ẩn mic + waveform) |

- **Vòng gauge** = Show context usage, **không** phải Image. Tiến độ `input_tokens / 256_000`: 0 = chỉ track mờ, 256k = kín. Tooltip CSS (không native Windows).
- Panel usage: hàng Conversation dùng token thật; các hàng System/Tools/Rules… = 0 cho đến khi runtime gửi breakdown.
- Enter xóa ô **ngay**. Nút gửi disable nếu chưa session/busy.

## Files menu

Mở xuống từ chip (khi có file) hoặc lên từ kẹp giấy (khi 0 file, chỉ usage). “Show context usage” một dòng, `min-width: 240px`.
