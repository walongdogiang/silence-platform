---
id: T-077
title: Ghi ý user cho mọi việc, gộp luật viết câu trả lời, luôn hiện dòng ➡️ Tiếp
type: chore
status: todo
phase:
area: [agent-kit]
size: M
model: opus
model-build: sonnet
depends: [T-033]
branch:
pr:
created: 2026-11-28
updated: 2026-11-28
---

## Ý bạn

- 👤 **Muốn:** đọc lại task là nhớ vì sao mình đề xuất — tóm đủ ý đã trao đổi, không cần từng chữ
- 👤 **Yêu cầu:** ghi dạng hội thoại 👤/🤖, đầu mỗi lượt có hành động (hỏi, yêu cầu, chọn…), ngoặc kép cho lời mình
- 👤 **Yêu cầu:** câu trả lời của agent có cấu trúc, chia phần, thân thiện, không hàn lâm, không dài dòng, ít icon, ít chi tiết kỹ thuật — để mình chịu đọc và không sót ý quan trọng
- 🤖 **Đề xuất:** làm ngay phần không bị khoá (mẫu task, memory); phần sửa kit để sau đóng băng; ngoặc kép chỉ cho câu nguyên văn
- 👤 **Chọn:** dòng ➡️ **Tiếp:** luôn hiện sau 🏁, kể cả khi bước tiếp chỉ là việc kế trong danh sách
- Nguồn: chat «Ngữ cảnh task trong todo» (`local_8bcbb06a`) · 2026-11-28

## Mục tiêu

Phần sửa kit còn lại sau PR #109, #110 (kit đóng băng tới khi T-033 xong). Xong thì: mọi việc mới đều có ý user, câu trả lời agent theo một bộ luật viết chung, và cuối mỗi việc xong luôn biết bước kế.

## Phạm vi

**Làm:**
- Skill `todo` → **Thêm việc**: bắt điền mục "Ý bạn" (mẫu đã có); việc chỉ một dòng thêm đuôi `· ý: …`.
- Đưa **Nguyên tắc viết** của `.claude/skills/todo/cards.md` thành luật chung cho mọi câu trả lời; gom luật viết đang rải ở `CLAUDE.md` / `cards.md` / `phan-bien` về một chỗ; rút gọn đầu ra của `phan-bien`. Sau đó gỡ memory `reply-readability` (đã thành luật).
- `CLAUDE.md` → **Kết thúc lượt** và `cards.md` → 5: dòng `➡️ **Tiếp:**` luôn có sau `🏁`, không chỉ khi khác mặc định.

**Không làm:** điền lại "Ý bạn" cho việc cũ (tốn usage; chỉ làm khi user nhờ từng việc).

## Ví dụ mẫu dòng ➡️

Việc kế bình thường:

> 🏁 Đã xong T-031: lõi nhận fs.* và terminal
> ➡️ **Tiếp:** T-032 Lõi nhận lịch sử chat (chat mới, gõ `/todo`)

Việc kế có điều cần biết:

> 🏁 Đã xong T-038: chốt ADR 0004
> ➡️ **Tiếp:** T-074 vừa hết bị chặn, cần Opus (chat mới)

Nên làm tiếp ngay ở chat này:

> 🏁 Đã xong: tìm ra lỗi thẻ quyền không hiện
> ➡️ **Tiếp:** sửa lỗi vừa tìm ra (chat này)

Hết việc trong Next:

> 🏁 Đã xong T-035: xoá crates/
> ➡️ **Tiếp:** Next trống — gõ `/todo` để chọn việc từ Later (chat mới)
