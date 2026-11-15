# Eval: tổng hợp

> Sinh tự động từ `runs.jsonl` bởi `npm run evals:report` (và mỗi lần chạy `--history`). Không sửa tay.

Đến lần chạy `20261115-092252`: 8 lần chạy, tổng chi $0.05.

## Chi phí theo tháng

| Tháng | Lần chạy | Chi (USD) |
|---|---:|---:|
| 2026-11 | 8 | 0.05 |

## Trạng thái từng task

10 lần gần nhất, mới nhất bên phải: ✓ pass · ✗ fail · ⚠ lỗi hạ tầng · ~ flaky · – bỏ qua. Không tính lượt hiệu chỉnh. Tỉ lệ pass bỏ qua ⚠ và –.

| Bộ | Task | Model gần nhất | Lịch sử | Pass |
|---|---|---|---|---:|
| v0 | V01-verify-background-server | claude-haiku | ✓✗✓✓ | 3/4 |
| v0 | V02-verify-http-check | claude-haiku | ✗✓✓ | 2/3 |
| web | W01-browser-finds-client-error | claude-haiku | ✓✗✓✓ | 3/4 |
| web | W02-browser-screenshot-visual-bug | claude-haiku | ✓✓✓ | 3/3 |
| web | W03-browser-flow-to-playwright-test | claude-haiku | ✓ | 1/1 |

## 10 lần chạy gần nhất

| Run | Bộ | Profile | Commit | ✓ | ✗ | ⚠ | – | Chi (USD) | Cache | Dừng sớm |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---|
| 20261115-092252 | web | manual | da8e686 | 3 | 0 | 0 | 0 | 0.0076 | 89% |  |
| 20261115-090322 | web | manual | da8e686 | 2 | 0 | 0 | 0 | 0.0050 | 86% |  |
| 20261115-085615 | web | manual | da8e686 | 1 | 1 | 0 | 0 | 0.0089 | 89% |  |
| 20261115-084317 | web | manual | da8e686 | 1 | 0 | 0 | 0 | 0.0108 | 0% |  |
| 20261115-084304 | v0 | manual | da8e686 | 2 | 0 | 0 | 0 | 0.0052 | 0% |  |
| 20261115-080108 | v0 | manual | da8e686 | 2 | 0 | 0 | 0 | 0.0047 | 0% |  |
| 20261115-073939 | v0 | manual | da8e686 | 0 | 2 | 0 | 0 | 0.0046 | 0% |  |
| 20261115-071901 | v0 | manual | da8e686 | 1 | 0 | 0 | 0 | 0.0018 | 0% |  |
