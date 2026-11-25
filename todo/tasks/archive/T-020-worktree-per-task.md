---
id: T-020
title: Chống các chat đụng nhau (phần 1) — chủ worktree theo chat, chặn commit sai chủ, thư mục worktree chung
type: feature
status: done
phase: verify
area: [agent-kit]
size: M
model: opus
depends: [T-022]
branch: feat/T-020-worktree-ownership
pr: 79
created: 2026-11-25
updated: 2026-11-25
---

## Mục tiêu

Các agent chính ở các chat khác nhau không đụng việc của nhau. Mỗi chat để lại dấu **đang làm ở worktree nào, đang sửa file nào** — do máy ghi, không nhờ agent nhớ. Trước khi một chat sửa file mà chat khác đang sửa dở, agent dừng lại và user quyết. Commit không thể rơi vào worktree của chat khác. Không đổi cách Claude research/suy nghĩ (agent con, Explore, Plan, system prompt giữ nguyên).

## Phạm vi

**Làm (việc này = PR 1):** ý 4, 5, 6, 7, 11 ở **Thiết kế**; sửa skill `task-git` (Worktree) và `todo` (Bắt đầu việc, Chuyển giao, Đóng việc); hook mới trong `.claude/settings.json` (user đã đồng ý hướng b ngày 2026-11-25; nội dung cụ thể duyệt ở cổng).
**Tách sang việc sau (PR 2, đề xuất ở cổng):** ý 1, 2, 3, 8, 10 — nhật ký sửa file, hỏi khi sửa trùng file, bù sửa bằng shell, loại trừ file chung, `--areas` tuỳ chọn.
**Không làm:** đổi quy trình PR/merge (`scripts/pr-merge.mjs`); thư mục chính của user; hook git `.githooks/`; phát hiện xung đột **ý nghĩa** giữa hai file khác nhau (đã có báo "hợp đồng chung đổi" sau merge của T-022); lệnh git user tự gõ ngoài Claude; phiên cloud/máy khác; master chia việc.

## Đọc trước

