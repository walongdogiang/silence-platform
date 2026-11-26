---
description: Quyết định cho theo dõi PR và tự sửa (Auto-fix) — chủ là PR không phải chat, chạy local + khay trước, hợp đồng sửa sẵn cho cloud, 4 lớp bảo vệ main không cần GitHub Pro.
type: adr
status: draft
code:
  - apps/studio/src/main/index.ts
  - crates/runtime/src/risk/default_policy.yaml
  - crates/runtime/src/agent/policy.rs
---
# ADR 0003 — Theo dõi PR và tự sửa (Auto-fix)

**Status:** Proposed · **Date:** 2026-11-16 · Spec chi tiết: [../pr-watch.md](../pr-watch.md)

## Context

Kiểu hỏng chính là **đứng yên**: PR đỏ nằm đó, không ai sửa, nhưng người dùng tưởng đang có người lo. Kiểu "sửa sai" ít gặp hơn. Hiện trạng repo:

- Engine tắt cùng cửa sổ (`main/index.ts`, handler `window-all-closed`), nên mọi việc nền chết theo app.
- `git commit` và `git push` là `ask` (`GIT_COMMIT`, `GIT_NETWORK`). Tự sửa khi không có người ngồi đó mâu thuẫn với chế độ Cân bằng.
- CI chạy `windows-latest` (Engine dùng ConPTY và Job Object), nên lượt sửa trên cloud cũng phải dùng Windows runner. Repo private tính phút Windows gấp đôi.
- Repo private trên gói Free: không có branch protection hay ruleset (API trả 403). GitHub không chặn merge khi CI đỏ, cũng không chặn push thẳng `main`.
  - **Cập nhật 2026-11-26 (T-027):** repo chuyển public, có ruleset cho `main` (bắt PR, bắt `ci-ok`, chặn force-push và xoá). Lớp 4 (`main-guard`) giữ lại làm lưới phát hiện.

## Tham khảo (11/2026)

| | Nơi chạy | Ngữ cảnh | Thất bại thì ai biết | Bản sửa đẩy lên đâu |
| --- | --- | --- | --- | --- |
| Claude Code desktop | Local, gắn 1 session; `gh`; app đánh thức session bằng event | Cả chat | Chỉ trong app | Thẳng nhánh PR |
| Cursor Bugbot Autofix / Automations | Cloud agent; trigger GitHub (có "CI completed") | Đọc lại PR + `MEMORIES.md` | Check `Cursor Bugbot Autofix` trên PR | Mặc định nhánh mới; nhánh PR có trần 3 lần |
| Codex | Cloud task (`@codex`) hoặc Action khi CI fail | Đọc lại PR | Trên PR | PR mới hoặc patch |
| Copilot coding agent | Actions runner; `@copilot`, nút "Fix with Copilot" | Đọc lại PR | Timeline PR | Nhánh của agent; workflow do agent sửa phải được duyệt mới chạy |

Không công cụ nào tự bảo vệ được `main` ở phía server. Họ giới hạn agent của chính mình và dựa vào branch protection.

## Các phương án

- **A. Local + trạng thái trên GitHub.** Rẻ, giữ Risk Engine và audit. Máy tắt thì dừng, nhưng vẫn báo đúng.
- **B. Cloud trước** (Actions sửa, Studio chỉ xem). Bền, nhưng tốn phút Windows, cần 2 secret và một harness thứ hai.
- **C. Một hợp đồng, hai nơi chạy.** Local khi Studio online, cloud khi offline, khoá điều phối nằm trên GitHub. Bền nhất, phức tạp nhất.
- **D. Engine chạy nền (khay).** Đóng cửa sổ vẫn theo dõi. Máy tắt hay ngủ thì dừng.

## Decision

