---
description: Backlog Markdown trong chat — việc đã làm và việc cố ý chưa làm (renderer, agent/protocol, chất lượng).
type: roadmap
code:
  - apps/studio/src/renderer/components/MarkdownMessage.tsx
  - crates/runtime/src/agent/modes.rs
---
# Roadmap — Markdown chat (sau năm 1 tối thiểu)

Đã làm: quy tắc user-facing GitHub-flavored Markdown trong `SYSTEM` (`crates/runtime/src/agent/modes.rs`); Copy = nguồn `ai.text`; docs hợp đồng trong `chat.md`; renderer `MarkdownMessage` (react-markdown + remark-gfm) với chặn HTML thô / `javascript:` / ảnh từ xa, link ngoài qua `openExternal`, main chặn điều hướng.

Cố ý **chưa** làm — mở lại khi cần.

## UI / renderer

- [x] Render Markdown an toàn trên `Turn.ai.text` (streaming; fence chưa đóng).
- [x] Không bật HTML thô; chặn XSS / `javascript:` links; chặn ảnh từ xa.
- [x] Khối ` ```svg ` vẽ thành hình minh hoạ trong chat (`VisualBlock`; `SYSTEM` mục Visuals; eval X24 sơ đồ, X25 tranh). Ô chờ "Đang vẽ…" đúng tỉ lệ khi stream; `<title>` làm tiêu đề card + alt; cao ≤ 400px, tranh tràn mép; nút **Chỉnh**; lightbox Lưu PNG 2x / SVG.
- [ ] Hình minh hoạ P2: gợi ý chỉnh thành chip bấm được; phiên bản v1/v2 của cùng hình; Lưu vào workspace (qua diff duyệt).
- [x] Ảnh trong chat: hover Tải / Copy / Chỉnh sửa (`ImageFrame`); trình chỉnh sửa toàn màn hình (`ImageEditor`): phác hoạ, chữ, khung, mũi tên, ghim bình luận có toạ độ `viewBox` → Gửi cho agent (đính PNG + prompt).
- [ ] Gỡ nền / Xóa vật thể trong trình chỉnh sửa: cần model sửa ảnh (đang "chưa gắn").
- [ ] Zoom bằng con lăn trong lightbox.
- [ ] Mermaid (` ```mermaid `) cho sơ đồ phức tạp: cần thư viện, render `securityLevel: strict`.
- [x] Ảnh trong workspace (`![](path)`, dải ảnh được nhắc tới) hiện qua Engine `fs.read_image`; agent xem ảnh bằng `view_image` (`SYSTEM` mục Images).
- [x] Renderer hỗ trợ GFM: prompt đã đổi sang “GitHub-flavored Markdown”.
- [ ] Chip `path:line` cuộn tới dòng (hiện chỉ mở file).
- [x] Syntax highlight trong code fence (`syntax.ts`, tokenizer Monaco, màu `--syn-*`).
- [x] Copy từng code block riêng (`CopyButton` trong `CodeView.tsx`).
- [x] Khối ```diff render như diff (vạch màu, số dòng, tô phần chữ đổi).

## Agent / protocol (không redesign sớm)

- [x] Abort từ UI: nút Stop thay nút gửi khi `busy` (`Composer.onStop` → `session.abort`). Engine chỉ kiểm cờ ở đầu mỗi vòng tool, nên Stop có hiệu lực sau khi lượt model/tool hiện tại xong.
- [ ] Abort ngắt ngay giữa stream / giữa các tool call (cần sửa `gateway::chat` + vòng tool; kèm eval).
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
