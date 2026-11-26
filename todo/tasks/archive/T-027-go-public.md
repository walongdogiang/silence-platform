---
id: T-027
title: Chuẩn bị chuyển repo 5ilence sang public
type: chore
status: done
phase: verify
area: [ci, docs, agent-kit]
size: M
model: opus
model-build: sonnet
depends: []
branch: chore/T-027-go-public
pr: 84
created: 2026-11-26
updated: 2026-11-26
---

## Mục tiêu

Repo private trên gói Free bị giới hạn 2.000 phút Actions mỗi tháng (tháng 11 dùng khoảng 2.273 phút; CI bị dừng từ 25/11) và không có branch protection. Chuyển sang public để CI không giới hạn phút và bật được branch protection, mà không lộ secrets hay thông tin user không muốn công khai. Model Opus vì có quyết định bảo mật và quyền riêng tư, không chỉ là chore đơn giản.

## Phạm vi sơ bộ

**Đã chốt (user, 2026-11-26):**
- Email trong commit cũ: **giữ nguyên** (phương án 1a). Không viết lại lịch sử, không force-push. Chỉ lộ địa chỉ email, không lộ mật khẩu.
- Chuyển public chứ không giảm phút CI hay dùng self-hosted runner.

**Làm:**
- Quét secrets toàn bộ lịch sử bằng công cụ chuyên dụng (vd `gitleaks`). Quét nhanh theo mẫu ngày 2026-11-25 chỉ thấy khoá giả trong test.
- Rà `docs/`, `todo/`, `.claude/`, `templates/` để tìm thông tin riêng tư (đường dẫn máy, ghi chú cá nhân), rồi lập danh sách nên xoá / nên sửa / ổn cho user chọn.
- Chọn giấy phép (không có / MIT / AGPL…) ở cổng duyệt.
- Đổi `git config user.email` sang email `noreply` của GitHub cho các commit từ nay.
- Hướng dẫn từng bước cho user: bấm public; bật branch protection cho `main` (bắt `ci-ok`); bật duyệt CI cho PR từ người đóng góp lần đầu.
- Cập nhật `AGENTS.md` / skill nếu luật đổi khi có branch protection (vd `main-guard`, `pr-merge.mjs`).

**Không làm:** agent tự bấm public (user làm trong Settings); viết lại lịch sử git.

