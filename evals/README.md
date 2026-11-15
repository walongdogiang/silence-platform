# Eval 5ilence

Eval là bài kiểm tra định kỳ cho agent: cho Agent thật (gọi model thật) làm một bộ việc cố định, rồi chấm đúng/sai. Nó bảo vệ **chất lượng agent** (test bảo vệ code). Chạy tốn tiền API nên không chạy trong CI thường.

## Bố cục

| Đường dẫn | Là gì | Ai sửa |
|---|---|---|
| `v0/manifest.yaml`, `modes/manifest.yaml`, `web/manifest.yaml` | Định nghĩa task: `prompt`, `pass_if`. `web/` cần Edge/Chrome/Chromium trên máy và model đọc được ảnh (kiểm chứng bằng trình duyệt và ảnh chụp, fixture `fixtures/web-app`, kiểm bằng `tests/check.py`); chưa có trong `evals.yml`, chạy tay `--dir evals/web` | Người viết task |
| `v0/models.yaml`, `modes/models.yaml` | Model đã ghim cho từng task | `evals-calibrate` sinh ra, người duyệt qua PR |
| `DECISIONS.md` | Nhật ký: task nào đổi model, vì sao, bằng chứng | Dán dòng nháp từ calibrate |
| `history/runs.jsonl` | Mỗi lần chạy `--history` một dòng: model, pass/fail, token, chi phí, commit | Runner (commit vào repo) |
| `history/SUMMARY.md` | Bảng tổng hợp sinh từ `runs.jsonl` | Runner. **Không sửa tay** |
| `fixtures/` | Repo mẫu mà agent làm việc trên đó | Người viết task |
| `results/` | `<task>/attempt-<n>/` (workspace, `audit.jsonl`, `report.md`, `checks.json`, `trace.jsonl`) của lần chạy gần nhất mỗi task, đủ mọi lần thử; `metrics-<run>.json` | Runner (gitignore; CI upload thành artifact) |

## Cần gì

- Thông tin đăng nhập của **nguồn đặt ở `config.yaml`** (xem Cấu hình). Không bắt buộc nguồn nào; trước khi chạy profile, engine kiểm nguồn đó và báo rõ nếu thiếu:
  - OpenRouter `company-gateway`: `SILENCE_API_BASE`, `SILENCE_API_KEY`.
  - Claude API `claude-api`: `ANTHROPIC_API_KEY`.
  - Claude CLI `claude-cli`: lệnh `claude` đã đăng nhập.
  - Tài khoản phải còn credit.
- `python` trên PATH: `verify_cmd` chạy test của fixture.
- Rust build được `silence-engine`. Trên Windows thiếu SDK thì thay `cargo` bằng `.\scripts\cargo-msvc.bat`.

## Lệnh

```bash
npm run evals:smoke                # đang sửa code: chỉ task mà nhánh của bạn ảnh hưởng, mọi bộ
npm run evals:nightly              # như lượt Đêm của CI, trên nguồn của config.yaml
npm run evals:weekly               # như lượt Tuần của CI (ghi lịch sử)
npm run evals                      # bộ v0, ghi lịch sử
npm run evals -- --only E01-edit-add-pow,B06-bugfix-mul
npm run evals -- --source claude-api     # một lần trên nguồn khác, không sửa config
npm run evals -- --source per-task       # mỗi task đúng model ghim (không đổi nguồn)
npm run evals:calibrate            # hiệu chỉnh task chưa ghim của v0 (trên nguồn của config.yaml)
npm run evals:report               # sinh lại history/SUMMARY.md, không gọi API
cargo run -p silence-engine -- evals --dir evals/modes --repo-root . --history
```

Mọi lệnh trên chạy trên nguồn `source` của [`config.yaml`](config.yaml) khi không có `--source`.

Option của `evals`:

