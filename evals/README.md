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
| `results/` | Workspace + `audit.jsonl` của lần chạy gần nhất mỗi task, `metrics-<run>.json` | Runner (gitignore; CI upload thành artifact) |

## Cần gì

- Mặc định evals chạy qua **Claude CLI** đã đăng nhập trên máy (`claude` trên PATH, hoặc `SILENCE_CLAUDE_CLI`).
- Chạy qua nguồn khác: `--source company-gateway` (OpenRouter: cần `SILENCE_API_BASE`, `SILENCE_API_KEY`, tài khoản còn credit) hoặc `--source claude-api` (cần `ANTHROPIC_API_KEY`). Đặt `SILENCE_EVAL_SOURCE` để đổi mặc định; CI (`evals.yml`) đặt `company-gateway`.
- `python` trên PATH: `verify_cmd` chạy test của fixture.
- Rust build được `silence-engine`. Trên Windows thiếu SDK thì thay `cargo` bằng `.\scripts\cargo-msvc.bat`.

## Lệnh

Chạy thủ công ở máy local: mọi việc đi qua một lệnh `npm run evals` (`scripts/evals.mjs`). `npm run evals -- --help` in hướng dẫn.

```bash
npm run evals                      # cả v0 + modes, qua Claude CLI, model theo ghim, ghi lịch sử
npm run evals -- --suite modes --only M01-ask-no-edit
npm run evals -- --only E01-edit-add-pow,B06-bugfix-mul --no-history
npm run evals -- --model claude-sonnet   # ép mọi task dùng 1 model (thử nghiệm)
npm run evals -- --source company-gateway --max-cost 0.5
npm run evals -- calibrate         # hiệu chỉnh task chưa ghim của v0 (= npm run evals:calibrate)
npm run evals -- report            # sinh lại history/SUMMARY.md, không gọi model (= npm run evals:report)
```

Trên Windows script gọi `scripts/cargo-msvc.bat`; đặt `SILENCE_CARGO=cargo` nếu muốn dùng `cargo` trực tiếp. Exit code: `1` nếu có suite có FAIL, `2` nếu chỉ có ERROR / dừng sớm.

Option của script:

| Option | Ý nghĩa |
|---|---|
| `--suite v0\|modes\|all` | Bộ task. `run` mặc định `all`, `calibrate` mặc định `v0` |
| `--no-history` | Không ghi `history/` (mặc định có ghi) |

Option chuyển cho Engine (`silence-engine evals`):

| Option | Ý nghĩa |
|---|---|
| `--only a,b` | Chỉ chạy các task này |
| `--model <id>` | Ghi đè model cho mọi task |
| `--source <provider>` | Nguồn chạy: `claude-cli` (mặc định), `company-gateway`, `claude-api`. Cũng có ở `evals-calibrate` |
| `--pinned <id>` | Chỉ chạy task đang ghim model này (lượt Đêm: `claude-haiku`) |
| `--repeat N` | Chạy mỗi task N lần; pass khi cả N lần pass |
| `--retry-failed` | Task trượt được chạy lại 1 lần; lần sau pass thì ghi `flaky` |
| `--max-cost <usd>` | Đạt trần chi thì không bắt đầu task mới (các task còn lại ghi SKIP) |
| `--history` | Ghi 1 dòng vào `history/runs.jsonl` và sinh lại `SUMMARY.md` |
| `--profile <tên>` | Nhãn trong lịch sử: `manual` (mặc định), `nightly`, `weekly` |

## Đọc kết quả

| Trạng thái | Nghĩa | Cần làm |
|---|---|---|
| `PASS` | Agent làm đúng | – |
| `FAIL` | Agent làm sai, quá 180s, hoặc model từ chối | Xem `results/<task>/audit.jsonl` và workspace |
| `ERROR` | Không gọi được model: hết credit, sai key, mạng, rate limit | Sửa hạ tầng. **Không** phải lỗi agent |
| `SKIP` | Thiếu env, task `unsolved`, hoặc đã dừng lượt chạy | – |
| `flaky` | Trượt rồi pass khi chạy lại | Theo dõi. Lặp lại nhiều thì sửa task cho ổn định |

Hết credit hoặc sai key thì runner dừng cả lượt ngay, không đốt thêm task.

Exit code: `1` = có FAIL; `2` = không FAIL nhưng có ERROR hoặc dừng sớm; `0` = sạch.

## Model cho từng task

Thứ tự ưu tiên: `--model` → `model:` trong manifest → `models.yaml` → mặc định `claude-haiku`.

Ghim dùng id trung lập (`claude-haiku`); lúc chạy được map sang biến thể của nguồn (`claude-haiku@cli` khi `--source claude-cli`). Id có `@` (`claude-sonnet@api`) giữ nguyên; `auto` route trong nguồn đó.

- `model:` trong manifest dành cho task cố ý test một nguồn (`claude-sonnet@api`) hoặc router (`auto`). Calibrate không đụng tới các task này.
- Ghim `unsolved` nghĩa là không model nào qua được. Task bị bỏ qua cho tới khi sửa task hoặc harness, rồi hiệu chỉnh lại bằng `--only`.

### Hiệu chỉnh (`evals-calibrate`)

Với mỗi task, runner thử lần lượt Haiku → Sonnet → Opus. Model đầu tiên pass **2 lần liên tiếp** (`--repeat`) được ghim. Một lần trượt là chuyển lên model kế tiếp ngay, để đỡ tốn. Gặp lỗi hạ tầng thì giữ nguyên ghim cũ.

Mặc định chỉ hiệu chỉnh task chưa có trong `models.yaml`. `--only a,b` hoặc `--all` để hiệu chỉnh lại. Trần chi mặc định `--max-cost 5`.

Hiệu chỉnh lại khi:
- đổi model trong `config/models.yaml`;
- thêm task;
- task ghim Haiku trượt 3 đêm liền trong khi harness không đổi.

Sau khi chạy:
1. Xem diff `models.yaml`.
2. Dán các dòng nháp mà calibrate in ra (cũng lưu ở `results/decisions-<run>.md`) vào `DECISIONS.md`.
3. Commit qua PR.

## Lịch chạy và ngân sách (dưới $10/tháng)

| Lượt | Khi nào | Phạm vi | Trần chi |
|---|---|---|---|
| Đêm | CI hằng ngày | `--pinned claude-haiku --retry-failed`; chỉ lưu artifact | $0.30 |
| Tuần | CI Chủ nhật | Đủ bộ theo ghim, `--history`; mở PR lịch sử. Task Model Auto (`A0x`) chạy bước riêng, `--retry-failed`, trần $0.50 | $2.00 |
| Thủ công | Khi sửa vòng agent / harness | `--only` các task liên quan, hoặc đủ bộ | Tự đặt |
| Hiệu chỉnh | Lần đầu và khi đổi model | Task mới hoặc task chỉ định | $5 |

Giá model nằm trong `config/models.yaml`. Chi phí thật của từng lần chạy xem ở `history/SUMMARY.md`. Nếu nhiều task phải ghim Sonnet/Opus và lượt Tuần vượt trần, chuyển lượt Tuần thành hai tuần một lần.

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
