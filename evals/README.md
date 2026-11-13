# Eval 5ilence

Eval là bài kiểm tra định kỳ cho agent: cho Agent thật (gọi model thật) làm một bộ việc cố định, rồi chấm đúng/sai. Nó bảo vệ **chất lượng agent** (test bảo vệ code). Chạy tốn tiền API nên không chạy trong CI thường.

## Bố cục

| Đường dẫn | Là gì | Ai sửa |
|---|---|---|
| `v0/manifest.yaml`, `modes/manifest.yaml` | Định nghĩa task: `prompt`, `pass_if` | Người viết task |
| `v0/models.yaml`, `modes/models.yaml` | Model đã ghim cho từng task | `evals-calibrate` sinh ra, người duyệt qua PR |
| `DECISIONS.md` | Nhật ký: task nào đổi model, vì sao, bằng chứng | Dán dòng nháp từ calibrate |
| `history/runs.jsonl` | Mỗi lần chạy `--history` một dòng: model, pass/fail, token, chi phí, commit | Runner (commit vào repo) |
| `history/SUMMARY.md` | Bảng tổng hợp sinh từ `runs.jsonl` | Runner. **Không sửa tay** |
| `fixtures/` | Repo mẫu mà agent làm việc trên đó | Người viết task |
| `results/` | `<task>/attempt-<n>/` (workspace, `audit.jsonl`, `report.md`) của lần chạy gần nhất mỗi task, đủ mọi lần thử; `metrics-<run>.json` | Runner (gitignore; CI upload thành artifact) |

## Cần gì

- `SILENCE_API_BASE`, `SILENCE_API_KEY` (OpenRouter theo `config/models.yaml`). Tài khoản phải còn credit.
- `python` trên PATH: `verify_cmd` chạy test của fixture.
- Rust build được `silence-engine`. Trên Windows thiếu SDK thì thay `cargo` bằng `.\scripts\cargo-msvc.bat`.

## Lệnh

```bash
npm run evals                      # bộ v0, model theo ghim, ghi lịch sử
npm run evals -- --only E01-edit-add-pow,B06-bugfix-mul
npm run evals -- --model claude-sonnet   # ép mọi task dùng 1 model (thử nghiệm)
npm run evals:calibrate            # hiệu chỉnh task chưa ghim của v0
npm run evals:report               # sinh lại history/SUMMARY.md, không gọi API
cargo run -p silence-engine -- evals --dir evals/modes --repo-root . --history
```

Option của `evals`:

| Option | Ý nghĩa |
|---|---|
| `--only a,b` | Chỉ chạy các task này |
| `--model <id>` | Ghi đè model cho mọi task |
| `--pinned <id>` | Chỉ chạy task đang ghim model này (lượt Đêm: `claude-haiku`) |
| `--repeat N` | Chạy mỗi task N lần; pass khi cả N lần pass |
| `--retry-failed` | Task trượt được chạy lại 1 lần; lần sau pass thì ghi `flaky` |
| `--max-cost <usd>` | Đạt trần chi thì không bắt đầu task mới (các task còn lại ghi SKIP) |
| `--history` | Ghi 1 dòng vào `history/runs.jsonl` và sinh lại `SUMMARY.md` |
| `--profile <tên>` | Nhãn trong lịch sử: `manual` (mặc định), `nightly`, `weekly` |
| `--source <provider>` | Chạy trên một nguồn (xem Chọn source) |
| `--effort <mức>` | Mức suy nghĩ cho mọi task |

## Chạy trong Studio

Settings (Appearance) → **Evals**, mục chỉ hiện khi Studio chạy từ checkout của repo này. Trang này làm được mọi thứ của lệnh `evals` mà không cần nhớ option:
- chọn bộ, chọn từng task (lọc theo loại, theo kết quả lần trước), nguồn, model, mức suy nghĩ, số lần thử, trần chi phí;
- xem **ước tính chi phí** trước khi chạy, rồi xem tiến độ trực tiếp và **Dừng** được giữa chừng;
- **Chạy lại task trượt**, mở **chi tiết task** (báo cáo của agent, file đã đổi so với fixture, audit, thư mục kết quả);
- lưu nhiều cấu hình có đặt tên, **Đặt lại mặc định**.

Mặc định lượt chạy từ Studio không ghi `history/runs.jsonl` (profile `studio`). Spec trang: `docs/frontend/evals.md`.

## Chọn source

