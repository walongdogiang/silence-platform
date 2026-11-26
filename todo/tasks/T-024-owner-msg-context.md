---
id: T-024
title: Lời báo của hook chủ worktree ghi chat chủ đang làm việc gì, kèm tên chat dễ nhận ra
type: feature
status: todo
phase:
area: [agent-kit]
size: S
model: opus
model-build: sonnet
depends: [T-020]
branch:
pr:
created: 2026-11-25
updated: 2026-11-26
---

## Mục tiêu

Hiện tại khi hook chủ worktree (T-020) chặn (`deny`) hoặc hỏi (`ask`), lời báo chỉ có mã chat, ví dụ "chat 37a7cd15". Người dùng không dò được mã đó ra chat nào trong sidebar, cũng không biết chat ấy đang làm việc gì. Xong việc này, lời báo phải cho người đọc biết ngay: chat nào (bằng tên dễ nhận ra) và đang làm `T-xxx` nào (nếu có).

## Phạm vi sơ bộ

- **Việc đang làm:** lấy từ `book.claims`, tìm việc mà chat chủ đang giữ ở đúng worktree đó, rồi ghép vào lý do trong `guardGit` (`scripts/todo-owner.mjs`) và vào lệnh `todo-claims.mjs list`. Không thêm field vào `worktrees`, vì dữ liệu đã có trong `claims`.
- **Tên chat dễ nhận ra:** cần kiểm trước trong transcript `~/.claude/projects/<repo>/*.jsonl` xem có dòng nào chứa tiêu đề chat hay không. Nếu không có thì dùng khoảng 40 ký tự đầu của tin nhắn đầu tiên của user. Tên chỉ đọc lúc tạo lời báo hoặc lúc ghi chủ, và vẫn phải giữ hook chạy dưới khoảng 0,3 giây.
- **Mã chat hiện là mã tin nhắn đầu, không phải mã phiên:** `37a7cd15-…` là `uuid` của dòng đầu tiên trong transcript `c404fa5b-….jsonl` (sổ ghi `chat` = uuid đó, `session` = `c404fa5b`). Cả hai đều khác mã chat trên sidebar của app (`local_…`), nên user không dò được. Ngày 2026-11-26 phải đoán theo giờ hoạt động mới ra là chat "Worktree hook test setup". Khi tìm tên, đọc theo `session` (tên file jsonl), đừng theo `chat`.
- **Lời báo tách hai phần: phần cho user đọc và phần dặn agent.** Hiện tại agent dán nguyên văn cho user một câu viết cho agent ("không tự lách", lệnh có chỗ trống `<T-xxx|tên> --branch <nhánh> --session <id>`). Phần cho user nói ý chính trước, rồi đưa lựa chọn, ví dụ:
  > **Chưa commit được:** thư mục `hook-test` đang được chat "[Worktree hook test setup](#local_…)" dùng (vừa hoạt động 1 phút trước). Hai chat cùng sửa một thư mục dễ ghi đè nhau, nên mình dừng lại.
  >
  > Bạn chọn:
  >
  > - **Làm riêng (khuyến nghị):** mình tạo thư mục làm việc mới cho chat này và commit ở đó. Không ảnh hưởng chat kia.
  > - **Chờ:** khi chat kia xong việc, bạn quay lại đây gõ "tiếp".
  > - **Chat kia đã xong:** nếu bạn chắc chat kia không còn dùng thư mục này, báo mình. Mình sẽ chuyển thư mục sang chat này rồi commit.
  >
  > Bạn chọn cách nào?

  Quy tắc cho mẫu:
  - Tên chat đặt trong ngoặc kép. Có mã `local_…` thì gắn link vào tên (bấm mở đúng chat); không có thì chỉ ghi tên. Cần kiểm hook có tìm được `local_…` từ mã phiên trong sổ không (sổ ghi `c404fa5b`, sidebar là `local_51c28a4a`).
  - Chat kia đang giữ việc trong `todo/` thì thêm mã việc vào ngoặc đơn, ví dụ `(T-024, vừa hoạt động 1 phút trước)`. Không giữ việc nào thì bỏ.
  - Lựa chọn là gạch đầu dòng, mỗi dòng một lựa chọn, tên in đậm ở đầu dòng, lựa chọn khuyến nghị đứng đầu và ghi "(khuyến nghị)". Không gộp vào một câu bằng `·`.
  - Kết bằng một câu hỏi riêng dòng để app vẽ nút bấm.
  - Tránh thuật ngữ nội bộ ("nhận lại thư mục", "worktree", "takeover") trong phần cho user.

  Phần dặn agent giữ nguyên: lệnh tạo worktree riêng, không tự lách. Cân nhắc thêm vào skill `todo`/`task-git` (hoặc `.claude/skills/todo/cards.md`) một quy tắc: khi gặp lời chặn này, agent trình bày theo mẫu trên, không dán nguyên văn.
- Sổ vẫn là dữ liệu cho máy đọc. Chỉ những lời báo tạo ra từ sổ mới cần dễ đọc.
- Không làm trong việc này: đổi luật chặn/hỏi, hay ngưỡng 2 giờ.

Bối cảnh: phát hiện khi user tự chạy thử T-020 ngày 2026-11-25 (PR #79, #80).
