---
id: T-071
title: Phát hiện lẫn việc trong một chat và đề xuất tách chat
type: feature
status: todo
phase:
area: [agent-kit]
size: M
model: opus
model-build: sonnet
depends: []
branch:
pr:
created: 2026-11-27
updated: 2026-11-27
---

## Mục tiêu

Một chat dễ trôi sang việc thứ hai: context phình, commit lẫn file, việc mới kế thừa giả định của việc cũ. Agent cần nhận ra lúc chat lẫn việc và đưa lựa chọn cho user (chat mới / làm ở đây / thêm vào `todo/`). Agent chỉ hỏi, không tự chặn, không chọn thay user.

## Phạm vi

**Làm** (phương án c, user đã chọn ngày 2026-11-27: luật + hook, hai lớp bổ sung cho nhau):
- **Luật (phần ngữ nghĩa):** thêm vài dòng vào `CLAUDE.md`. Trước khi làm, agent xét tin nhắn có thuộc việc phiên này đang giữ không; nếu không thì đưa ba lựa chọn trên theo thẻ ở `.claude/skills/todo/cards.md`. Tiếp nối việc vừa làm (sửa lỗi vừa tìm ra, vòng lặp tiếp, "ok làm đi") thì không hỏi.
- **Hook "ngoài vùng" (tín hiệu cứng):** PostToolUse Edit/Write sửa file ngoài vùng của việc đang giữ (`claim --areas` đã ghi vùng vào sổ) thì chèn lời nhắc để agent hỏi user. Có thể thêm: transcript quá dài thì gợi ý mở chat mới.
- **Mỗi lần lệch chỉ hỏi một lần.** User chọn "làm ở đây" thì ghi vào sổ, không hỏi lại cho glob/file đó trong phiên.
- Không có việc nào đang giữ thì hook im lặng.

**Không làm:** hook gọi LLM để chấm từng tin nhắn (tốn thêm một lượt gọi model và 1–3 giây mỗi tin, trùng việc agent chính đã đọc); tự chặn công cụ.

## Đọc trước

- `scripts/todo-hook.mjs` → `handle()` nhánh `post` + EDITS; `scripts/todo-claims.mjs` → `claim --areas`, `heartbeat`.
- `.claude/settings.json` → `hooks.PostToolUse`.
- Cần kiểm tài liệu chính thức của Claude Code: PostToolUse có trả `hookSpecificOutput.additionalContext` cho agent không (nếu không thì dùng `decision: "block"` + `reason`, hoặc đẩy lời nhắc sang UserPromptSubmit).

## Bối cảnh

- Gần với T-023 (nhật ký sửa file, hỏi khi sửa trùng file *giữa các chat*); việc này là lệch phạm vi *trong một chat*. Ở pha design xem có dùng chung nhật ký sửa file không.
- App Claude desktop đã có thẻ "New session / Do it here" theo phán đoán của model; CLI thì không có. Luật trong `CLAUDE.md` phủ cả hai.
- Đụng `CLAUDE.md` và `.claude/settings*` → thuộc loại phải hỏi (AGENTS.md → Tự chủ); cổng duyệt của việc này phủ phần đó.