| Option | Ý nghĩa |
|---|---|
| `--only a,b` | Chỉ chạy các task này |
| `--model <id>` | Ghi đè model cho mọi task |
| `--pinned <id>` | Chỉ chạy task đang ghim model này (lượt Đêm: `claude-haiku`) |
| `--repeat N` | Chạy mỗi task N lần; pass khi cả N lần pass |
| `--retry-failed` | Task trượt được chạy lại 1 lần; lần sau pass thì ghi `flaky`. Task đã trượt ≥3 lượt liền trong lịch sử thì không chạy lại (task hỏng, không phải flaky) |
| `--max-cost <usd>` | Đạt trần chi thì không bắt đầu task mới (các task còn lại ghi SKIP). Task đang chạy mà chạm trần cũng bị dừng (`ERROR` `EVAL_MAX_COST`) |
| `--rotate` | Task lâu chưa chạy nhất chạy trước (theo lịch sử), để lượt bị cắt bởi trần chi không luôn bỏ cùng phần đuôi |
| `--affected-since <sha>` | Chỉ chạy task mà thay đổi từ commit này có thể ảnh hưởng (`affects.yaml`); không có thì thoát 0, không gọi model |
| `--history` | Ghi 1 dòng vào `history/runs.jsonl` và sinh lại `SUMMARY.md` |
| `--profile <tên>` | Nhãn trong lịch sử: `manual` (mặc định), `nightly`, `weekly` |
| `--source <provider>` | Chạy trên nguồn này thay cho `source` của `config.yaml`; `per-task` = model ghim của từng task (xem Chọn source) |
| `--effort <mức>` | Mức suy nghĩ cho mọi task |

## Chạy trong Studio

Settings → **Giới thiệu** → hàng **Evals** → nút mở trang. Mục chỉ hiện khi Studio chạy từ checkout của repo này. Trang này làm được mọi thứ của lệnh `evals` mà không cần nhớ option:
- chọn bộ, chọn từng task (lọc theo loại, theo kết quả lần trước), nguồn (mặc định **Theo cấu hình**), model, mức suy nghĩ, số lần thử, trần chi phí;
- tab **Cấu hình**: đổi nguồn, trần chi của các profile và CI (ghi `config.yaml`, xem Cấu hình);
- xem **ước tính chi phí** trước khi chạy, rồi xem tiến độ trực tiếp và **Dừng** được giữa chừng;
- **Chạy lại task trượt**, mở **chi tiết task** (báo cáo của agent, file đã đổi so với fixture, audit, thư mục kết quả);
- lưu nhiều cấu hình có đặt tên, **Đặt lại mặc định**.

Mặc định lượt chạy từ Studio không ghi `history/runs.jsonl` (profile `studio`). Spec trang: `docs/frontend/evals.md`.

## Chọn source

Eval không cố định nguồn. Mọi task của một lượt chạy trên một nguồn: OpenRouter `company-gateway`, Claude API `claude-api`, Claude CLI `claude-cli`. Thứ tự: `--source` (CLI) hoặc ô **Nguồn** (Studio) → `source` của `config.yaml`.
- `per-task` (`--source per-task`, hoặc Studio "Model riêng của từng task"): mỗi task chạy đúng id model của nó (id đã ghim hoặc `model:` trong manifest). Các id này thuộc OpenRouter, trừ task ghi rõ nguồn như `claude-sonnet@api`.
- Model được **giữ tier, đổi nguồn**: cùng họ model trước (`claude-haiku` → `claude-haiku@api`), không có thì model cùng tier của nguồn đó. Không có cả hai thì task thành SKIP, kèm lý do.
- Task `auto` chạy Auto trong nguồn đã chọn.
- Ghim (`models.yaml`) và hiệu chỉnh vẫn dùng id của OpenRouter; một bộ ghim dùng chung cho mọi nguồn.
- `--effort <level>` đặt mức suy nghĩ cho mọi task (ghi đè `effort` trong manifest).

## Đọc kết quả

| Trạng thái | Nghĩa | Cần làm |
|---|---|---|
| `PASS` | Agent làm đúng | – |
| `FAIL` | Agent làm sai, quá 180s, vượt `budget` của task, hoặc model từ chối | Xem `checks.json` (check nào trượt, vì sao) và `trace.jsonl` trong `results/<task>/attempt-<n>/`, hoặc tab Checks / Trace trong Studio |
| `ERROR` | Không gọi được model: hết credit, sai key, mạng, rate limit | Sửa hạ tầng. **Không** phải lỗi agent |
| `SKIP` | Thiếu env, task `unsolved`, hoặc đã dừng lượt chạy | – |
| `flaky` | Trượt rồi pass khi chạy lại | Theo dõi. Lặp lại nhiều thì sửa task cho ổn định |

