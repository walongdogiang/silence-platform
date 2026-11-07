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
