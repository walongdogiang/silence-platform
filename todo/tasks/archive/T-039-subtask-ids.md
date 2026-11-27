---
id: T-039
title: Việc cha / việc con với mã dấu chấm (T-070.1)
type: feature
status: done
phase: verify
area: [agent-kit]
size: M
model: opus
depends: []
branch: feat/T-039-subtask-ids
pr: 102
created: 2026-11-27
updated: 2026-11-28
---

## Mục tiêu

Việc lớn được chia thành việc con có mã nói rõ quan hệ: việc cha `T-070`, việc con `T-070.1`, `T-070.2`… Mọi việc con xong thì việc cha xong. Mỗi PR nhỏ, dễ duyệt, mỗi phiên làm trọn một phần.

User đã chọn dạng dấu chấm (2026-11-27), thay vì `T-070-001` hay mã độc lập kèm `parent:`.

## Phạm vi

**Làm (thiết kế đã chốt với user, chi tiết còn quyết ở pha design):**
- **Mã:**
  - Chỉ 2 cấp, cha `T-NNN` và con `T-NNN.k` (k = 1, 2, …, không đệm số 0). Không có cấp `T-070.1.1`.
  - Mã chỉ để định danh, không mang lĩnh vực hay loại việc.
  - Gạch nối chỉ dùng để ngăn mã với tên: `T-070.2-core-fs.md`, nhánh `feat/T-070.2-core-fs`.
- **Cấu trúc file:** mỗi việc cha một thư mục `todo/tasks/T-070-slug/`, gồm `README.md` của việc cha và các file `T-070.k-slug.md`. Có mẫu riêng cho việc cha (`_template-parent.md`).
- **Việc cha:**
  - Không có PR riêng.
  - Giữ mục tiêu, thiết kế chung, danh sách con và tiêu chí chung (có thể có dòng `(user)`).
  - Đóng trong PR của việc con cuối cùng, khi tiêu chí chung đã đạt; nếu chưa đạt thì chờ user.
- **Việc con:**
  - Một PR, xong trong 1–2 phiên, tối đa ~7 tiêu chí.
  - Nhận việc theo mã con (`claim T-070.2`).
  - Các việc con có vùng file không chồng nhau thì chạy song song được (`--areas`).
- **Mục lục:**
  - Next chỉ ghi việc cha, một dòng kèm tiến độ và việc con kế tiếp, ví dụ `T-070 Xoá Engine Rust ▓▓░░░ 2/5 · tiếp: T-070.3`.
  - Hook và `/todo` gợi ý việc con kế tiếp.
- **Quy tắc:** việc cỡ L không được vào Now khi chưa tách con; pha design của việc cha sinh ra danh sách con.
- **`/todo doctor` kiểm thêm:** việc con mồ côi, việc cha đã đóng mà còn con mở, mã con trùng.
- **Sửa script đọc mã** (hiện đều dùng `/T-\d+/`, sẽ đọc `T-070.2` thành `T-070`):
  - `scripts/todo-claims.mjs`: kiểm mã, doctor, cấp mã con.
  - `scripts/todo-events.mjs`: `TASK`, `TO`, sự kiện `merged`.
  - `scripts/todo-brief.mjs`: đọc mục lục, `blocked-by`.
  - `scripts/pr-merge.mjs`: suy mã việc từ tên nhánh và tiêu đề PR.
  - Kiểm thêm `scripts/todo-owner.mjs` (chưa kiểm có suy mã từ nhánh không).
  - Kèm test trong `scripts/todo.test.mjs`.
- **Sửa skill:** `.claude/skills/todo/SKILL.md` và `cards.md` (thẻ việc cha / con), `.claude/skills/task-git` nếu nhắc mẫu mã.

**Không làm:**
- Đánh số lại việc cũ (T-006, T-031…T-035 giữ nguyên mã, để không hỏng liên kết trong DONE.md, PR, sổ sự kiện).
- Bảng việc dạng cây trong Studio (để T-019).
- Tách T-038: làm ngay sau việc này, theo dạng mới.

## Bối cảnh

- Đụng `highRiskPaths` (`.claude/skills/`, `scripts/pr-merge.mjs`), nên user duyệt ở cổng duyệt trước khi merge.
- Ý tưởng kèm theo (quyết ở design, không bắt buộc): bỏ số lộ trình kiểu "2.1a" khỏi tên việc, cho lộ trình trỏ về mã việc cha (`docs/adapters/migration.md`).

## Đọc trước

