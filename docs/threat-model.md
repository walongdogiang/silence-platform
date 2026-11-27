---
description: Mô hình đe doạ cho local agent trên Windows — tài sản, trust boundary, các mối đe doạ và biện pháp giảm thiểu.
type: spec
code:
  - crates/runtime/src/permissions.rs
  - crates/runtime/src/risk/mod.rs
  - crates/runtime/src/bind_policy.rs
  - crates/runtime/src/redact.rs
  - crates/sandbox/src/lib.rs
  - apps/studio/src/preload/index.ts
---
# Threat model — Windows local agent

## Assets

- Source code workspace
- Secrets in `.env`, credential files, clipboard (out of scope v1)
- Model API keys
- MCP server processes
- Audit logs (may contain code snippets)

## Trust boundary

Electron renderer is untrusted. Preload exposes a narrow RPC. Sidecar is trusted for fs/shell but must still ask before mutating. Model is untrusted: tool calls are attacker-controlled.

## Threats and mitigations

- **Prompt injection → RCE:** Risk Engine phân tầng mọi tool call ([security/permissions.md](security/permissions.md)): tải-về-rồi-chạy, lệnh mã hoá, xoá ngoài workspace, đổi hệ thống, gửi secrets và sửa policy file bị **chặn**; mạng, cài package, git huỷ thay đổi, secrets và lệnh không parse được thì **hỏi kèm giải thích**; lượt đã nhận output MCP/mạng (taint) thì shell tầng thấp cũng phải hỏi. Model không hạ được tầng; policy workspace chỉ được siết. MCP không có shell mặc định; allowlist theo workspace, nhớ theo mẫu lệnh (không nhớ cả tool `shell`). Bảng mã: [security/risk-catalog.md](security/risk-catalog.md).
- **Sidecar bind nhầm LAN:** named pipe / 127.0.0.1 only.
- **Process khác trên máy gọi RPC của Engine** (kể cả lệnh trong sandbox: Windows Firewall không lọc loopback): mọi kết nối phải mở đầu bằng `auth.hello {token}`, sai token hoặc thiếu thì Engine trả lỗi `-32001` rồi đóng kết nối (`crates/runtime/src/rpc_auth.rs`). Studio sinh token 256 bit cho mỗi lần spawn và truyền qua `SILENCE_RPC_TOKEN`. Engine đọc rồi xoá biến này khỏi env của chính nó, nên shell, hook và MCP server không thừa hưởng được. Renderer không gọi được `auth.hello` (main chặn) và không bao giờ thấy token. Named pipe có DACL chỉ cho user hiện tại và SYSTEM. Còn hở: token của MCP bridge vẫn nằm trên command line của `mcp-bridge` (process cùng user đọc được).
- **Secret leak lên model:** redaction regex (key, token, password, bearer) trước khi gửi.
- **Log session chứa nội dung file/lệnh:** `sessions/<id>/events.jsonl` nằm trong data_dir của user, redact từng chuỗi trước khi ghi; id session phải là UUID (chặn `../`); không bind mạng, không tự upload.
- **MCP độc:** không auto-trust; user bật từng server; timeout + stdout cap.
- **Process treo / fork bomb:** timeout tool, Job Object kill-on-close, cwd jail.
- **Path escape:** canonicalize + phải nằm trong workspace roots (trừ khi user allow). Shell: đường dẫn trong tham số lệnh ngoài workspace → hỏi (`FS_OUTSIDE_WS`); xoá đệ quy ngoài workspace → chặn (`FS_DELETE_SYSTEM`).
- **Agent tự nới quyền:** ghi `.silence/permissions.json` / `.silence/policy.yaml` bằng tool hoặc shell bị chặn (`POLICY_TAMPER`); chỉ Engine ghi khi user bấm "nhớ".
- **Ảnh (user dán, `view_image`, `fs.read_image`):** chỉ PNG/JPEG/GIF/WebP (SVG chỉ để xem trước ở UI), tối đa 5 MB, cùng jail workspace với `read`. Ảnh đi tới model như nội dung hội thoại: chữ trong ảnh có thể là prompt injection, nên mọi tool ghi vẫn qua `ask` + diff. Base64 ảnh không qua `redact` (secret trong ảnh chụp màn hình vẫn tới provider — user tự chịu khi dán). Renderer chặn ảnh từ xa trong Markdown (kênh rò rỉ), chỉ hiện ảnh workspace qua Engine; SVG chỉ render trong `<img>` (không chạy script).
- **API key model:** nhập ở Settings → Model sources; main process lưu bằng Electron `safeStorage` (DPAPI) trong `userData/credentials.json`, đẩy vào Engine qua RPC loopback `providers.set_credential`. Renderer không gọi được RPC đó (main chặn) và không có IPC nào trả key về: chỉ `has_key` + 4 ký tự cuối. Engine giữ key trong RAM, `Debug` của params che key, lỗi provider đi qua `sanitize`. Key trong biến môi trường vẫn dùng được; key nhập ở Settings thắng biến môi trường.
- **Nguồn Claude API:** code/ngữ cảnh gửi thẳng tới `api.anthropic.com` (không qua OpenRouter). Thinking block (kèm chữ ký) được lưu trong lịch sử session (`claude_content`) để gửi lại nguyên vẹn; bị lọc bỏ khi gửi sang nguồn OpenAI-compatible.
- **Nguồn Claude CLI (thử nghiệm, nội bộ):** CLI chạy với `--tools ""` (tắt tool built-in), `--strict-mcp-config` (chỉ MCP `silence`), `--permission-mode dontAsk`, không bao giờ `bypassPermissions`. MCP `silence` là chính Engine: `silence-engine mcp-bridge` nối stdio của CLI tới listener loopback mở riêng cho lượt đó, dòng đầu phải là token ngẫu nhiên một lượt; mọi `tools/call` qua `dispatch_tool` nên Risk Engine, hỏi quyền, diff và audit giữ nguyên. Không phát hành cho khách đăng nhập bằng tài khoản claude.ai. Settings đọc `claude auth status --json` (không gọi model) để hiện email, gói, cách đăng nhập, hạn đăng nhập; thông tin chỉ hiện trên máy, không ghi log, không gửi đi; đăng nhập bằng gói claude.ai thì thẻ hiện cảnh báo chỉ dùng cá nhân / nội bộ.
- **Kiểm chứng trên máy (`proc_*`, `http_check`, `browser_*`):** tiến trình nền gate như `shell`, sống trong Job Object (dừng / Engine tắt là hạ cả cây); ở chế độ Tự chủ `proc_start` bị từ chối vì tiến trình nền chưa chạy trong sandbox. `http_check` và `browser_open` chỉ tới loopback (`HTTP_NOT_LOCAL` / `BROWSER_NOT_LOCAL` chặn host khác); `http_check` không proxy, redirect ra ngoài bị dừng. Trình duyệt headless là Edge/Chrome có sẵn, profile tạm mới mỗi phiên (không cookie, không extension), xoá khi đóng. Kênh CDP nghe `127.0.0.1` cổng ngẫu nhiên **không xác thực**: tiến trình khác cùng user có thể gắn vào lúc trình duyệt đang mở — chấp nhận vì profile trống và tiến trình đó đã có quyền ngang user; thay bằng `--remote-debugging-pipe` khi có thời gian. Trang rời khỏi máy (link, redirect) → phiên bị taint. Console/log đi qua `redact`.
- **Pane Xem trước (Studio):** trang localhost user tự mở chạy trong `WebContentsView` riêng: `sandbox`, `contextIsolation`, không preload (không có `window.silence`), session `preview` trong RAM (không `persist:`, không chung cookie với UI, mất khi đóng app). Main kiểm lại mọi URL (`isLoopbackUrl`: chỉ http(s) tới `localhost` / `127.0.0.1` / `[::1]`, không user:pass); điều hướng, redirect, `window.open` ra host khác bị chặn trong pane, http(s) thì mở trình duyệt ngoài, scheme khác bị bỏ. Mọi xin quyền (camera, mic, vị trí, thông báo…) bị từ chối, tải file bị huỷ. Còn hở: trang loopback (dev server của user) gửi được request tới cổng loopback khác như mọi trình duyệt; RPC của Engine cần `auth.hello {token}`, còn lõi TS nói qua MessagePort (không mở cổng mạng), nên trang không gọi được.
- **YOLO mode:** không có trong sản phẩm. RPC `session.create` từ chối `yolo`; chỉ `eval_runner` nội bộ dùng. Mặc định là **Cân bằng** (tự chạy tầng 0–1 có hiển thị và audit, không bao giờ im lặng). Tầng 3 bị chặn ở mọi mode, kể cả YOLO của eval.

Control plane / SSO không nằm trong MVP local — không mở attack surface mạng năm 1.
