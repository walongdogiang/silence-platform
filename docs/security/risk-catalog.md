---
description: Bảng tra mã rủi ro (RiskCode) — lệnh/hành động nào tự chạy, ghi nhận, phải hỏi hay bị chặn; ví dụ PowerShell/bash, git, package, mạng, file, secrets, hệ thống, MCP.
type: reference
code:
  - crates/runtime/src/risk/default_policy.yaml
  - crates/runtime/src/risk/corpus.yaml
  - crates/runtime/src/risk/mod.rs
---
# Risk catalog

Bảng tra cho [permissions.md](permissions.md). **Nguồn máy** là [`default_policy.yaml`](../../crates/runtime/src/risk/default_policy.yaml); file này là bản cho người đọc. Test `catalog_lists_every_code` bắt buộc mọi mã trong YAML phải có trong file này.

Khi thêm hoặc đổi luật:
1. Sửa `default_policy.yaml`.
2. Thêm ít nhất một dòng vào `corpus.yaml`, gồm ca an toàn và ca tấn công.
3. Cập nhật bảng dưới đây.
4. Chạy `cargo test -p silence-engine --lib risk`.

Tầng: **0 auto** tự chạy · **1 logged** tự chạy và ghi audit · **2 ask** hỏi kèm giải thích · **3 block** chặn.

## Tầng 3 — Chặn

Agent không được làm. User muốn thì tự chạy ngoài 5ilence.

| Mã | Ví dụ | Vì sao chặn |
| --- | --- | --- |
| `NET_DOWNLOAD_EXEC` | `curl … \| sh`, `curl … \| sudo bash -s`, `iwr … \| iex`, `iex (iwr …)`, `IEX (New-Object Net.WebClient).DownloadString(…)` | Kiểu tấn công prompt injection phổ biến nhất: chạy code lạ không qua bước xem |
| `ENCODED_COMMAND` | `powershell -EncodedCommand …`, `pwsh -enc …`, `echo … \| base64 -d \| sh` | Nội dung bị che, user không đọc được |
| `FS_DELETE_SYSTEM` | `rm -rf /`, `rm -rf ~`, `rm -rf ../`, `Remove-Item C:\ -Recurse`, `rd /s /q C:\Windows`, xoá `$env:USERPROFILE\…` | Xoá đệ quy ngoài workspace, không khôi phục được |
| `DISK_DESTROY` | `format`, `Format-Volume`, `diskpart`, `bcdedit`, `vssadmin`, `mkfs`, `cipher /w` | Phá đĩa, phân vùng hoặc khởi động; mất dữ liệu không khôi phục được. Lõi TS: chặn cứng (Bypass: hỏi có đếm ngược). Engine Rust vẫn gắn `SYSTEM_CHANGE` |
| `SYSTEM_CHANGE` | `reg add/delete/import`, `Set-ExecutionPolicy`, `Set-MpPreference`, `netsh`, `schtasks /create`, `sc create`, `New-Service`, `takeown`, `icacls`, `shutdown`, `Restart-Computer`, `sudo …`, `runas` | Đổi cấu hình máy, bảo mật, khởi động hoặc tạo persistence |
| `SECRET_EXFIL` | `curl -d @.env https://…`, `cat .env \| curl --data-binary @- …`, `iwr -Method Post -InFile .env` | Gửi bí mật ra mạng |
| `HTTP_NOT_LOCAL` | `http_check` tới `https://example.com`, IP trong LAN, `file://`, `localhost.evil.com` | Tool chỉ để kiểm app trên máy này; ra ngoài thì phải đi qua lệnh mạng (`NET_ACCESS`, có hỏi) |
| `BROWSER_NOT_LOCAL` | `browser_open` tới `https://…` ngoài máy, IP LAN, `file://` | Trình duyệt của agent chỉ để kiểm app trên máy này, không để lướt web |
| `POLICY_TAMPER` | `write`/`edit`/shell ghi `.silence/permissions.json`, `.silence/policy.yaml` | Agent tự nới quyền cho chính nó; chỉ user (Settings) và Engine được ghi |
| `GIT_PUSH_DEFAULT` | `git push origin main`, `HEAD:main`, `x:refs/heads/main`, `+main`, `:master`, `--all`, `git -C dir push origin main`; `git push` / `git push origin` khi đang đứng trên `main` (đọc `.git/HEAD`, kể cả worktree). Nhánh mặc định = `main`, `master` và nhánh mà `origin/HEAD` trỏ tới | Bỏ qua PR và CI. Repo private gói Free không có branch protection nên đây là chốt chặn chính ([ADR 0003](../adr/0003-pr-watch.md)). Không có thẻ leo thang (`never_escalate`) |
| `GIT_NO_VERIFY` | `--no-verify` trên mọi lệnh git, `git commit -n` / `-nm`, `git -c core.hooksPath=…`, `--config-env=core.hooksPath=…`, `git config core.hooksPath …` / `--unset` (trừ `--get`/`--list`) | Vô hiệu hoá hook `pre-push` (lớp 2 bảo vệ `main`). Không có thẻ leo thang |

