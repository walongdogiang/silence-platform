---
name: task-git
description: Quy trình git cho một việc trong todo/ — khi nào commit, push, mở PR, sửa CI, merge, và khi nào phải hỏi user. Dùng khi mọi tiêu chí của việc vừa đạt, khi chuẩn bị commit/push/mở PR/merge, hoặc khi CI của PR đỏ.
---

# task-git

Chính sách gốc: mục **Tự chủ** trong `AGENTS.md`. Ngưỡng và đường dẫn rủi ro: `.claude/git-policy.json` (đọc file này, đừng nhớ số).

## Cổng 0 — bắt đầu việc
- Nhánh từ `origin/main` (`git fetch` trước): `feat|fix|chore|docs/<T-xxx>-<slug>`. Làm trong worktree/nhánh việc, không làm trên `main`.
- `git status`: thay đổi dở có sẵn (không phải của việc) → ghi lại, **không bao giờ stage**.

## Cổng 1 — commit (chỉ khi xong trọn việc)
Đủ cả:
1. Mọi tiêu chí của việc trong `todo/` đạt (không đạt đủ mà muốn commit → hỏi user).
2. Test/check theo phạm vi (`AGENTS.md` → *Test theo phạm vi*) đã chạy và xanh. Chưa chạy được thì ghi rõ, không giả vờ.
3. `git diff --stat`: chỉ file thuộc việc; không `.env`/secrets/`node_modules`.
4. Stage **từng file** (`git add <path>`), cấm `git add -A` / `git add .`.
5. Message Conventional Commits, nhắc `T-xxx`.

## Cổng 2 — push + PR
- `git push -u origin <nhánh>`; không force, không `--no-verify`, không bao giờ đích `main`.
- `gh pr create` vào `main`: tiêu đề Conventional Commits; mô tả gồm `T-xxx`, tiêu chí đã đạt, cách đã kiểm (lệnh + kết quả), phần chưa chạy.
- Sau khi mở: `mcp__ccd_pr__get_status`, chưa gắn thì `bind_pr`; không tự poll CI.

## Cổng 3 — CI
- Đỏ: đọc log job hỏng, sửa trong phạm vi việc, commit + push cùng nhánh. Tối đa `maxCiFixAttempts` lần, quá thì **hỏi user**.
- Cấm sửa CI bằng cách tắt/giảm test hoặc workflow.

## Cổng 4 — merge
Merge **chỉ bằng** `node scripts/pr-merge.mjs <số-PR>`, không gọi `gh pr merge` trực tiếp. Script tự kiểm: PR mở, không draft, base `main`, không xung đột, `ci-ok` xanh, diff ≤ `maxFilesAutoMerge` file / `maxLinesAutoMerge` dòng, không file nào khớp `highRiskPaths`; đạt hết thì squash merge và xoá nhánh. Thêm `--dry-run` để chỉ kiểm.
- Exit 0 = xong. Exit 1 = chưa sẵn sàng (CI chưa xanh/xung đột…): chờ hoặc sửa, không ép.
- Exit 2 = cần rủi ro/diff lớn → **hỏi user**, nêu các dòng script in ra. Chỉ khi user nói rõ duyệt trong chat mới chạy lại với `--user-approved`. Việc user đã duyệt ở cổng duyệt của skill `todo` cũng dùng cờ này.
- Mọi file phải thuộc phạm vi việc (script không biết phạm vi — tự rà `git diff --stat` ở cổng 1).
Không bật auto-merge của GitHub.

## Cổng 5 — dọn
- Về `main`, `git pull`, xoá nhánh cục bộ; dùng skill `todo` để chuyển việc sang DONE.

## Luôn hỏi / không bao giờ
- Hỏi: amend/force-push commit đã push, tag, release, xung đột merge không tầm thường, nghi ngờ phạm vi.
- Cấm: push `main`, `--no-verify`, commit secrets.