1. **Triển khai A + D, thiết kế hợp đồng sẵn cho C** (lựa chọn 1b). Thêm cloud là một bước riêng, không phải viết lại.
2. **Chủ của việc theo dõi là PR, không phải chat.** Chat chỉ là nơi xem (`linked_sessions`, 0..n). Xoá hay archive chat không làm dừng theo dõi. Không có trạng thái `orphaned`.
3. **Monitor không gọi LLM** (poll `gh`, so snapshot). Chỉ lượt sửa mới tốn token.
4. **Lượt sửa không trạng thái:** đầu vào là sự cố + ledger + lease; mọi ngữ cảnh đọc lại từ GitHub. Nhờ vậy cùng một lượt sửa chạy được local hoặc cloud.
5. **Trạng thái nằm trên chính PR** (commit status `5ilence/watch`), giống cách Cursor dùng check. Mặc định không comment lên PR, vì comment có thể đánh thức lại bot (xem claude-code#102877).
6. **Lease thay cho chế độ Tự chủ:** bật Auto-fix là cấp quyền commit và push (không force) vào đúng một nhánh, có hạn, ghi audit. Lệnh `ask` khác vẫn hỏi, lúc đó lượt sửa chuyển `needs_user`.
7. Bản sửa **push thẳng nhánh PR** (3a). **Không tự merge**, chỉ báo "xanh, sẵn sàng merge" (4a).
8. Nơi chạy cloud sau này dùng **API key Console có trần chi tiêu** (2a).

## Vì sao không làm như các tool khác

- **Claude Code** gắn việc theo dõi vào session, vì session chứa worktree, quyền và ngữ cảnh, và họ đã có cloud session cho độ bền. Cái giá là hỏng im lặng khi chat bị xoá, app tắt hay hết budget. Khi CI xanh cũng không có gì đánh thức session (claude-code#108126).
- **Cursor, Codex, Copilot** có một nơi chạy duy nhất là cloud, dùng VM bỏ đi sau mỗi lượt, nhận webhook với tư cách GitHub App. Với 5ilence: không bind LAN nên không nhận webhook; CI Windows tốn phút; secret trên cloud nằm ngoài Risk Engine.
- **Không ai tự chuyển nơi chạy** vì session của họ mang trạng thái theo (file chưa commit, môi trường máy). Hợp đồng không trạng thái ở mục 4 là điều kiện để 5ilence làm được việc này.

## Bảo vệ main không cần GitHub Pro

| Lớp | Cách làm | Chặn được | Còn hở |
| --- | --- | --- | --- |
| 1. Risk Engine | Push vào nhánh mặc định: `block`. `--no-verify`: `block`. Merge qua `gh`: `ask` + kiểm checks | AI của 5ilence | Công cụ khác, người |
| 2. Hook `pre-push` | `.githooks/pre-push` + `core.hooksPath`, từ chối `refs/heads/main` | Mọi công cụ trên máy này | Máy khác, bypass có chủ ý |
| 3. Một đường merge | Nút Merge của 5ilence: `gh pr checks` + mergeable rồi squash | Merge khi CI đỏ | Merge trên web |
| 4. Phát hiện sau | Workflow chạy khi push `main`: commit không đi qua PR xanh thì mở issue | Không chặn, nhưng không lọt im lặng | Trễ vài phút |

## Consequences

- Có thêm scheduler, worktree và lease trong Engine. Lease là khái niệm quyền mới, cần thêm vào `security/permissions.md`.
- Commit status được tạo bằng danh tính `gh` của người dùng.
- Máy tắt thì việc sửa dừng, nhưng PR vẫn hiện "offline", không ai bị hiểu nhầm.
- Bảng "Đang chạy" gộp với S4 Background tasks (`frontend/status.md`), không tạo panel riêng.

## Lộ trình

Mỗi bước một PR. Bước 2–3 có giá trị độc lập. Đến hết bước 7 đã chỉ báo được trạng thái (chưa sửa), và đó là bước giải quyết rủi ro chính.

1. `docs`: ADR này + [../pr-watch.md](../pr-watch.md).
2. `feat(risk)`: lớp 1 (`GIT_PUSH_DEFAULT`, `GIT_NO_VERIFY`, `GH_MERGE`) + corpus test + `risk-catalog.md`; lớp 2 (`.githooks/pre-push`).
3. `ci`: lớp 4, workflow `main-guard.yml`. Chỉ xét check/status bắt đầu **trước** lúc PR merge: check chạy sau đó (ví dụ `cache-cleanup` khi PR đóng) không phải CI của PR và từng gây báo động giả (#47, #52).
4. `feat(protocol)`: kiểu Watch, RPC `watch.*`, notification `watch.event`; `PROTOCOL_VERSION` 0.1.20.
5. `feat(engine)`: store watch, RPC, reconcile khi khởi động (chưa poll).
6. `feat(engine)`: monitor `gh`, incident, debounce, commit status `5ilence/watch`.
7. `feat(studio)`: bảng Đang chạy, badge TitleBar, notification desktop, dòng thông tin khi xoá chat; spec `frontend/running.md` + rule.
8. `feat(studio)`: chế độ khay, hộp thoại khi thoát, status "offline" khi thoát.
9. `feat(engine)`: lease trong Risk Engine + audit + `security/permissions.md`.
10. `feat(engine)`: lượt sửa (worktree, brief, ledger, giới hạn, kiểm diff) + eval task "sửa CI đỏ".
11. `feat`: lớp 3 (nút Merge) + sự kiện `checks_passed`.
12. Sau này: nơi chạy cloud (lệnh headless `watch-run`, template workflow, ledger dùng chung).
