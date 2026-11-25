---
name: task-git
description: Cơ chế git cho một việc trong todo/ — worktree, khi nào commit, push, mở PR, sửa CI, merge qua scripts/pr-merge.mjs, và khi nào phải hỏi user. Dùng khi chuẩn bị commit/push/mở PR/merge, hoặc khi CI của PR đỏ. Vòng đời việc (cổng duyệt, tiêu chí, đóng việc) thuộc skill todo.
---

# task-git

Chia việc với skill `todo`:
- `todo` quyết **việc gì, lúc nào xong**: cổng duyệt, tiêu chí, đóng việc (DONE, archive) **trong PR của việc, trước merge**.
- `task-git` lo **cơ chế git** dưới đây.

Chính sách gốc: mục **Tự chủ** trong `AGENTS.md`. Ngưỡng và đường dẫn rủi ro: `.claude/git-policy.json` (đọc file, đừng nhớ số).

## Khi nào làm gì

| Bước | Khi nào | Không bao giờ |
|---|---|---|
| Nhánh + worktree | Việc đã qua cổng duyệt của `todo` | Làm trên `main`; đổi nhánh thư mục chính |
| Commit đầu | Mọi tiêu chí (trừ `(user)`) đã tick, check theo phạm vi xanh | Commit lưu tạm giữa chừng |
| Commit sau | Chỉ để sửa CI đỏ hoặc góp ý review, cùng nhánh | Amend/rebase commit đã push |
| Push | Ngay sau mỗi commit | Force, `--no-verify`, đích `main` |
| Mở PR | Ngay sau push đầu | Mở PR cho việc chưa xong |
| Merge | `pr-merge.mjs` exit 0 | Gọi `gh pr merge` trực tiếp; bật auto-merge GitHub |

Việc không có `T-xxx` (user nhờ trong chat): tạo việc qua skill `todo`, lấy cổng duyệt làm tiêu chí "xong". Không có cổng duyệt thì không tự commit.

## Worktree
- Không đổi nhánh, pull hay stash ở thư mục chính của repo; nơi đó là của user.
- **Mỗi việc một worktree mới**, tạo bằng `node scripts/todo-claims.mjs worktree <T-xxx|tên> --branch <type>/<T-xxx-slug> --session <id>`: nằm ở thư mục chung `<repo chính>-worktrees\<tên>` (vd `D:\vuhieu\5ilence-worktrees\T-020`), từ `origin/main` mới fetch, không theo dõi `main`, chat này thành chủ. Rồi `npm install` nếu cần. Không dùng lại worktree có sẵn, không tự đặt chỗ khác.
- Chủ worktree tính theo **chat** (T-020, ADR 0006). Hook chặn `commit`/`push`/`switch`/`checkout`/`reset`/`rebase`/`merge`/`stash`/`pull`/`worktree remove` trong worktree của chat khác còn hoạt động (< 2 giờ), và hỏi user khi chat đó im ≥ 2 giờ. Bị chặn → tạo worktree riêng; **không lách** (đổi thư mục, gọi git kiểu khác). Lệnh chỉ đọc không bị chặn.
- Xong việc (sau merge): `git worktree remove <thư-mục>` rồi xoá nhánh cục bộ. Đầu phiên có dòng "Thư mục worktree có thể dọn" → hỏi user từng cái, không tự xoá.

## Commit
1. `git diff --stat`: chỉ file thuộc việc; không `.env`/secrets/`node_modules`.
2. Stage **từng file** (`git add <path>`); cấm `git add -A` / `git add .`.
3. Message Conventional Commits, nhắc `T-xxx`. Trên Windows ghi message ra file rồi `git commit -F <file>`.

## Push + PR
- `git push -u origin <nhánh>`.
- `gh pr create --base main` (mô tả qua `--body-file`): tiêu đề Conventional Commits; mô tả gồm `T-xxx`, tiêu chí đã đạt, cách đã kiểm (lệnh + kết quả), phần chưa chạy.
- Sau khi mở: `mcp__ccd_pr__get_status`, chưa gắn thì `bind_pr`. Không tự poll CI.
- Ghi vào sổ chung (ADR 0006): `node scripts/todo-claims.mjs event pr_opened --pr <n> --session <id>`.
- Đề nghị user bật Auto-fix cho PR, để app đánh thức agent khi CI có kết quả. Không bật thì bước merge diễn ra ở lượt kế tiếp user nhắn; nói rõ điều đó trong tin cuối.

## CI đỏ
- Đọc log job hỏng, sửa trong phạm vi việc, commit + push cùng nhánh. Tối đa `maxCiFixAttempts` lần, quá thì **hỏi user** và ghi `event ci_red --pr <n>`.
- Cấm sửa CI bằng cách tắt/giảm test hoặc workflow.

## Merge
Chỉ bằng `node scripts/pr-merge.mjs <số-PR> --session <id>` (thêm `--dry-run` để chỉ kiểm). Merge xong script tự ghi sự kiện `merged` kèm danh sách file; `--session` để phiên này không tự nhận báo. Script kiểm: PR mở, không draft, base `main`, không xung đột, `ci-ok` xanh, diff trong ngưỡng, không file nào khớp `highRiskPaths`; đạt hết thì squash merge và xoá nhánh remote.
- Exit 0 = xong. Exit 1 = chưa sẵn sàng (CI chưa xanh, xung đột…): chờ hoặc sửa, không ép.
- Exit 2 = rủi ro cao/diff lớn → **hỏi user**, kèm các dòng script in ra. Chỉ chạy lại với `--user-approved` khi user nói rõ duyệt trong chat, hoặc việc đã qua cổng duyệt của `todo`.
- Script không biết phạm vi việc: tự rà `git diff --stat` trước đó.

## Sau merge
- Worktree về `git switch --detach origin/main` (sau `git fetch`), xoá nhánh cục bộ.
- `node scripts/todo-claims.mjs release T-xxx` (việc đã đóng trong PR, không sửa `todo/` sau merge).

## Luôn hỏi / không bao giờ
- Hỏi: amend/force-push commit đã push, tag, release, xung đột merge không tầm thường, nghi ngờ phạm vi, đụng thư mục chính.
- Cấm: push `main`, `--no-verify`, commit secrets.