- `scripts/todo-claims.mjs` → `claim` (kiểm mã), `findTaskFile` (trước chỉ quét `tasks/` phẳng), `doctor`, `holdingLine`, `reserveId`, `main` (lấy mã từ argv).
- `scripts/todo-events.mjs` → `TASK`, `TO`, `mergeEventsFromCommits` (mã từ tiêu đề commit), `relevantFor` (`to` khớp đúng mã), `nextTaskId`.
- `scripts/todo-brief.mjs` → `sections`, `parseItem` (mã + `blocked-by`), `criteria`, `describe` trong `brief`.
- `scripts/pr-merge.mjs` → `mergedEvent` (mã từ nhánh rồi tiêu đề).
- `scripts/todo-owner.mjs`, `todo-hook.mjs`: không suy mã việc, không phải sửa.
- Test: `scripts/todo.test.mjs`, `scripts/pr-merge.test.mjs` (`npm run test:todo`, `npm run test:pr-merge`).

## Thiết kế

Đã chốt từ trước (Phạm vi): mã `T-NNN.k`, 2 cấp, thư mục cha, cha không có PR, Next chỉ ghi cha.

**Đã chốt ở design (tiêu chí: ít nơi giữ trạng thái nhất, script đọc được bằng regex đơn giản):**
- **Mã:** regex chung `TASK_ID` / `TASK_ID_FULL` (+ `taskIdIn`, `taskIdsIn`, `isChildId`, `parentOf`) xuất từ `todo-events.mjs`; mọi chỗ từng dùng `/T-\d+/` dùng chúng. Từ chối `T-070.0`, `T-070.01`, `T-070.1.1`. `TASK_ID` có lookahead `(?!\.?\d)` để các mã sai đó không bị đọc thành mã khác, còn dấu chấm cuối câu vẫn nhận.
- **Danh sách con = nguồn sự thật tiến độ:** `README.md` của cha có mục `## Việc con`, mỗi dòng một checkbox:
  `- [ ] T-070.2 Lõi nhận fs.* · [chi tiết](T-070.2-core-fs.md) · blocked-by: T-070.1`.
  Tick `[x]` trong PR của chính việc con đó. Tiến độ = đã tick / tổng; con kế tiếp = dòng chưa tick đầu tiên không bị `blocked-by` một mã chưa xong.
- **Mục lục:** cha nằm ở Next khi chưa con nào đang làm; có con đang làm thì dòng cha lên **Now** (một dòng cha dù 2 con chạy song song). Dòng cha không ghi tiến độ bằng tay, brief tính từ `## Việc con` (đổi so với Phạm vi: tránh hai chỗ lệch nhau). `MAX_NOW` vẫn đếm theo việc đang được giữ (con).
- **Brief / `/todo`:** việc cha hiện `con 2/5 · tiếp: T-070.3 <tên>` và model lấy từ file con kế. Ở Now hiện con nào đang giữ. `holdingLine` với mã con lấy tên từ danh sách con của cha.
- **Cấp mã con:** `reserve-id --parent T-070 --session <id>` → `T-070.(k+1)`, k = số lớn nhất thấy ở danh sách con (local + origin/main), tên nhánh, chỗ đã giữ trong sổ (`reserved`, `childHigh`). Không đụng bộ đếm `Mã tiếp theo`.
- **Đóng:** con xong → tick dòng trong cha, `status: done` trong file con, file con **ở lại** thư mục cha; `DONE.md` một dòng cho con. Con cuối xong mà tiêu chí chung của cha đã tick (trừ `(user)`) → cùng PR đó đóng cha: xoá dòng mục lục, `DONE.md` một dòng cho cha, chuyển cả thư mục vào `archive/`. Tiêu chí chung chưa đạt → `⛔ Chờ bạn`.
- **`blocked-by: T-070`** chờ cả việc cha; `blocked-by: T-070.2` chờ một con.
- **`note --to T-070`** tới cả các phiên đang giữ con của T-070; `--to T-070.2` chỉ tới con đó.
- **Doctor kiểm thêm:** con mồ côi (file không có trong `## Việc con`, hoặc nằm ngoài thư mục cha), con sai thư mục/sai cha, mã con trùng, cha `status: done` mà còn con chưa tick, việc `size: L` ở Now mà không có `## Việc con`. `doctor` nhận `listDir` tuỳ chọn để test không cần đĩa.

**Không làm trong việc này (bản nhỏ nhất trước):**
- Bỏ số lộ trình "2.1a" khỏi tên việc: để lúc tách T-038 / T-006 quyết, không cần script.
- Hook chặn đưa việc L vào Now: chỉ luật trong skill + doctor cảnh báo.

**Đã thử, bỏ:**
- Ghi tiến độ con ngay trên dòng cha ở mục lục: hai nơi giữ một số, dễ lệch.
- Tiến độ theo `status:` của từng file con: brief phải mở mọi file con mỗi phiên; checklist trong cha đọc một file.