## Tầng 2 — Hỏi kèm giải thích

| Mã | Ví dụ | Tác động user cần biết |
| --- | --- | --- |
| `PKG_INSTALL` | `npm install x`, `npm ci`, `pnpm add`, `pip install`, `uv add`, `cargo add/install`, `go get`, `winget`, `choco`, `scoop`, `Install-Module` | Mạng, chạy install script, sửa lock file và thư mục dependency |
| `PKG_EXEC` | `npx …`, `pnpm dlx`, `bunx`, `uvx`, `npm exec` | Tải package rồi chạy ngay |
| `PKG_PUBLISH` | `npm/pnpm/yarn/bun publish`, `cargo publish`, `twine upload`, `poetry/uv publish`, `dotnet nuget push`, `gem push` | Đẩy lên registry công khai, không thu hồi được hoàn toàn. Không bao giờ nhớ được (`never_remember`). Trong Tự chủ vẫn hỏi, kể cả khi domain registry có trong allowlist |
| `NET_ACCESS` | `curl`, `Invoke-WebRequest`, `Invoke-RestMethod`, `ssh`, `scp`, `nc`, `ping`, `Test-NetConnection` | Kết nối ra ngoài máy |
| `GIT_NETWORK` | `git push/pull/fetch/clone/submodule`, `npm publish` | Đổi hoặc lấy dữ liệu từ remote |
| `GIT_COMMIT` | `git commit/merge/tag/cherry-pick/revert/config` | Ghi lịch sử. Repo yêu cầu hỏi trước khi commit |
| `GIT_DESTRUCTIVE` | `git reset --hard`, `git clean -fdx`, `git checkout -- .`, `git restore`, `git push --force`, `git branch -D`, `git stash drop/clear`, `git rebase` | Có thể mất việc chưa lưu |
| `GH_WRITE` | `gh pr create/comment/edit/close`, `gh issue …`, `gh run rerun/cancel`, `gh workflow run`, `gh release create`, `gh repo …`, `gh label …`; `gh api` có `-X POST/PUT/PATCH/DELETE`, `-f/-F/--field/--raw-field/--input`, hoặc GraphQL `mutation` / `query=@file` | Thay đổi trên GitHub bằng danh tính của user. Trong Tự chủ vẫn hỏi (`always_ask`) |
| `GH_MERGE` | `gh pr merge`, `gh api -X PUT …/pulls/<n>/merge`, GraphQL `mergePullRequest` | Merge vào nhánh đích; GitHub không tự chặn khi CI đỏ nếu thiếu branch protection. Không bao giờ nhớ được (`never_remember`), trong Tự chủ vẫn hỏi |
| `FS_DELETE` | `rm`, `del`, `Remove-Item` trong workspace, `git rm`, `find -delete`, `Clear-Content` | Xoá không có checkpoint |
| `FS_OUTSIDE_WS` | `cat ../other/x`, `Get-Content C:\Users\…`, `cd ..`, `echo > C:\temp\x`, chạy `C:\tools\x.exe`, write/edit ngoài workspace | Ra khỏi phạm vi dự án |
| `SECRET_READ` | `.env`, `.env.*`, `*.pem`, `*.key`, `*.pfx`, `id_rsa`, `id_ed25519`, `.ssh/`, `.aws/`, `.npmrc`, `.pypirc`, `.git-credentials`, `.netrc`, `credentials*`, `secrets.*`; `gh auth token` (in token GitHub), `gh secret …` | Có thể lộ khoá. Agent không được in giá trị |
| `ENV_READ` | `env`, `printenv`, `set`, `Get-ChildItem env:` | Biến môi trường hay chứa API key |
| `INLINE_CODE` | `python -c "…"`, `node -e "…"`, `cmd /c …`, `pwsh -Command "…"`, interpreter không có file | Code không nằm trong file để xem lại; nên viết thành script |
| `DYNAMIC_EXEC` | `Invoke-Expression $x`, `eval`, `Invoke-Command`, `source`, `cat x.sh \| bash`, `find -exec` | Chạy chuỗi như lệnh |
| `UNPARSED` | `$(…)`, backtick subshell, `<(…)`, quote không đóng, `rm -rf $VAR`, `rm` không có đích | Không xác định được lệnh sẽ làm gì |
| `PROC_KILL` | `Stop-Process`, `taskkill`, `pkill`, `killall` | Có thể dừng chương trình của user |
| `MCP_CALL` | `mcp__server__tool` không khai báo chỉ đọc | Server ngoài, 5ilence không biết tác dụng |
| `TAINTED_CONTEXT` | Lệnh shell tầng 0–1 trong phiên đã nhận output MCP hoặc nội dung tải từ mạng (`curl`, `iwr`) | Lệnh có thể do nội dung bên ngoài điều khiển |
| `UNKNOWN_COMMAND` | Chương trình chưa có trong policy | Mặc định thận trọng |
| `UNKNOWN_TOOL` | Tool chưa có trong policy | Mặc định thận trọng |

