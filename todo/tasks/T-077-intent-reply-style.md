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

Khung: `➡️ **Tiếp (nơi làm, model):** việc bạn cần làm → mã việc: việc đó là gì bằng lời thường, vì sao làm.` Lối rẽ khác chỉ thêm khi thật sự có. Ghép từ mẫu ở `cards.md` → 5 (nơi làm trong nhãn in đậm, mở bằng hành động) và yêu cầu đọc là hiểu (2026-11-28).

Việc kế bình thường:

> 🏁 Đã xong T-031: lõi nhận fs.* và terminal> ➡️ **Tiếp (chat mới, Opus):** gõ `/todo` → T-032: chuyển lịch sử chat, quay lui, rẽ nhánh sang lõi mới, để bỏ được Engine Rust.

Việc kế có điều cần biết, có lối rẽ:

> 🏁 Đã xong T-038: chốt cách Claude trong app chạy giống terminal> ➡️ **Tiếp (chat mới, Opus):** gõ `/todo` → T-006: liệt kê những gì app còn gọi qua Engine Rust cũ, để biết phần nào chuyển sang lõi mới. T-074 vừa hết bị chặn; muốn làm trước thì nói "làm T-074".

Nên làm tiếp ngay ở chat này:

> 🏁 Đã xong: tìm ra vì sao thẻ xin quyền không hiện> ➡️ **Tiếp (chat này):** nói "sửa đi" → sửa lỗi vừa tìm ra, khi còn nhớ rõ nguyên nhân.

Hết việc trong Next:

> 🏁 Đã xong T-035: xoá code Rust cũ> ➡️ **Tiếp (chat mới):** gõ `/todo` → Next đã trống; chọn việc từ Later để làm tiếp.
