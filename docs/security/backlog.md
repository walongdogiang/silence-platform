---
description: Việc bảo mật/quyền cố ý chưa làm — duyệt trước theo plan, nhóm deploy trong catalog, allowlist domain, sandbox mạng, policy workspace, model phân loại; mỗi mục có lý do hoãn và điều kiện để làm.
type: roadmap
---
# Backlog bảo mật và quyền

Các việc đã bàn nhưng **cố ý chưa làm**. Đừng làm sớm; mở lại khi điều kiện ở cột "Làm khi" đã đủ. Bối cảnh: [permissions.md](permissions.md), [risk-catalog.md](risk-catalog.md).

| Mục | Vì sao chưa làm | Làm khi | Ghi chú thiết kế |
| --- | --- | --- | --- |
| **Duyệt trước theo plan** | Plan hiện chỉ là Markdown (`submit_plan{markdown}`), chưa có danh sách hành động có cấu trúc. Đoán trước lệnh agent sẽ chạy thì đoán sai nhiều. | Làm S3 ([status.md](../frontend/status.md)): sửa `submit_plan` và nút duyệt plan 4 lựa chọn. | `submit_plan` thêm trường `expected_actions: [{tool, pattern, why}]`. Card duyệt plan liệt kê các hành động tầng 2 dự kiến; duyệt plan = cấp `scope: session` cho đúng các mẫu đó (không rộng hơn). Hành động ngoài danh sách vẫn hỏi. Đổi schema tool nên kèm eval. |
| **Nhóm deploy / hạ tầng** (`DEPLOY_INFRA`) | Chưa có lỗ hổng: `kubectl`, `terraform`, `docker push`… hiện rơi vào `UNKNOWN_COMMAND` (ask), vẫn **hỏi**, chỉ là lý do hiển thị chưa đúng tên. | Trước khi mở chế độ `autonomous`, hoặc khi có người dùng agent chạm hạ tầng. | Mã mới `DEPLOY_INFRA` (tầng `ask`, nằm trong `never_remember`): `kubectl apply/delete/rollout`, `terraform apply/destroy`, `helm install/upgrade/uninstall`, `docker push`, `docker compose up` có `--build`, `vercel --prod`, `netlify deploy --prod`, `gh release create`, `gcloud/aws/az … delete/deploy`. Thêm ca vào `corpus.yaml` **cả khi đi qua `npx`/script** (kiểm tra chúng không rơi xuống `PKG_EXEC`/`RUN_SCRIPT` ở tầng thấp hơn). |
| **Allowlist domain cho `NET_ACCESS`** | Chưa có nhu cầu đủ lớn; mỗi lần `curl` GET đều hỏi là chấp nhận được. | Khi người dùng phàn nàn vì hỏi `curl`/`iwr` GET quá nhiều. | Domain allowlist theo workspace (`api.github.com`, docs nội bộ), **chỉ** cho GET không kèm `-d/--data/-F/-T`; không bao giờ cho pipeline vào interpreter (vẫn `NET_DOWNLOAD_EXEC`). Domain mới vẫn hỏi. |
| **Sandbox chặn mạng trên Windows** | Phase 1 (RPC token), Phase 2 (user sandbox, chặn ghi ngoài workspace) và Phase 3 (firewall theo user + proxy allowlist) đã xong; xem [permissions.md](permissions.md) → Sandbox Windows. **Còn Phase 4: nối vào agent** (shell chạy trong sandbox, `NetEvent` vào audit, domain lạ thì hỏi, cache `status()`). | Trước khi bật `autonomous` hoặc đổi mặc định sang tự chủ. | Spike Phase 0 cho thấy AppContainer không cần thiết. Phase 3 đổi token sang deny-only, vì token có restricting SID làm hỏng Schannel. Lỗ hở còn lại đã ghi ở permissions.md: kênh DNS, thư mục con nhóm Users ghi được, host nhận upload trong allowlist. Lệnh cần mạng chạy ngoài sandbox qua card hỏi như hiện nay. Sandbox xong thì `BUILD_TEST` mới thật sự offline và `PKG_INSTALL` mới có thể tự chạy với `--ignore-scripts`. Bước sau: allowlist domain cho registry của package manager, chỉ áp dụng trong sandbox (giống Cursor "sandbox.json + Defaults"), để `npm install` không phải hỏi. Đây là lợi thế thật: Codex có sandbox Windows gốc, còn tài liệu Cursor và VS Code chưa ghi hỗ trợ Windows. |
| **Chế độ Tự chủ (`autonomous`)** | Phụ thuộc sandbox mạng. Hiện chạy y như Cân bằng, nên Settings để mục này **tắt** để không gây hiểu nhầm. | Sau sandbox mạng. | Tầng 2 tự chạy **chỉ** khi lệnh nằm trong sandbox; tầng 3 vẫn chặn; `never_remember` vẫn hỏi. |
| **Policy theo workspace** (`.silence/policy.yaml`) | Chưa có nhu cầu; luật mặc định đủ dùng. | Khi một team muốn siết hoặc bổ sung luật riêng. | Chỉ được **siết** (thêm ask/block, thêm secret pattern), không hạ được mã tầng 3. File này nằm trong `policy_files` nên agent không ghi được. |
| **Model phân loại cho vùng xám** | Luật cứng đủ cho giai đoạn này; thêm một lần gọi model làm chậm và tốn tiền. | Khi tỉ lệ `UNKNOWN_COMMAND` hỏi quá cao trong audit. | Một lần gọi riêng, model rẻ, chỉ thấy hành động và yêu cầu gốc của user. **Chỉ được nâng tầng**; lỗi, hết giờ hoặc không chắc thì hỏi. |
| **Hook `beforeShell` có quyền chặn** | `org::run_hook` hiện bỏ qua kết quả. | Khi team cần luật riêng bằng script. | Exit code ≠ 0 thì coi như chặn (tầng 3, mã `HOOK_BLOCK`). Hook chỉ được siết, không được hạ tầng. |
| **Hoàn tác cho lệnh shell** | `edit`/`write` có checkpoint; lệnh shell thì không. | Nếu cho shell ghi file nhiều hơn. | Snapshot các file bị thay đổi (git stash hoặc copy) trước lệnh tầng 1 ghi file. |

## Quyết định không làm

| Mục | Vì sao | Nếu sau này cần |
| --- | --- | --- |
| **"Allow bypass permissions" / YOLO trong sản phẩm** | Trái nguyên tắc "không silent YOLO". Không chống prompt injection, và chỉ an toàn khi môi trường đã được cô lập từ bên ngoài. Doanh nghiệp thường tắt chế độ này bằng policy. `autonomous` có sandbox cho tốc độ gần bằng mà vẫn giữ tầng 3, audit và Hoàn tác. | Chỉ cho Engine chạy headless (CI, container), bắt buộc có cờ khi khởi động, **không** mở qua RPC từ Studio, có policy để tắt; tầng 3 và audit giữ nguyên. Phải sửa AGENTS.md trước. |

## Đã làm (để khỏi lặp)

- Phân 4 tầng, Risk Engine, corpus, catalog-sync (B2).
- Gắn vào Engine, nhớ theo mẫu lệnh, taint, DiffCard "Hoàn tác" (B3).
- Cho phép trong phiên (`scope: session`), Stop tự Từ chối, chọn chế độ trong Settings, badge tầng, bước "Đã chặn", thông báo desktop (B4).
