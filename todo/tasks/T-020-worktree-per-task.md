---
id: T-020
title: Chống hai phiên dùng chung worktree — mỗi việc một worktree, ghi chủ theo worktree, chặn commit sai chủ
type: feature
status: todo
phase:
area: [agent-kit, ci]
size: M
depends: []
branch:
pr:
created: 2026-11-25
updated: 2026-11-25
---

## Mục tiêu

Hai phiên không bao giờ dùng chung một worktree. Mỗi việc có worktree riêng tạo từ `origin/main`, gắn với nhánh của việc; xong việc thì gỡ. Commit của phiên này không thể rơi vào nhánh của phiên khác — được **máy chặn**, không chỉ dựa vào lời dặn agent.

## Phạm vi

**Làm:**
- Quy tắc: mỗi việc một worktree mới (tên theo việc, vd `5ilence-T-xxx`) từ `origin/main`; cấm `git switch`/`checkout` trong worktree không phải của mình; gỡ worktree sau merge. Sửa skill `task-git` (mục Worktree) và `todo` (Bắt đầu việc bước 3, Đóng việc, Chuyển giao).
- **Ghi chủ theo worktree**, không chỉ theo việc `T-xxx`: mọi phiên làm trong worktree đều được ghi, kể cả việc không nằm trong `todo/` (chore/docs lẻ).
- **Ghi đúng worktree thật**: lấy thư mục mà lệnh git thực sự chạy, không lấy `cwd` của phiên (luôn là thư mục chính).
- **Trạng thái phiên** 🟢 đang chạy / 🟡 chờ user / ⚪ im lâu: cập nhật tự động bằng hook khi agent làm một bước (PreToolUse/PostToolUse) và khi trả lời xong (Stop), ngoài UserPromptSubmit đã có. 🟢 quá ~15 phút không cập nhật thì coi như ⚪ (phiên bị tắt ngang không có tín hiệu dừng).
- **Chặn thật**: hook PreToolUse của Claude Code từ chối `git commit`/`push`/`switch`/`checkout` khi worktree đó đang do phiên khác giữ.
- Chuyển giao: không cho takeover khi phiên cũ 🟢; 🟡/⚪ thì hỏi user như hiện tại.
- SessionStart (`todo-brief.mjs`) liệt kê worktree bị bỏ lâu / PR chưa merge, hỏi user làm tiếp hay dọn.
- Siết quy tắc Nhật ký: trước khi dừng phải ghi Quyết định và lý do (phần máy không tự biết; trạng thái git đã có ở `handoff`).

**Không làm:** đổi quy trình PR/merge (`scripts/pr-merge.mjs`); thư mục chính của user (vẫn không đụng); hook git `.githooks/` (chặn ở hook Claude Code là đủ); lo xung đột giữa hai nhánh khác nhau sửa cùng file (git/PR đã báo, không mất bài).

## Tiêu chí dự kiến (chốt lại ở pha plan)

- Test tái hiện sự cố 2026-11-25: hai phiên giả cùng một worktree, phiên B `switch` nhánh rồi phiên A `commit` → bị chặn. Đỏ trước khi sửa, xanh sau.
- Phiên B định `commit`/`push` trong worktree do phiên A giữ → hook từ chối, in tên phiên A.
- Việc không có trong `todo/` vẫn được ghi chủ worktree.
- Sổ ghi đúng worktree (`5ilence-wtN`), không phải thư mục chính.
- Phiên 🟢 im quá ~15 phút → hiện ⚪; takeover phiên 🟢 bị từ chối.
- Mở phiên mới → SessionStart liệt kê worktree bị bỏ lâu.
- `node --test` cho `scripts/todo-claims.mjs` xanh; `npm run check:rules` / `check:docs` xanh nếu đụng.

## Bối cảnh

Sự cố 2026-11-25: phiên làm PR #69 và phiên làm ADR 0005 (PR #70) cùng dùng `5ilence-wt2`. Worktree "sạch" lúc kiểm nhưng phiên kia đang viết dở; commit `1c0790e` của ADR rơi vào nhánh `chore/settings-merge-gate`. Gỡ được vì commit chưa lên remote. Quy tắc hiện tại ("`git status` sạch thì dùng được", skill `task-git`) không đủ.

Phát hiện khi đọc code (2026-11-25):
- Sổ `todo-claims.json` lúc sự cố có `claims: {}` — hai việc đó không nằm trong `todo/` nên sổ không biết gì.
- `claim` lấy `worktree` từ `cwd` của hook (`scripts/todo-claims.mjs` → `main`, nhánh `claim`), mà `cwd` các phiên đều là `D:\vuhieu\5ilence`.
- `heartbeat` chỉ chạy ở UserPromptSubmit; `STALE_HOURS = 48` — không phân biệt được phiên đang chạy với phiên đã tắt.
- Đã có sẵn và giữ lại: `handoff` (trạng thái git + đuôi transcript), `--takeover` kèm báo phiên cũ (`moved`), `doctor`.
- `git worktree lock` chỉ chặn xoá worktree, **không** chặn `switch` — không dùng làm khoá chính.

Liên quan: skill `task-git` (`.claude/skills/task-git/SKILL.md`), skill `todo` (Bắt đầu việc, Chuyển giao), sổ giữ việc `scripts/todo-claims.mjs`, `scripts/todo-brief.mjs`, hook trong `.claude/settings.json` (cần user duyệt).

## Câu hỏi mở

- [ ] Ngưỡng 🟢 → ⚪: 15 phút có hợp không (agent có lúc chạy lệnh dài)?
- [ ] Chỗ đặt worktree: cạnh repo (`D:\vuhieu\5ilence-T-xxx`) hay trong một thư mục chung?
