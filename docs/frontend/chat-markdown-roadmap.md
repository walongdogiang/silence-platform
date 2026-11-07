# Roadmap — Markdown chat (sau năm 1 tối thiểu)

Đã làm: quy tắc user-facing Markdown trong `SYSTEM` (`crates/runtime/src/agent.rs`); Copy = nguồn `ai.text`; docs hợp đồng trong `chat.md`.

Cố ý **chưa** làm — mở lại khi cần.

## UI / renderer

- [ ] Render Markdown an toàn trên `Turn.ai.text` (streaming; fence chưa đóng).
- [ ] Không bật HTML thô; chặn XSS / `javascript:` links.
- [ ] Khi renderer hỗ trợ bảng (và GFM khác): đổi prompt “Markdown” → “GitHub-flavored Markdown”.
- [ ] Syntax highlight trong code fence (tùy chọn).
- [ ] Copy từng code block riêng (tùy chọn).

## Agent / protocol (không redesign sớm)

- [ ] Abort từ UI (`session.abort` runtime đã có).
- [ ] Regenerate tin nhắn.
- [ ] Tách “câu trả lời cuối” khỏi prose giữa các vòng tool (chỉ nếu UX đòi).
- [ ] Enum `format` / content-block framework — **chỉ** khi có mode sản phẩm thật sự cần, không làm phòng xa.

## Chất lượng

- [ ] Unit: `groupTurns` nối nhiều `token` xen tool/narrate.
- [ ] Unit/component: Copy không kèm meta; renderer edge cases.
- [ ] Quan sát model thật: bọc cả reply một fence, lạm dụng heading, JSON sai chỗ → bổ sung 1–2 dòng `SYSTEM` nếu cần.

## Không làm trong roadmap này

- Scrape DOM làm nguồn Copy.
- Nhét full quy tắc formatting vào `AGENTS.md` root hoặc `templates/silence/AGENTS.md` (sai kênh).
