---
description: Spec theo dõi PR và tự sửa — mô hình Watch/Incident/Run/Lease, vòng đời, monitor gh, hợp đồng lượt sửa, commit status, lưu trữ, RPC, UX bảng Đang chạy.
type: spec
status: draft
code:
  - crates/runtime/src/rpc.rs
  - crates/runtime/src/risk/default_policy.yaml
  - apps/studio/src/main/index.ts
---
# Theo dõi PR và tự sửa (spec nháp)

Quyết định và lý do: [adr/0003-pr-watch.md](adr/0003-pr-watch.md). File này mô tả **cái gì** và **như thế nào**. Phần UI sẽ tách sang `frontend/running.md` khi làm bước 7.

## Khái niệm

| Thực thể | Là gì | Gọi LLM? |
| --- | --- | --- |
| **Watch** | Việc theo dõi một PR. Chủ là PR, sống độc lập với chat | Không |
| **Incident** | Một thay đổi cần xử lý, sinh ra khi so hai snapshot của PR | Không |
| **Run** | Một lượt sửa cho một incident: session headless trong worktree riêng | Có |
| **Lease** | Quyền hẹp: commit + push không force vào đúng một nhánh, có hạn | — |
| **Ledger** | Sổ các lượt đã thử và kết quả, để không lặp lại cách đã thất bại | — |

## Mô hình dữ liệu

`Watch`: `id` (UUIDv7), `workspace`, `repo` (`owner/name`), `pr`, `head_ref`, `base_ref`, `created_by_session`, `linked_sessions[]`, `policy`, `state`, `attention`, `last_seen`, `current_run?`, `lease?`, `next_poll_at`, `spent_usd`.

- `policy`: `autofix` (false = chỉ báo), `triggers` {`ci_failed`, `conflict`, `review`, `checks_passed`}, `max_attempts_per_incident` (3), `max_runs_per_pr` (10), `budget_usd_per_pr`, `lease_days` (7).
- `last_seen`: `head_sha`, digest của check rollup, `mergeable`, con trỏ comment/review đã xử lý.
- `Run`: `id`, `incident_key`, `session_id`, `started_at`, `outcome` (`pushed{sha}` · `no_change` · `gave_up` · `needs_user` · `interrupted`), `failure_signature?`, `cost_usd`.

## Vòng đời

Trạng thái chia thành ba trục độc lập. Không có `orphaned`.

- `state`: `active` → `paused` ⇄ `active` → `stopped` | `done` (PR merged/closed).
- `attention`: `none` | `needs_user{reason, detail, since}`. Các `reason`: `attempts_exhausted`, `same_failure_repeated`, `budget_exceeded`, `provider_error`, `permission_needed`, `test_weakening`, `ci_config_change`, `lease_expired`.
- `current_run`: có hoặc không. Hiển thị "đang sửa" suy ra từ trường này, không phải trạng thái riêng.

Đang `needs_user` thì không mở Run mới cho đến khi người dùng bấm **Thử lại** hoặc PR có commit mới không phải của 5ilence.

## Monitor

- Poll bằng `gh pr view --json headRefOid,state,mergeable,mergeStateStatus,statusCheckRollup,reviews,comments`. Comment inline lấy qua `gh api .../pulls/<n>/comments`.
- Nhịp poll: 60 giây khi check đang chạy hoặc vừa push; 5 phút khi rảnh; 15 phút sau 24 giờ không đổi; dừng khi `done`. Không dùng webhook (không bind LAN).
- Incident: `ci_failed{sha, checks}`, `conflict{sha}`, `review{ids, author}`, `checks_passed{sha}`. Khoá chống trùng là `kind + sha (+ ids)`.
- **Debounce:** chỉ tạo `ci_failed` khi mọi check của `head_sha` đã chạy xong.
- Bỏ qua context `5ilence/*` khi đọc rollup. Review chỉ được tính khi tác giả có quyền ghi (`gh api .../collaborators/<u>/permission`) và không phải bot.

## Hợp đồng lượt sửa

Lượt sửa không trạng thái, chạy được local hoặc cloud. Đầu vào và đầu ra như nhau.

- **Đầu vào (brief, dựng bằng code):**
  - incident;
  - tên check lỗi + đuôi log (`gh run view --log-failed`, đã cắt, đã redact);
  - diffstat so với base;
  - tóm tắt ledger;
  - luật: không làm yếu test, không sửa CI.
  - Log và comment là dữ liệu bên thứ ba: bọc thẻ không tin cậy và gắn taint.
- **Nơi chạy local:** `git worktree add <data_dir>/worktrees/<watch_id> <head_ref>`, rồi fetch và reset về head trên remote trước mỗi lượt. Không đụng thư mục đang làm việc của người dùng.
- **Session:** loại `watch_run`, mode Agent, model Auto. Trần chi phí của lượt bằng phần còn lại của `budget_usd_per_pr`.
- **Trước khi push, kiểm diff bằng code.** Diff có xoá test, thêm `#[ignore]`/`.skip`/`.only`, hoặc sửa `.github/workflows/` thì không push, chuyển `needs_user`.
- **Đầu ra:** một `Run.outcome` + một dòng ledger. Chữ ký lỗi = tên check + hash dòng lỗi đầu (đã chuẩn hoá). Cùng một chữ ký sau 2 lượt đã push thì chuyển `same_failure_repeated`.