## Kế hoạch

1. [x] Regex mã chung trong `todo-events.mjs`; thay ở `TASK`, `TO`, `mergeEventsFromCommits`, `todo-claims.mjs` (`claim`, `doctor`, `main`), `todo-brief.mjs` (`parseItem`), `pr-merge.mjs` (`mergedEvent`). Kiểm: test mã hợp lệ / sai, nhánh `feat/T-070.2-x`.
2. [x] `relevantFor`: `to: T-070` tới phiên giữ `T-070.k`. Kiểm: test.
3. [x] `findTaskFile` quét thư mục cha; `children`, `nextChild`, `childPath`. Kiểm: test.
4. [x] `brief` + `holdingLine`: tiến độ con, con kế, model của con kế, con đang giữ. Kiểm: test.
5. [x] `reserveChildId` / CLI `reserve-id --parent`. Kiểm: test.
6. [x] `doctor` kiểm thêm 5 lỗi. Kiểm: test mỗi lỗi một ca; chạy `doctor` thật trên repo.
7. [x] Sửa `claim`: phiên đã giữ việc chạy lại `claim` trong worktree thì sổ ghi lại worktree + nhánh (Phát sinh, user chọn gộp 2026-11-28). Kiểm: test.
8. [x] Skill + mẫu: `todo/tasks/_template-parent.md`; `.claude/skills/todo/SKILL.md` mục **Việc cha / việc con**; `cards.md` mục Việc con trong thẻ việc; `task-git` mẫu nhánh việc con. Kiểm: test đọc ví dụ trong skill và mẫu.

## Tiêu chí xong

- [x] Mã con được nhận đúng ở claim, release, event, `note --to`, sự kiện `merged` (nhánh, tiêu đề PR, commit); mã sai bị từ chối — kiểm: `npm run test:todo` và `npm run test:pr-merge`, có ca cho `T-070.2`, `T-070.0`, `T-070.1.1` → todo 40 pass, pr-merge 8 pass
- [x] `reserve-id --parent T-070` cấp mã con không trùng (danh sách con, nhánh, chỗ phiên khác đã giữ) — kiểm: `npm run test:todo` → 40 pass; CLI từ chối `--parent T-039.1` và cha chưa có thư mục
- [x] Brief và `/todo` hiện việc cha kèm `con k/n · tiếp: T-070.x` và model của con kế; tin nhắc việc đang giữ có tên con — kiểm: `npm run test:todo` → 40 pass; `todo-brief.mjs` và `heartbeat` chạy thật trên repo ra như cũ
- [x] Doctor bắt: con mồ côi, con sai thư mục, mã con trùng, cha đã đóng còn con mở, việc L ở Now chưa tách — kiểm: `npm run test:todo` → 40 pass; `node scripts/todo-claims.mjs doctor` trên repo → "Không thấy gì lệch."
- [x] Skill `todo`, `cards.md`, `task-git` và mẫu `_template-parent.md` mô tả đủ tách / nhận / đóng con / đóng cha — kiểm: đọc lại diff; test "ví dụ trong skill todo và mẫu việc cha khớp với script" pass
- [x] `claim` lần hai trong worktree ghi lại worktree và nhánh — kiểm: `npm run test:todo` (claim ở thư mục chính rồi claim kèm worktree) → pass; sổ thật giờ ghi `D:/vuhieu/5ilence-worktrees/T-039`
- [ ] (user) Dùng thử khi tách T-038 ở việc kế: `/todo` hiện đúng việc cha và con kế

## Phát sinh

- (đã gộp vào bước 7) `claim` khi phiên đã giữ việc thì trả sớm, không ghi lại worktree/nhánh.

## Nhật ký

### 2026-11-28 · design + plan · Opus
- Quyết định: tiến độ con nằm ở `## Việc con` của cha (một nơi), dòng cha lên Now khi có con đang làm.
- Phát hiện: chỉ 4 script có regex mã (12 chỗ); `todo-owner.mjs`, `todo-hook.mjs` không cần sửa.

### 2026-11-28 · cổng duyệt · Opus
- Quyết định: user duyệt (chọn 2), gộp sửa `claim` vào việc này (bước 7).

### 2026-11-28 · build + verify · Opus
- Quyết định: việc cha ở Next trong brief lấy model của con kế tiếp.
- Đã thử, bỏ: script đóng việc lỗi giữa chừng mà lệnh `rm` sau đó vẫn chạy, xoá mất file task chưa commit → dựng lại từ HEAD + nội dung trong chat.
- Bước kế: (user) dùng thử khi tách T-038.