Hết credit hoặc sai key thì runner dừng cả lượt ngay, không đốt thêm task.

Exit code: `1` = có FAIL; `2` = không FAIL nhưng có ERROR hoặc dừng sớm; `0` = sạch.

### File của mỗi lần thử

| File | Nội dung |
|---|---|
| `report.md` | Câu trả lời và plan của agent |
| `audit.jsonl` | Audit của Engine (tool, route, chặn…) |
| `checks.json` | Mỗi điều kiện `pass_if` một dòng `{kind, target, ok, detail}`. Mọi check đều chạy, kể cả khi đã có check trượt, nên `detail` liệt kê đủ lý do. Lượt chạy không xong thì có thêm check `run` |
| `trace.jsonl` | Mỗi `SessionEvent` một dòng (cùng tag `type` như protocol) kèm `t_ms`. Token liên tiếp gộp thành `text`. Mỗi chuỗi tối đa 16 KB và đã qua `redact`; cả file tối đa 2 MB |
| `workspace/` | Bản sao fixture sau khi agent làm |

## Model cho từng task

Thứ tự ưu tiên: `--model` → `model:` trong manifest → `models.yaml` → mặc định `claude-haiku`.

Mặc định là `claude-haiku` chứ không phải `auto`: mỗi task chạy trên một model cố định để kết quả và chi phí so sánh được giữa các lần. Vì vậy **Model Auto chỉ được kiểm bởi các task `A0x`** (đặt `model: auto` trong `modes/manifest.yaml`).

- `model:` trong manifest dành cho task cố ý test một nguồn (`claude-sonnet@api`) hoặc router (`auto`). Calibrate không đụng tới các task này.
- Ghim `unsolved` nghĩa là không model nào qua được. Task bị bỏ qua cho tới khi sửa task hoặc harness, rồi hiệu chỉnh lại bằng `--only`.

### Hiệu chỉnh (`evals-calibrate`)

Với mỗi task, runner thử lần lượt Haiku → Sonnet → Opus. Model đầu tiên pass **2 lần liên tiếp** (`--repeat`) được ghim. Một lần trượt là chuyển lên model kế tiếp ngay, để đỡ tốn. Gặp lỗi hạ tầng thì giữ nguyên ghim cũ.

**Hiệu chỉnh một lần trước khi bật lịch CI.** Khi chưa có `models.yaml`, mọi task chạy Haiku; lượt Đêm chạy cả bộ v0 và có thể chạm trần giữa chừng (các task còn lại thành SKIP).

Mặc định chỉ hiệu chỉnh task chưa có trong `models.yaml`. `--only a,b` hoặc `--all` để hiệu chỉnh lại. Trần chi mặc định `--max-cost 5`.

Hiệu chỉnh lại khi:
- đổi model trong `config/models.yaml`;
- thêm task;
- task ghim Haiku trượt 3 đêm liền trong khi harness không đổi.

Sau khi chạy:
1. Xem diff `models.yaml`.
2. Dán các dòng nháp mà calibrate in ra (cũng lưu ở `results/decisions-<run>.md`) vào `DECISIONS.md`.
3. Commit qua PR.

## Cấu hình (`config.yaml`)

Một file, một chỗ đổi nguồn: [`config.yaml`](config.yaml). Sửa ở Studio (**Evals → tab Cấu hình**) hoặc sửa tay. Engine kiểm file trước khi dùng (`eval_config.rs`).

```yaml
source: claude-cli          # nguồn khi chạy trên máy: claude-cli | claude-api | company-gateway | per-task
profiles:                   # trần chi; các bước của profile giống nhau trên máy và trên CI
  smoke:   { max_cost: 0.5 }
  nightly: { max_cost: 0.3 }
  weekly:  { v0_max_cost: 1.2, modes_max_cost: 0.3, auto_max_cost: 0.5 }
ci:                         # GitHub Actions
  enabled: false            # tắt cho tới khi có khoá của nguồn CI
  source: claude-api        # không nhận claude-cli (runner của GitHub không đăng nhập được)
  nightly: true
  weekly: true
```