`--source <provider>` (CLI) hoặc ô **Nguồn** (Studio) chạy mọi task trên một nguồn: OpenRouter `company-gateway`, Claude API `claude-api`, Claude CLI `claude-cli`.
- Model được **giữ tier, đổi nguồn**: cùng họ model trước (`claude-haiku` → `claude-haiku@api`), không có thì model cùng tier của nguồn đó. Không có cả hai thì task thành SKIP, kèm lý do.
- Task `auto` chạy Auto trong nguồn đã chọn.
- Ghim (`models.yaml`) và hiệu chỉnh vẫn dùng id của OpenRouter; một bộ ghim dùng chung cho mọi nguồn.
- `--effort <level>` đặt mức suy nghĩ cho mọi task (ghi đè `effort` trong manifest).

## Đọc kết quả

| Trạng thái | Nghĩa | Cần làm |
|---|---|---|
| `PASS` | Agent làm đúng | – |
| `FAIL` | Agent làm sai, quá 180s, hoặc model từ chối | Xem `results/<task>/attempt-<n>/` (audit, workspace, report) |
| `ERROR` | Không gọi được model: hết credit, sai key, mạng, rate limit | Sửa hạ tầng. **Không** phải lỗi agent |
| `SKIP` | Thiếu env, task `unsolved`, hoặc đã dừng lượt chạy | – |
| `flaky` | Trượt rồi pass khi chạy lại | Theo dõi. Lặp lại nhiều thì sửa task cho ổn định |

Hết credit hoặc sai key thì runner dừng cả lượt ngay, không đốt thêm task.

Exit code: `1` = có FAIL; `2` = không FAIL nhưng có ERROR hoặc dừng sớm; `0` = sạch.

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

## Lịch chạy và ngân sách

| Lượt | Khi nào | Phạm vi | Trần chi |
|---|---|---|---|
| Đêm | CI hằng ngày | `--pinned claude-haiku --retry-failed`; chỉ lưu artifact | $0.30 |
| Tuần | CI Chủ nhật | Đủ bộ theo ghim, `--history`; mở PR lịch sử. Task Model Auto (`A0x`) chạy bước riêng, `--retry-failed`, trần $0.50 | $2.00 |
| Thủ công | Khi sửa vòng agent / harness | `--only` các task liên quan, hoặc đủ bộ | Tự đặt |
| Hiệu chỉnh | Lần đầu và khi đổi model | Task mới hoặc task chỉ định | $5 |

Cột cuối là **trần** của từng lượt (runner không bắt đầu task mới khi đã chi tới trần), không phải mức chi dự kiến. Tổng trần mỗi tháng khoảng 26 × $0.30 + 4 × $2.00 ≈ **$16**. Khi các task đã ghim đa số Haiku, chi phí thật thấp hơn nhiều: xem `history/SUMMARY.md`. Mục tiêu dưới $10/tháng; nếu vượt thì hạ trần hoặc chuyển lượt Tuần thành hai tuần một lần.

Giá model nằm trong `config/models.yaml`. Gọi model mà provider không trả usage thì runner ước tính token và tính giá theo model đã thực hiện lời gọi đó (task Auto có thể đổi model giữa chừng).

## Thêm task

1. Thêm task vào `manifest.yaml` với `id`, `kind`, `prompt`, `pass_if`. `pass_if` gồm:
   - `grep`: file phải chứa pattern;
   - `test`: chạy test của fixture;
   - `unchanged`: file không được bị sửa;
   - `report_mentions` / `plan_mentions`: câu trả lời phải nhắc tới nội dung;
   - `audit_matches` / `audit_absent`: dòng audit phải có / không được có.
2. Chạy thử: `npm run evals -- --only <id>`.
3. Ghim model: `npm run evals:calibrate -- --only <id>`, rồi ghi `DECISIONS.md`.

Task chạy Model Auto đặt `model: auto`. Thêm task `A0x` mới thì thêm id vào bước "Weekly Auto model" của `evals.yml`; task mode `M0x` mới thì thêm vào bước "Weekly modes" (hai bước dùng `--only` để trần chi không lẫn nhau). Kiểm slot bằng `audit_matches: ['"kind":"route".*"slot":"frontier"']`. Metrics của task có thêm `slots` (slot của các lượt chính), `escalated` và `usd_by_slot`. Xem các task `A0x` trong `modes/manifest.yaml`.

Sửa vòng agent (`crates/runtime/src/agent/`) thì thêm hoặc sửa task tương ứng. Có key thì chạy các task liên quan; không có thì ghi rõ trong PR là chưa chạy.