Bối cảnh: chat 2026-11-25/26 (PR #82, #83), sau khi CI hết phút.

## Đọc trước

- CI: `.github/workflows/{ci,cache-cleanup,docs-check,main-guard}.yml`; cổng merge `scripts/pr-merge.mjs` (`evaluate`, cần check `ci-ok`).
- Câu "repo không có branch protection" (nói về repo này): `AGENTS.md` (mục Quy trình Git, dòng `main-guard`), `docs/adr/0003-pr-watch.md` (Hiện trạng), `docs/security/risk-catalog.md` (`GIT_PUSH_DEFAULT`), `scripts/main-guard.mjs` (chú thích đầu file + lời trong issue), `.github/workflows/main-guard.yml` (chú thích).
- Câu chung của sản phẩm (không sửa, đúng cho repo bất kỳ): `GH_MERGE` trong `default_policy.yaml` (core + runtime), `i18n.ts`.

## Bối cảnh

Kết quả khảo sát 2026-11-26 (pha design):
- **Bí mật**: 125 commit trên mọi nhánh. Đã grep theo mẫu (`sk-ant-`, `sk-`, `ghp_`, `github_pat_`, `AKIA`, `-----BEGIN … PRIVATE KEY`, `xox?-`, `AIza`, `tskey-`, JWT, `API_KEY=`): chỉ có khoá giả trong test. Chưa từng commit file `.env`, `.pem`, `settings.local`. Repo không có Actions secrets hay variables. Chưa chạy gitleaks: máy chưa có, phải tải.
- **Email**: 47 commit dùng email gmail (`~/.gitconfig` toàn cục), 78 commit dùng `55863257+walongdogiang@users.noreply.github.com` (do GitHub squash merge). Email chỉ nằm trong metadata của commit, không có trong nội dung file.
- **Đường dẫn máy**: `D:\vuhieu\…` có trong `scripts/silence.ps1`, `scripts/todo.test.mjs`, chú thích ở `risk/mod.rs` và `classify.ts`, và các file `todo/tasks/archive/*`. `C:\Users\Silence` chỉ có trong lịch sử. Vẫn còn trong lịch sử dù sửa HEAD, vì đã chốt không viết lại lịch sử.
- **Giấy phép**: không có file `LICENSE`, nhưng `Cargo.toml` (gốc) ghi `license = "MIT"`. Hai chỗ đang không khớp nhau.
- **Mã bên thứ ba trong lịch sử**: bộ GSD (`.cursor/gsd-core`, `.planning/`), đã xoá ở PR #26 và #34. Còn ở các commit cũ.
- **CI khi public**: workflow chỉ dùng `pull_request` (không dùng `pull_request_target`) với quyền `contents: read`. PR từ fork chỉ có token đọc. `cache-cleanup` cần `actions: write` nên sẽ đỏ trên PR từ fork; không hại gì vì đây không phải check bắt buộc. Các action được ghim theo tag (`@v4`), chưa ghim theo SHA.
- **Thứ tự**: CI đã hết phút từ 25/11, nên `ci-ok` của PR này chỉ chạy được sau khi user chuyển public. Vì vậy merge tự nhiên rơi vào sau bước user làm.

## Thiết kế

**Đã chốt (user, trước design):** giữ email trong commit cũ, không viết lại lịch sử; chuyển public.

**Đã chốt ở cổng duyệt (user, 2026-11-26, theo khuyến nghị):** tải gitleaks v8.30.1 để quét; **không có giấy phép** (giữ toàn quyền; MIT đã công bố thì không rút lại được, thêm sau lúc nào cũng được), nên bỏ `license = "MIT"` ở `Cargo.toml`; giữ đường dẫn `D:uhieu` (đã nằm trong lịch sử); bypass list để trống.

**Ruleset cho `main`** (Settings → Rules → Rulesets, nhánh mặc định):
- Restrict deletions, Block force pushes.
- Require a pull request before merging: 0 approvals (một người không tự duyệt PR của mình được), chỉ cho phép squash.
- Require status checks: chỉ `ci-ok`. `docs-check` không bắt buộc vì nó có bộ lọc đường dẫn: PR không đụng docs thì không chạy, PR sẽ kẹt. Không bật "up to date" để khỏi phải rebase liên tục.
- Bypass list để trống: kể cả user cũng không push thẳng `main`, khớp `AGENTS.md`. Cách khác là thêm Repository admin để còn đường thoát khi khẩn cấp.
- `pr-merge.mjs` không cần sửa: `gh pr merge --squash` chạy được khi `ci-ok` xanh và yêu cầu 0 approval.
- Giữ `main-guard` làm lớp phát hiện (bắt trường hợp có bypass, hoặc ruleset bị tắt). Chỉ sửa lời mô tả.

**Cài đặt khác cho user** (Settings): Actions → General → "Require approval for all outside collaborators"; Code security → kiểm secret scanning và push protection đã bật (public được miễn phí).

## Kế hoạch

1. [x] Quét bí mật bằng gitleaks (nếu được duyệt): giải nén vào một thư mục riêng trong scratchpad, so sha256 với file `checksums.txt` của release, chạy `gitleaks git --redact --log-opts="--all"` ở worktree. Mọi phát hiện đều phải là khoá giả trong test; có khoá thật thì dừng lại hỏi. Kiểm: số phát hiện kèm phân loại, ghi vào Nhật ký.
2. [x] Email cho commit từ nay: `git config user.email 55863257+walongdogiang@users.noreply.github.com` ở cấp repo (`.git/config`, mọi worktree dùng chung; `~/.gitconfig` giữ nguyên). Kiểm: `git config --show-origin user.email` trả `.git/config` và noreply.
3. [x] Giấy phép theo lựa chọn ở cổng (đã chọn: không có → `publish = false` ở `Cargo.toml`, các crate dùng `publish.workspace = true`; `cargo metadata` → license=null, publish=[]): MIT/AGPL → thêm `LICENSE` ở gốc và trường `license` trong các `package.json` và `Cargo.toml` của workspace; không có → không thêm file và đổi `license = "MIT"` hiện có ở `Cargo.toml` (gốc, dòng 15) thành `publish = false`, bỏ trường license, để khỏi hiểu nhầm là MIT. Kiểm: `gh repo view --json licenseInfo` sau khi merge (nếu có thêm file).
4. [x] (đã chọn giữ, không sửa) Đường dẫn máy theo lựa chọn ở cổng (thay → `scripts/silence.ps1`, `scripts/todo.test.mjs`, hai chú thích MSYS; không sửa file trong `archive/`). Kiểm: `npm run test:todo` xanh.
5. [x] Sửa lời "repo không có branch protection" ở các file trong **Đọc trước**: nay có ruleset bắt PR và `ci-ok`, `main-guard` là lưới phát hiện khi có bypass. ADR 0003 chỉ thêm một dòng "Cập nhật 2026-11-26", giữ nguyên phần lịch sử. Kiểm: `git grep -n "không có branch protection"` chỉ còn câu chung `GH_MERGE` và đoạn lịch sử của ADR; `npm run check:docs`, `npm run test:core`, `npm test --workspace @silence/studio`, `npm run test:pr-merge` xanh.
6. [x] Commit, push, mở PR. Gửi user hướng dẫn từng bước: chuyển public, tạo ruleset như **Thiết kế**, bật duyệt PR của người ngoài, kiểm secret scanning. Chờ user làm xong.
7. [x] Kiểm phía GitHub rồi merge: visibility, ruleset, `ci-ok` xanh → `node scripts/pr-merge.mjs <n> --user-approved --session <id>` (PR đụng `AGENTS.md`, `docs/security/`, `.github/workflows/`, đã duyệt ở cổng).

## Tiêu chí xong

- [x] Toàn lịch sử không có bí mật thật — kiểm: `gitleaks git --redact --log-opts="--all"` → 122 commit, 16 phát hiện, đều giả: 12 khoá giả trong test (`abcdefghijklmnop1234`, `me:pw`, `SILENCE_TEST_NO_SUCH_KEY_*`, `sk-or-v1-abcdef…`), 4 mã băm sha256 trong `.cursor/gsd-file-manifest.json`
- [x] Commit từ nay dùng email noreply — kiểm: `git config --show-origin user.email` → `.git/config` noreply; `git log -1 --format=%ae` trên commit của PR (kiểm lại sau commit)
- [x] Docs không còn nói repo này thiếu branch protection — kiểm: `git grep -n "không có branch protection"` → chỉ còn `GH_MERGE` (câu chung, 3 file) và đoạn lịch sử ADR 0003
- [x] Docs, core, Studio, pr-merge xanh — kiểm: `npm run check:docs && npm run test:core && npm test --workspace @silence/studio && npm run test:pr-merge` → docs 26 OK, rules 6 OK, core 133 pass, Studio 370 pass, tsc ok, pr-merge 8 pass, todo 29 pass. Rust (đọc risk-catalog, đổi `Cargo.toml`) để CI job `engine` chạy
- [x] (user, chặn) Repo đã public — kiểm: `gh repo view --json visibility` → `PUBLIC`
- [x] (user, chặn) Ruleset `main` đã bật: bắt PR, bắt `ci-ok`, chặn force-push và xoá — kiểm: `gh api repos/walongdogiang/silence-platform/rules/branches/main` → ruleset 28135727 active, `~DEFAULT_BRANCH`, deletion, non_fast_forward, pull_request (0 approval, squash), required `ci-ok`, bypass_actors rỗng
- [x] (user) Đã bật duyệt PR của người ngoài; secret scanning và push protection đang bật — kiểm: `actions/permissions/fork-pr-contributor-approval` → `all_external_contributors`; `security_and_analysis` → secret_scanning, push_protection `enabled`

## Phát sinh

- `cache-cleanup.yml` sẽ đỏ trên PR từ fork (token chỉ đọc, cần `actions: write`); có thể bỏ qua khi `head.repo` là fork.
- Bật Dependabot alerts (miễn phí, báo lỗ hổng thư viện npm/cargo); cân nhắc CodeQL sau (tốn phút/credit).
- Ghim action theo SHA thay vì tag (`actions/checkout@v4`, `dorny/paths-filter@v3`, `dtolnay/rust-toolchain@stable`, `Swatinem/rust-cache@v2`) vì repo public dễ bị nhắm hơn.

## Nhật ký

### 2026-11-26 · bước 1–5 · Opus
- Quyết định: email noreply đặt ở `.git/config` (dùng chung cho mọi worktree và thư mục chính), `~/.gitconfig` giữ gmail cho repo khác.
- Phát hiện: worktree mới phải `npm ci` thì vitest mới chạy được.
- Quyết định: chưa commit; chờ user chuyển public và tạo ruleset trước (không cần PR), để commit đầu đã tick đủ tiêu chí và đóng việc luôn trong đó (task-git: commit đầu khi mọi tiêu chí đã tick).
- Bước kế: user báo xong → kiểm `gh repo view --json visibility`, `gh api repos/walongdogiang/silence-platform/rules/branches/main` → tick, đóng việc (DONE, archive) → commit, PR, `ci-ok` xanh → `pr-merge.mjs --user-approved`.

### 2026-11-26 · bước 6–7 · Opus
- User làm xong 4 bước trên GitHub (public, ruleset, duyệt fork, Secret Protection); đã kiểm qua API. Commit, PR #84, đóng việc trong PR.