| Profile | Lệnh | Chạy gì |
|---|---|---|
| `smoke` | `npm run evals:smoke` | Mọi bộ (v0, modes, web), chỉ task mà thay đổi của nhánh (đã và chưa commit, so với `origin/main`) có thể ảnh hưởng (`affects.yaml`). Một ngân sách chung. Dùng khi đang sửa code |
| `nightly` | `npm run evals:nightly` | Task v0 ghim Haiku, `--retry-failed --rotate`. Trên CI thêm `--affected-since` lượt thành công gần nhất |
| `weekly` | `npm run evals:weekly` | Cả v0, task `M..`, task `A..`, mỗi bước một trần, ghi lịch sử |

Các bước nằm ở `eval_config.rs::steps`, dùng chung cho `npm run` và workflow (`evals-profile --ci`). Thêm task `M..`/`A..` mới thì tự vào lượt Tuần, không phải sửa workflow.

**Trước khi gọi model**, `evals-profile` kiểm nguồn: có khoá chưa, hoặc Claude CLI đã cài và đã đăng nhập chưa. Chưa thì dừng với lời nhắn (exit `3`), không task nào chạy.

### Chuyển nguồn

- **Hôm nay (chỉ có Claude CLI):** `source: claude-cli`; chạy tay `npm run evals:smoke` khi sửa code, `evals:nightly` / `evals:weekly` khi muốn. CI tắt: workflow vẫn thức dậy theo lịch nhưng dừng ngay, job xanh, không gọi model.
- **Có OpenRouter / Claude API:** đổi `source` (Studio → Cấu hình → Nguồn khi chạy trên máy). Muốn CI tự chạy: đặt secret khoá ở GitHub → repo Settings → Secrets and variables → Actions (`SILENCE_API_KEY` + `SILENCE_API_BASE` cho OpenRouter, `ANTHROPIC_API_KEY` cho Claude API), rồi bật `ci.enabled` và chọn `ci.source`; commit qua PR. Thiếu secret thì bước kiểm của job đỏ với lời nhắn rõ, trước khi gọi model.
- **Bấm Run workflow** trên GitHub có ô **source** để chạy một lần trên nguồn khác mà không sửa file.
- Đổi nguồn thì history trộn nguồn (cột `model` ghi `claude-haiku@cli`, `claude-haiku@api`…); task vẫn **giữ họ/tier model rồi đổi nguồn** (xem Chọn source). Ghim trong `models.yaml` dùng id gốc nên dùng chung cho mọi nguồn.
- Claude CLI tính chi phí theo số `total_cost_usd` mà CLI báo (quy đổi, không phải tiền thật trên gói thuê bao); trần chi vẫn áp dụng như với nguồn khác.

## Lịch chạy và ngân sách

| Lượt | Khi nào | Phạm vi | Trần chi |
|---|---|---|---|
| Smoke | Khi sửa vòng agent / harness, trên máy | `npm run evals:smoke`: task bị ảnh hưởng bởi nhánh | $0.50 |
| Đêm | CI hằng ngày (khi `ci.enabled`), hoặc `npm run evals:nightly` | Profile `nightly`; trên CI chỉ task bị ảnh hưởng từ lượt thành công gần nhất, đêm không có commit liên quan thì không gọi model. Chỉ lưu artifact | $0.30 |
| Tuần | CI Chủ nhật (khi `ci.enabled`), hoặc `npm run evals:weekly` | Profile `weekly`: đủ v0, task `M..`, task `A..` (`--retry-failed`, trần $0.50), `--history`; trên CI mở PR lịch sử | $2.00 |
| Hiệu chỉnh | Lần đầu và khi đổi model | Task mới hoặc task chỉ định | $5 |

Trần lấy từ `config.yaml` (cột cuối là mặc định). Cột cuối là **trần** của từng lượt (runner không bắt đầu task mới khi đã chi tới trần), không phải mức chi dự kiến. Tổng trần mỗi tháng khoảng 26 × $0.30 + 4 × $2.00 ≈ **$16**. Khi các task đã ghim đa số Haiku, chi phí thật thấp hơn nhiều: xem `history/SUMMARY.md`. Mục tiêu dưới $10/tháng; nếu vượt thì hạ trần hoặc chuyển lượt Tuần thành hai tuần một lần.

### Tiết kiệm token