- [ADR 0006](../../../docs/adr/0006-session-coordination.md) — sổ sự kiện, Giới hạn đã biết (phần việc này lấp).
- `scripts/todo-claims.mjs` → `claim`, `touchSession`, `heartbeat`, `whoAmI`, `pullEvents`, `syncMain`; `scripts/todo-events.mjs` → `relevantFor`, `matchArea`.
- `scripts/todo-brief.mjs` (SessionStart); hook hiện có trong `.claude/settings.json` (SessionStart, UserPromptSubmit).
- Docs hook Claude Code (https://code.claude.com/docs/en/hooks, đọc 2026-11-25): input chung `session_id`, `transcript_path`, `cwd`, `hook_event_name`; PreToolUse thêm `tool_name`, `tool_input`, `tool_use_id`. Edit/Write: `tool_input.file_path` luôn tuyệt đối (Windows: `\`). Bash/PowerShell: `tool_input.command`. Output PreToolUse: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny|ask","permissionDecisionReason":"…"}}` — `deny`: lý do cho Claude; `ask`: lý do hiện trong hộp hỏi user. Hook lỗi/exit ≠ 0,2 → công cụ vẫn chạy. Stop, UserPromptSubmit không có matcher. Notification `notification_type` có `permission_prompt`, `idle_prompt`. SessionStart source: `startup|resume|clear|compact|fork`. **Chưa thấy trong docs:** field của MultiEdit/NotebookEdit (`notebook_path`?) → đọc cả hai tên; mã phiên khi mở lại → đã kiểm thực tế (Bối cảnh).

## Bối cảnh

Vấn đề user gặp: mở nhiều chat cùng lúc, agent mỗi chat không biết chat khác đang làm gì.
- 2026-11-25: phiên làm PR #69 và phiên làm ADR 0005 (PR #70) cùng dùng `5ilence-wt2`; commit `1c0790e` rơi vào nhánh `chore/settings-merge-gate`. Sổ lúc đó `claims: {}` vì hai việc không nằm trong `todo/`.
- 2026-11-25: hai chat cùng định lấy mã T-021 → đã giải bằng `reserve-id` (T-022).
- 2026-11-25: sổ ghi T-022 ở `D:\vuhieu\5ilence`, nhánh `main` — `claim` lấy `cwd` của phiên (luôn là thư mục chính), không phải worktree thật.
- 2026-11-25: chat T-022 được mở lại với **mã phiên mới**; sổ vẫn ghi việc thuộc phiên cũ. Nhận diện chat bằng mã phiên sẽ làm chat tự cảnh báo/chặn chính mình.
- `heartbeat` chỉ chạy ở UserPromptSubmit; `git worktree lock` chỉ chặn xoá, không chặn `switch`.
- Kiểm thực tế 2026-11-25 (transcript `~/.claude/projects/D--vuhieu-5ilence/*.jsonl`): mỗi lần chat mở lại, app tạo file mới, mã phiên mới, chép lại lịch sử **giữ nguyên `uuid` tin nhắn** — ba phiên `ff0acff7`, `891520fa`, `9cb42e1f` của cùng một chat có chung tin đầu `63ea527c…` (401/404 uuid trùng); chat khác không chung. → **mã chat = `uuid` của dòng đầu có `uuid` trong transcript**. Định dạng nội bộ, docs không cam kết: đọc không được → coi là chat khác và hỏi user, không đoán. Fork cũng chung tin đầu → SessionStart `source: fork` thì mã chat = mã phiên.

## Thiết kế

**Đã chốt (user, 2026-11-25):** hướng b — máy tự ghi hoạt động mỗi chat + hỏi trước khi sửa trùng, gộp vào T-020; sửa trùng file thì **hỏi** (không chặn); thời hạn im **2 giờ**, quá hạn thì **hỏi user** (user tự xem rồi duyệt làm tiếp), không tự bỏ qua; T-022 merge trước (PR #78, đã merge).

1. **Nhật ký sửa file tự động** — hook PostToolUse (Edit, Write, MultiEdit, NotebookEdit) ghi `{chat, worktree, file, giờ}` vào sổ chung. Mọi chat, có `T-xxx` hay không. Chưa được: file sửa bằng shell → ý 3.
2. **Hỏi trước khi sửa trùng** — hook PreToolUse cùng các công cụ: file đang được chat khác sửa dở (chat đó hoạt động trong 2 giờ, thay đổi chưa vào `origin/main`) → `ask` kèm "chat nào, file nào, lúc nào". Chỉ trùng **file**, không trùng ý.
3. **Bù sửa bằng shell** — mỗi lượt (UserPromptSubmit/Stop) đọc `git status --porcelain` của worktree chat đang làm, gộp vào sổ. Trễ tối đa một lượt.
4. **Đúng worktree thật** — lấy từ `git rev-parse --show-toplevel` tại thư mục của file vừa sửa / lệnh git, không lấy `cwd` phiên.
5. **Chặn commit/push/switch/checkout sai chủ** — hook PreToolUse(Bash): lệnh git đổi trạng thái trong worktree mà chủ là chat khác còn hoạt động → `deny`, in chat chủ. Chỗ duy nhất chặn hẳn.
6. **Trạng thái chat** 🟢 đang chạy / 🟡 chờ user / ⚪ im (> 2 giờ) — cập nhật ở PreToolUse/PostToolUse, Stop, UserPromptSubmit. Chủ đã ⚪ thì không chặn, không bỏ qua: **hỏi user** ("chat X im từ …, xem rồi cho làm tiếp?"). Takeover khi chủ 🟢 bị từ chối.
7. **Chủ là worktree, không phải mã phiên** — chat mới làm trong worktree mà chủ cũ đã im → hỏi user một lần "chat cũ mở lại?" rồi chuyển chủ (`moved` như `--takeover`); không hỏi lại mỗi lần sửa.
8. **Loại trừ file chung** — `todo/README.md`, `todo/DONE.md` (danh sách trong script) không cảnh báo.
9. **Hook trong `.claude/settings.json`** — lỗi/timeout thì cho agent làm tiếp (không làm hỏng phiên); mục tiêu ≤ ~0,2 giây mỗi lần.
10. **`--areas` thành tuỳ chọn** (báo trước vùng sắp sửa); vùng thật lấy từ ý 1 + 3. Giữ báo merge, lời nhắn, `reserve-id` của T-022.
11. **Mọi worktree ở một chỗ: `D:\vuhieu\5ilence-worktrees\<T-xxx>`** (việc không có mã: tên nhánh rút gọn). Script tạo worktree đúng chỗ thay vì agent tự đặt; skill `task-git` ghi thư mục chuẩn; SessionStart liệt kê thư mục trong `5ilence-worktrees` không còn trong `git worktree list` hoặc không chat nào giữ → hỏi user có dọn không (không tự xoá). Cho phép thư mục cha một lần trong `.claude/settings` để agent không bị hỏi quyền lặt vặt (duyệt ở cổng). Không đặt trong repo: công cụ (tìm kiếm, `tsc`, vitest, `studio:watch`) sẽ quét cả bản sao. Worktree app Claude tự tạo trong `.claude/worktrees/` để app quản.

Ràng buộc: không chặn việc **đọc**; chỉ thêm chữ vào ngữ cảnh khi thật có nguy cơ; không đổi system prompt/cấu hình nội bộ Claude Code.

Chia: việc này = ý 4, 5, 6, 7, 11 (chủ worktree theo chat, chặn commit sai chủ — sự cố 25/11). Ý 1, 2, 3, 8, 10 thành việc mới, `depends: [T-020]` (đề xuất ở cổng).

Mô hình dữ liệu (sổ `todo-claims.json`):
- `sessions[id].chat` — mã chat (uuid tin đầu của transcript; `fork` → mã phiên).
- `worktrees[<toplevel>] = { chat, session, branch, task?, lastSeen, state: running|waiting }` — chủ của worktree; `idle` suy ra khi `lastSeen` quá 2 giờ. Thư mục chính không bao giờ có chủ (của user).
- Lệnh git **đổi trạng thái**: `commit`, `push`, `switch`, `checkout`, `reset`, `rebase`, `merge`, `cherry-pick`, `stash`, `pull`, `worktree remove|move`. Đọc (`status`, `log`, `diff`, `fetch`, `show`) không bao giờ bị chặn.
- Xác định worktree của lệnh: `git -C <dir>` → `cd <dir>` / `Set-Location <dir>` gần nhất trước `git` (đổi `/d/…` → `D:\…`) → `cwd` của hook. Không đọc ra → coi như không biết, cho chạy (không chặn nhầm).

Quyết định cho một lệnh git đổi trạng thái trong worktree W:
| Chủ của W | Hook trả | Sau khi chạy (PostToolUse) |
|---|---|---|
| Chưa có / cùng chat | cho chạy, im lặng | ghi chat này làm chủ |
| Chat khác, hoạt động < 2 giờ | `deny` + "W đang thuộc chat X (hoạt động N phút trước). Tạo worktree riêng: …" | — |
| Chat khác, im ≥ 2 giờ | `ask` + "W thuộc chat X, im từ …. Cho phép = chuyển W sang chat này" | chuyển chủ, ghi `moved` để chat cũ được báo, sự kiện `handoff` |
| Không đọc được mã chat của phiên này | `ask` + giải thích | ghi chủ |

## Câu hỏi mở

- [x] Ngưỡng im: 2 giờ, quá hạn hỏi user (chốt 2026-11-25).
- [x] Chỗ đặt worktree: thư mục chung `D:\vuhieu\5ilence-worktrees\` (user chọn 2026-11-25; ý 11).
- [ ] Dọn thư mục cũ — hỏi ở cổng duyệt, user quyết từng cái, không tự xoá: `5ilence-wt` (không còn là worktree, git không nhận), `5ilence-wt2` / `5ilence-wt3` (worktree tách nhánh, không thay đổi dở, không chat giữ), `5ilence-wip` (chưa rõ).

## Kế hoạch

1. [x] **Test tái hiện sự cố 25/11 (đỏ trước)** — `scripts/todo.test.mjs`: hai chat giả cùng worktree W; chat B `switch` rồi chat A `commit` → mong `deny`. Gọi hàm thuần `guardGit(book, { session, command, cwd }, now)` chưa có → đỏ. Kiểm: `npm run test:todo` thấy đỏ.
2. [x] **Mã chat** — `scripts/todo-owner.mjs` (mới, để `todo-claims.mjs` không phình): `chatIdFromTranscript(text)` (dòng đầu có `"uuid"`), `chatOf(book, session)`; `touchSession` lưu `chat` (đọc tối đa ~64 KB đầu file); SessionStart `source: fork` → `chat = session`. Kiểm: test 3 phiên chung tin đầu = một chat, fork = chat khác, transcript hỏng = không biết.
3. [x] **Sổ chủ worktree + quyết định** — `todo-owner.mjs`: `parseGitCommand(command, cwd)` (thao tác, thư mục; bash + PowerShell), `toplevelOf(dir)` (`git rev-parse --show-toplevel`, bỏ thư mục chính), `guardGit` theo bảng ở Thiết kế, `afterGit` (ghi/chuyển chủ, `moved`, sự kiện `handoff` qua `recordEvent`). Kiểm: test bảng 4 dòng + parse (`git -C`, `cd /d/…`, `Set-Location`, lệnh đọc không bị chặn); bước 1 chuyển xanh.
4. [x] **Ghi chủ khi sửa file và theo trạng thái** — `register(book, {session, path})` cho PostToolUse Edit/Write/MultiEdit/NotebookEdit (`file_path` hoặc `notebook_path` → toplevel); `state` running ở Pre/PostToolUse, waiting ở Stop + Notification; `claim` ghi `worktrees` theo toplevel thật thay cho `cwd`. Takeover CLI: chủ là chat khác hoạt động < 2 giờ → từ chối; im ≥ 2 giờ → in câu hỏi cho user (như hiện tại). Kiểm: test; chạy tay `claim` trong worktree ghi đúng `5ilence-worktrees\T-xxx`.
5. [x] **Cổng hook** — `scripts/todo-hook.mjs pre|post|stop|notify`: đọc stdin, gọi `todo-owner.mjs`, in JSON `hookSpecificOutput` khi `deny`/`ask`; mọi lỗi → exit 0 im lặng (không làm hỏng phiên). Kiểm: test pipe JSON mẫu vào; đo `Measure-Command` ≤ ~0,3 s/lần trên máy user.
6. [x] **Thư mục worktree chung** — lệnh `node scripts/todo-claims.mjs worktree <T-xxx|tên> --session <id>`: `git fetch`, tạo `<cha của repo chính>\5ilence-worktrees\<tên>` từ `origin/main` với nhánh truyền vào (`--branch`), ghi chủ. SessionStart (`todo-brief.mjs`): thư mục trong `5ilence-worktrees` không có trong `git worktree list`, hoặc worktree có chủ im ≥ 2 giờ không giữ việc → 1 dòng hỏi user có dọn không. Kiểm: test với danh sách giả; chạy tay tạo worktree.
7. [x] **Hook + quyền trong cấu hình (cần user duyệt — xem cổng)** — `.claude/settings.json`: PreToolUse matcher `Bash|PowerShell` → `pre`; PostToolUse `Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit` → `post`; Stop → `stop`; Notification `permission_prompt|idle_prompt` → `notify`; timeout 10. `permissions.additionalDirectories` cho thư mục worktree chung: kiểm docs có nhận đường dẫn tương đối không; không thì đặt ở `.claude/settings.local.json` (không commit) với đường dẫn tuyệt đối. Kiểm: `npm run check:rules`; mở chat mới thấy hook chạy (`claude --debug` hoặc dòng `[todo]`).
8. [x] **Docs + skill** — `task-git` (Worktree: dùng lệnh `worktree`, thư mục chung, bị `deny` thì tạo worktree riêng, không lách), `todo` (Bắt đầu việc bước 3, Chuyển giao: chủ theo chat), ADR 0006 → Giới hạn đã biết cập nhật, `docs/README.md` nếu cần. Kiểm: `npm run check:docs`, `npm run check:rules`.

## Tiêu chí xong

- [x] Test tái hiện sự cố 25/11: chat B đổi nhánh rồi chat A commit trong cùng worktree → `deny`; đỏ trước, xanh sau — kiểm: `npm run test:todo` → đỏ trước (chưa có `todo-owner.mjs`), xanh sau; 29 pass
- [x] Cùng chat mở lại (mã phiên mới, chung tin đầu) không bị chặn, chủ tự chuyển; fork bị coi là chat khác — kiểm: `npm run test:todo` → test `mã chat`, `claim: cùng chat mở lại`, `guardGit` pass
- [x] Chủ im ≥ 2 giờ → `ask` kèm lý do; cho phép xong thì chủ chuyển và chat cũ được báo — kiểm: `npm run test:todo` → test `hook: pre… post…` (ask sau 4 giờ, chuyển chủ, `moved` báo chat cũ) pass
- [x] Chủ ghi đúng worktree thật (không phải thư mục chính), kể cả chat không có `T-xxx`; lệnh git chỉ đọc không bao giờ bị chặn — kiểm: `npm run test:todo` + chạy tay `claim`/`list` → test `parseGitCommand`, `setOwner`; chạy tay `claim` trong worktree tạm ghi `…-worktrees/T-001`, nhánh đúng
- [x] Lệnh `worktree` tạo đúng `5ilence-worktrees\<tên>`; SessionStart liệt kê thư mục thừa và hỏi — kiểm: `npm run test:todo` + chạy tay → chạy tay: tạo đúng chỗ, không upstream, tạo trùng bị từ chối; đầu phiên in `rac-cu (không còn là worktree)`
- [x] Hook lỗi không chặn công cụ; mỗi lần ≤ ~0,3 s — kiểm: test pipe JSON hỏng → exit 0, không in gì; `Measure-Command` → test pipe JSON hỏng: exit 0, không in gì; đo thật: pre ~195 ms, post git ~200 ms (Node rỗng ~125 ms)
- [x] Docs + rule + test xanh — kiểm: `npm run check:docs` · `npm run check:rules` · `npm run test:todo` → 26 docs OK · 6 rule OK · 29 test pass
- [x] (user) Sau khi cập nhật thư mục chính lên `main` mới: chat B thử commit trong worktree của chat A → bị chặn, có tên chat A — kiểm: user chạy tay 2026-11-25 (worktree `hook-test`): `git commit` của chat B bị `deny`, lý do có chat `37a7cd15`; `git status` không bị hook chặn; `worktree remove` xoá mục chủ trong sổ. Phát hiện chủ ghi qua Write có `branch: null` → sửa ở PR `fix/hook-owner-branch`

## Phát sinh

- Sổ chủ worktree mới chỉ biết chat sau khi hook chạy; các worktree cũ (`5ilence-wt2`, `5ilence-wt3`) chưa có chủ cho tới khi có chat làm trong đó.
- Docs không nói hook `ask` có còn hỏi ở chế độ Bypass permissions không — nên thử tay khi bật Bypass.
- `additionalDirectories` để trong `settings.local.json` thư mục chính (đường dẫn tuyệt đối, không commit) vì docs không nói rõ đường dẫn tương đối.

## Nhật ký

### 2026-11-25 · design · Opus
- Quyết định: mở rộng T-020 theo hướng b (user chọn sau review plan trong chat T-022); worktree `D:\vuhieu\5ilence-T-020`.
- Chuyển worktree sang `D:\vuhieu\5ilence-worktrees\T-020` (`git worktree move`, giữ nguyên thay đổi dở). Chủ sổ chuyển sang phiên `9cb42e1f` bằng `--takeover`: chat này lại đổi mã phiên khi mở lại — lần thứ hai trong ngày, củng cố ý 7.
- Bước kế: kiểm docs hook Claude Code (input/output PreToolUse, PostToolUse, Stop), rồi viết Kế hoạch + Tiêu chí xong cho cổng duyệt.

### 2026-11-25 · plan · Opus
- Đã kiểm docs hook (Đọc trước) và cách app mở lại chat (Bối cảnh: chung `uuid` tin đầu).
- Quyết định: tách — việc này chỉ ý 4, 5, 6, 7, 11; ý 1–3, 8, 10 thành việc mới. Logic mới ở `scripts/todo-owner.mjs` + `scripts/todo-hook.mjs` để `todo-claims.mjs` không phình.
- Bước kế: cổng duyệt (Kế hoạch, Tiêu chí, nội dung hook bước 7, dọn thư mục cũ, tạo việc PR 2).

### 2026-11-25 · verify · Opus
- Quyết định: hook đọc `.git` trên đĩa thay vì chạy `git` — từ ~265–400 ms xuống ~200 ms/lần; hook gọi script qua `${CLAUDE_PROJECT_DIR}` (docs), SessionStart thêm `fork`.
- Phát hiện: `git worktree remove <dir>` phải xét theo thư mục bị xoá, không theo thư mục chạy lệnh (đã sửa, có test).
- Dọn thư mục cũ (`5ilence-wt`, `wt2`, `wt3`, `wip`): user chưa trả lời ở cổng → chưa đụng.
