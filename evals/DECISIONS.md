# Nhật ký ghim model cho eval

Mỗi lần một task đổi model ghim (trong `<bộ>/models.yaml`) thì thêm một dòng vào **cuối** bảng. Không sửa hay xoá dòng cũ.

- **Lý do:** kết quả hiệu chỉnh, ví dụ `claude-haiku 0/1, claude-sonnet 2/2`. Ghim tay thì ghi lý do bằng lời.
- **Bằng chứng:** `run_id` của lần hiệu chỉnh. Số liệu ở `history/runs.jsonl`; workspace + audit trong artifact CI hoặc `results/` của máy đã chạy.
- `npm run evals:calibrate` in sẵn các dòng nháp và lưu ở `results/decisions-<run_id>.md`.

Cách dùng: `README.md` → Model cho từng task.

| Ngày | Bộ | Task | Model cũ → mới | Lý do | Run |
|---|---|---|---|---|---|