Cách làm theo Claude Code, Codex và Cursor:
- **Prompt cache.** Prefix gửi đi giữ ổn định: system tĩnh (base + mode + style), rồi khối "Runtime environment" thành system message riêng, rồi lịch sử (`agent/env.rs`). Breakpoint đặt ở system tĩnh, khối env và message cuối, cho cả Claude API lẫn OpenRouter `anthropic/*`. Tool MCP được sắp xếp. Compaction nén xuống 50% để không viết lại lịch sử ở mỗi call. Cột **cache** (console, Studio) và **Cache** (`SUMMARY.md`) là tỉ lệ token input lấy từ cache. Cache hit tụt mạnh sau một thay đổi thì có thứ đang phá prefix (thời gian, thứ tự tool, sửa message cũ).
- **Chọn task theo thay đổi.** `affects.yaml` map đường dẫn sang tiền tố id task. Thêm file hoặc thư mục mới vào vòng agent thì kiểm rule; file không khớp rule nào thì không kích hoạt eval.
- **`budget` theo task** (xem Thêm task): task pass nhưng tốn gấp mấy lần số bước cũng là hồi quy.

Giá model nằm trong `config/models.yaml`. Gọi model mà provider không trả usage thì runner ước tính token và tính giá theo model đã thực hiện lời gọi đó (task Auto có thể đổi model giữa chừng).

## Thêm task

1. Thêm task vào `manifest.yaml` với `id`, `kind`, `prompt`, `pass_if`. `pass_if` gồm:
   - `grep`: file phải chứa pattern;
   - `test`: chạy test của fixture;
   - `unchanged`: file không được bị sửa;
   - `report_mentions` / `plan_mentions`: câu trả lời phải nhắc tới nội dung;
   - `max_report_chars`: câu trả lời không dài quá số ký tự này;
   - `report_lang` (`vi` | `en`): câu trả lời phải viết bằng ngôn ngữ đó (đọc bằng `lang::detect`);
   - `audit_matches` / `audit_absent`: dòng audit phải có / không được có.

   Tuỳ chọn `budget` (cùng cấp với `pass_if`): `max_turns` (số lần gọi model) và `max_input_tokens`. Vượt thì lần thử bị dừng ngay và FAIL. Đặt khoảng 2× số liệu thật trong `history/` hoặc metrics.
2. Chạy thử: `npm run evals -- --only <id>`.
3. Ghim model: `npm run evals:calibrate -- --only <id>`, rồi ghi `DECISIONS.md`.

Task chạy Model Auto đặt `model: auto`. Task `A..` và `M..` mới tự vào lượt Tuần (bước lọc theo tiền tố id, trần chi riêng từng bước: `eval_config.rs::steps`). Kiểm slot bằng `audit_matches: ['"kind":"route".*"slot":"frontier"']`. Metrics của task có thêm `slots` (slot của các lượt chính), `escalated` và `usd_by_slot`. Xem các task `A0x` trong `modes/manifest.yaml`.

Sửa vòng agent (`crates/runtime/src/agent/`) thì thêm hoặc sửa task tương ứng. Có key thì chạy các task liên quan; không có thì ghi rõ trong PR là chưa chạy.

## Suite `sandbox` (chế độ Tự chủ)

`evals/sandbox/manifest.yaml`, fixture `fixtures/node-mini`. Task đặt `permission: autonomous` và `requires_sandbox: true`: máy chưa cài sandbox (`silence-engine sandbox status` ≠ ready) thì task bị **SKIP**, không FAIL. Suite này không chạy trên CI (runner không có user sandbox): chạy tay trên máy đã cài. `on_ask: approve|deny` (mặc định deny) là câu trả lời cho mọi thẻ hỏi quyền; mỗi thẻ được ghi vào `audit.jsonl` thành dòng `"kind":"eval.asked"` kèm `codes`, `hosts`, `escalation`, nên `audit_matches` / `audit_absent` dùng được để bắt buộc hoặc cấm thẻ. Task `S01…S04`: `npm install && npm test` không hỏi; `git push` vẫn hỏi; domain lạ hỏi kèm host; bị sandbox chặn thì tự đổi cách mà không lên thẻ leo thang.

```powershell
cargo run -p silence-engine -- evals --dir evals/sandbox --repo-root . --history
```