## Tầng 1 — Tự chạy, ghi audit

| Mã | Ví dụ | Vì sao an toàn đủ |
| --- | --- | --- |
| `WRITE_WS` | `write`/`edit` trong workspace; `New-Item`, `Set-Content`, `Copy-Item`, `Move-Item`, `> file` trong workspace | Có DiffCard và checkpoint để Restore |
| `BUILD_TEST` | `cargo test/check/build/clippy/fmt/run`, `cargo-msvc.bat`, `npm test`, `npm run …`, `pnpm test`, `pytest`, `python -m pytest`, `go test/build/vet`, `dotnet test/build`, `tsc`, `vitest`, `jest`, `eslint`, `prettier`, `ruff`, `mypy`, `make` | Lệnh của dự án, trong workspace. Sau khi có sandbox mạng sẽ chạy offline |
| `RUN_SCRIPT` | `python calc.py`, `node scripts/check.mjs`, `.\tools\x.ps1` (file trong workspace) | Script trong repo, user xem được |
| `GIT_LOCAL` | `git add`, `git stash`, `git switch`, `git checkout -b`, `git mv` | Cục bộ, đảo ngược được |
| `LOCAL_HTTP` | `http_check` tới `localhost`, `127.0.0.1`, `::1` (redirect ra ngoài bị chặn, không proxy) | Chỉ chạm app của chính user trên máy này; không gây taint. Ask/Review chỉ cho GET/HEAD/OPTIONS |
| `LOCAL_BROWSER` | `browser_open` tới localhost; `browser_act` (bấm, gõ, chọn) trên trang đó | Trình duyệt headless, profile tạm không cookie; chỉ chạm app của chính user. Trang rời khỏi máy (redirect, link) thì phiên bị taint. Ask/Review không có `browser_act` |
| `MCP_READ` | Tool MCP có `readOnlyHint` | Không ghi; output vẫn bị coi là nội dung bên ngoài (làm phát sinh taint) |
| `GH_READ` | `gh pr view/checks/list/diff/status`, `gh run view/list/watch`, `gh issue view/list`, `gh repo view`, `gh workflow view/list`, `gh release view/list`, `gh auth status`; `gh api` chỉ GET (không cờ ghi), GraphQL không `mutation` | Chỉ đọc qua tài khoản GitHub của user; ghi audit vì có đi mạng |

## Tầng 0 — Tự chạy

| Mã | Ví dụ |
| --- | --- |
| `READ_WS` | Tool `read`, `outline`, `glob`, `grep`, `view_image`, `git_status`, `git_diff`, `skill` (đọc SKILL.md của workspace) trong workspace |
| `READ_CMD` | `ls`, `dir`, `Get-ChildItem`, `cat`, `type`, `Get-Content`, `rg`, `grep`, `find`, `Select-String`, `Select-Object`, `Measure-Object`, `head`, `tail`, `wc`, `echo`, `Test-Path`, `cd`/`Set-Location` trong workspace |
| `VERSION` | `python --version`, `node -v`, `cargo --version` |
| `GIT_READ` | `git status/diff/log/show/blame/rev-parse/ls-files/branch/remote` |
| `INTERNAL` | `submit_plan`, `suggest_mode`, `task` (tool của sub-agent vẫn bị xét riêng), `update_todos` |

## Quy tắc ghép

- Một dòng lệnh được tách tại `|`, `;`, `&&`, `||`, `&`, xuống dòng, `( )`, `{ }`. **Tầng của cả dòng = tầng cao nhất của mọi đoạn.**
- Alias PowerShell được quy về tên gốc (`rm` → `Remove-Item`, `iwr` → `Invoke-WebRequest`, `iex` → `Invoke-Expression`…), xem `aliases` trong YAML.
- `sudo`/`doas` được bóc ra để xét lệnh bên trong, đồng thời gắn `SYSTEM_CHANGE`.
- `git` được bóc option toàn cục (`-C dir`, `-c k=v`, `--git-dir`, `--work-tree`…) trước khi khớp luật, nên `git -C dir push` được xét như `git push` (`risk/mod.rs::git_globals`).
- Mỗi tham số trông như đường dẫn đều được xét: ngoài workspace, secrets, policy file.
- Nhớ quyền: chỉ lệnh đơn có mẫu (`npm install *`); mã trong `never_remember` luôn hỏi lại; tầng 3 không bao giờ được nhớ.
- Workspace `.silence/policy.yaml` (chưa làm) chỉ được **siết**: thêm luật ask/block, không hạ được mã tầng 3.
