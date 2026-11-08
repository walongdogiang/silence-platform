# Hội thoại (ChatPane)

Trung tâm là thảo luận user ↔ AI. Bám Cursor: bubble user → **Worked for** (Thought + **Explored** + bước) → chữ AI → chân tin nhắn.

## Cấu trúc một lượt (Cursor-like)

```
[1] User bubble
[2] Agent meta
      summary: Worked for 21s | Working…
      body:
        Thought 3s ▾                                 ← một nhãn; mở = full thinking
          <toàn bộ reasoning stream>
        Explored 2 files, 4 searches ▾               ← ẩn nếu không có activity
          Reading STATE.md
        chat → claude-haiku                          ← route muted, không pill
        Checkpoint · Restore
[3] AI text
[4] Footer: Copy · Fork Chat                         ← không hiện thời gian tin nhắn
```

## Câu trả lời AI (Markdown-first)

- **Nguồn sự thật:** mọi `ChatLine` loại `token` trong lượt → `Turn.ai.text` (chuỗi gốc từ model).
- **Quy ước format:** system prompt runtime (`crates/runtime/src/agent.rs` → `SYSTEM`) bảo model viết câu trả lời user bằng Markdown.
- **Hiển thị năm 1:** plain text + `pre-wrap` — chưa có Markdown renderer (xem roadmap).
- **Copy Message:** `clipboard.writeText(ai.text)` — nguyên nguồn; không gồm Thought, Explored, tool details, checkpoint, route, timestamp.
- **Copy UX (Cursor-like):** hover tooltip “Copy Message”; sau khi copy, icon → check ~2s; toast góc dưới trái “Message copied to clipboard”.
- **Tách kênh:** tool / thinking / plan / diff / permission là event protocol riêng, không lẫn vào Copy.
- Roadmap tiếp: `docs/frontend/chat-markdown-roadmap.md`.

## Gợi ý đổi mode (Ask / Review → Agent)

- Ở Ask/Review, khi người dùng muốn thay đổi, model đưa đề xuất bằng khối ```diff có `path:line` rồi gọi tool `suggest_mode` (không ghi gì). Engine phát event `mode_suggestion { mode, reason }`; Engine **không** tự đổi mode.
- UI hiện thẻ dưới câu trả lời của lượt cuối: **Chuyển sang Agent và thực hiện** (đổi mode, gửi lại đúng prompt cũ; vẫn xin quyền + diff) và **Giữ Ask** (ẩn thẻ). Thẻ ẩn khi đang busy hoặc mode đã đổi.
- Trước khi gửi: đang ở Ask/Review mà câu có động từ sửa (`looksLikeEditRequest`, `renderer/modes.ts`) → dòng nhỏ trên ô nhập "Đang ở Ask (chỉ đọc) … **Gửi bằng Agent**". Không chặn gửi.
- Dòng route trong meta của lượt có nhãn mode: `Ask · chat → model`.
- Ngôn ngữ trả lời theo tin nhắn user; code nhắc kèm `path:line` (`SYSTEM`).

## Fork Chat

- Nút Fork cạnh Copy trên tin AI đã xong (`!live`); disable khi `busy`.
- Tạo thread mới: `lines` cắt từ đầu → hết turn đó; `session.create` mới; title `Fork · …`; `forkedFromId` = thread gốc.
- Thread gốc không đổi; không revert file workspace (khác Checkpoint Restore).
- Năm 1: history fork chỉ ở UI/localStorage; runtime session mới chưa replay message (prompt tiếp theo chạy trên session trống về phía model — hạn chế đã biết).

**Sửa đã chốt:** `Worked for` luôn có `ms` khi `done` (không `—`); không trùng dòng Thought; Explored không hiện rỗng; route không hộp xám.

## Thought (hiển thị suy nghĩ)

- Event runtime `thinking` (protocol 0.1.1) — stream `reasoning_content` / `reasoning` / `thinking` từ gateway.
- Live: nhãn **Thinking** + shimmer; body cập nhật dần (full text).
- Xong: **Thought Ns** nếu có `ms`, không thì **Thought briefly**; body giữ nguyên, thu/mở được.
- Brief một dòng = dòng đầu của body (không thay full thinking).
- Không invent Thought nếu lượt không có body/`ms` đáng kể và không có hoạt động.

## Bộ bước (live → past)

| Live | Past | Ghi chú |
| --- | --- | --- |
| Planning next moves | *(không lưu)* | Placeholder; bị thay |
| Thinking | Thought briefly / Thought Ns | Bản ghi + full body |
| Reading | Read | |
| Searching | Searched | |
| Editing | Edited | |
| Running | Ran | |
| Testing | Tested | Heuristic lệnh test |
| Exploring | Explored | `task` / codebase rộng |
| Writing plan | Wrote plan | `submit_plan` |
| Using tool | Used tool | MCP / tool khác |

## Thread

Gửi → Planning + bắt đầu đo thought. `thinking` → Thinking + body. `tool_start`/`token` → seal `ms`. `done`/`error` → drop Planning/Thinking live, past bước, Thought record, checkpoint, worked.

## Lỗi trong lượt

- Engine chuẩn hóa lỗi provider → `error` event có `error: { code, status?, retryable, detail }` (`PROVIDER_CREDITS`, `PROVIDER_AUTH`, `PROVIDER_RATE`, `PROVIDER_UNAVAILABLE`, `NETWORK`, `TIMEOUT`, `UNKNOWN`). Thiếu `error` → thông báo chung.
- Hiện **inline trong lượt** bằng `ErrorCard` (tiêu đề + mô tả + hướng xử lý tiếng Việt). Không toast/dialog; không dán JSON/HTTP làm nội dung chính.
- "Chi tiết kỹ thuật" thu gọn (mã · HTTP · `detail` đã lọc secret ở Engine). Output log ghi cùng dòng.
- Nút "Thử lại" chỉ khi `retryable` (rate/5xx/mạng/timeout) và chỉ ở lượt cuối. Credit/key sai: không retry, không auto-retry.
- Sau lỗi: `busy` tắt; prompt vừa gửi được trả lại composer nếu đang trống. Copy: `renderer/errorCopy.ts`.