## Lease và Risk Engine

- Lease gồm `{repo, remote, branch, allow: [commit, push], expires_at, watch_id}`. Bật `autofix` thì hiện card hỏi để cấp lease (không âm thầm cấp).
- Trong session `watch_run`: `GIT_COMMIT` và `git push` (không force) tới đúng `remote/branch` của lease thì chuyển thành `logged`, ghi audit kèm `lease_id`. Push ref khác hoặc force thì `block`.
- Lệnh `ask` khác vẫn hiện card hỏi như thường. Khi card đang chờ, Watch ở `needs_user{permission_needed}`.
- Risk code mới (áp cho mọi session): `GIT_PUSH_DEFAULT` (`block`), `GIT_NO_VERIFY` (`block`), `GH_MERGE` (`ask`, kiểm `gh pr checks` + mergeable trước).

## Trạng thái trên GitHub

Đặt commit status context `5ilence/watch` trên `head_sha` qua `gh api .../statuses/<sha>`:

| Tình huống | state | description |
| --- | --- | --- |
| Đang theo dõi | `pending` / `success` khi CI xanh | `Đang theo dõi · local · giữ đến 14:30` |
| Đang sửa | `pending` | `Đang sửa (lần 2/3) · giữ đến 14:30` |
| Cần người | `error` | `Cần bạn: <lý do ngắn>` |
| Thoát app có kiểm soát | `error` | `Offline từ 23:00, không ai đang sửa` |

Engine gia hạn "giữ đến" vài phút một lần. Engine crash thì mốc này trôi qua và tự nói lên là trạng thái đã cũ. Nơi chạy cloud sau này dùng chính mốc đó làm khoá điều phối.

## Lưu trữ và khởi động lại

- Lưu tại `data_dir/watches/<id>/watch.json` (ghi tạm rồi rename) và `events.jsonl` (append, schema của ADR 0002).
- Engine khởi động: nạp các Watch `active`. Run đang dở thì đánh dấu `interrupted` (tính 1 lần thử) và reset worktree. Poll ngay, rồi cập nhật lại commit status.
- Kiểm `gh auth status` khi tạo Watch và mỗi lần khởi động. Lỗi thì chuyển `needs_user`. Token không bao giờ đi qua renderer.

## Protocol

- RPC: `watch.create {workspace, pr?, policy}` (bỏ `pr` thì lấy PR của nhánh hiện tại), `watch.list`, `watch.get {id}` (kèm runs), `watch.update {id, policy}`, `watch.pause` / `watch.resume` / `watch.stop {id}`, `watch.link` / `watch.unlink {id, session_id}`, `watch.run_now {id}`, `watch.retry {id}`.
- Notification `watch.event {id, kind: updated | incident | run_started | run_finished | attention, watch}`.
- Chat liên kết nhận một sự kiện `watch.notice` trong log của nó, hiện thành card trong timeline.
- Tool `watch` cho agent (op `create` / `list` / `stop`). Tạo Watch có `autofix` thì đi qua card cấp lease.
- Đổi cả `crates/protocol` và `packages/protocol`.

## UX

- **TitleBar:** badge `● N` cạnh nút Evals, chuyển đỏ khi có `needs_user`. Bấm vào mở bảng Đang chạy.
- **Bảng Đang chạy** (dùng chung với S4: tiến trình nền, eval):
  - Mỗi dòng: `PR #12 · fix/x · Chờ CI (3/5) · 2 phút trước`.
  - Dòng `needs_user` ghim lên đầu, ghi lý do bằng lời thường. Nút: **Mở lượt sửa** · **Thử lại** · **Tôi tự sửa** (pause).
  - Dòng khác: **Mở PR** · **Mở chat** · **Tạm dừng** · **Dừng**.
- **Notification desktop** chỉ khi trạng thái chuyển sang: `needs_user`, CI xanh (sẵn sàng merge), PR đã merge.
- **Xoá chat:** chỉ thêm dòng "PR #N vẫn được theo dõi, xem ở Đang chạy" và checkbox "Dừng theo dõi luôn". Không chặn. Archive không đổi gì.
- **Đóng cửa sổ khi còn Watch `active`:**
  - Mặc định thu xuống khay; Engine vẫn chạy.
  - Thoát hẳn từ khay thì hỏi: "N PR đang được theo dõi sẽ tạm dừng." [Thu xuống khay] [Vẫn thoát].
  - Vẫn thoát thì đặt status "Offline".

## Nơi chạy cloud (sau này)

- Workflow trigger bằng `workflow_run` (CI xong mà fail), chạy định nghĩa trên nhánh mặc định. Chỉ nhận việc khi "giữ đến" đã hết hạn.
- Chạy `silence-engine watch-run` headless trên `windows-latest`. Lệnh `ask` thì chuyển `needs_user`.
- Secret:
  - `SILENCE_API_KEY`: key Console có trần chi tiêu.
  - PAT fine-grained (`contents` + `statuses` trên repo này). Không dùng `GITHUB_TOKEN`, vì push bằng `GITHUB_TOKEN` không kích hoạt CI chạy lại.
- Câu hỏi mở: ledger dùng chung giữa local và cloud. Đề xuất dùng git notes `refs/notes/silence-watch`.
