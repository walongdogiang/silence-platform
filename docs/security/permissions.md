---
description: Spec quyền của agent — 4 tầng rủi ro (auto/logged/ask/block), chế độ Thận trọng/Cân bằng/Tự chủ, Risk Engine, taint, nhớ quyền theo mẫu, card hỏi, nạp hướng dẫn cho AI, lộ trình B0–B4.
type: spec
code:
  - crates/runtime/src/risk/mod.rs
  - crates/runtime/src/risk/command.rs
  - crates/runtime/src/agent/policy.rs
  - crates/runtime/src/permissions.rs
  - crates/runtime/src/rpc.rs
---
# Quyền của agent (permissions)

Bảng tra lệnh cụ thể: [risk-catalog.md](risk-catalog.md). Mối đe doạ: [threat-model.md](../threat-model.md).

## Nguyên tắc

> **Mặc định Cân bằng:** tự chạy những gì an toàn hoặc đảo ngược được, và luôn hiển thị; hành động rủi ro thì `ask` kèm giải thích; hành động nguy hiểm thì chặn. **Không bao giờ im lặng**: mọi hành động tự chạy đều hiện thành một bước trong chat và được ghi audit.

Vấn đề cần giải: hỏi mọi thứ thì agent phải dừng liên tục và user phải ngồi canh; YOLO thì một prompt injection (ví dụ README chứa `iwr … | iex`) là đủ chiếm máy. Giải pháp là phân loại theo rủi ro, **do code trong Engine quyết định**, không dựa vào việc model tự giác.

> **Trạng thái:** B0–B4 đã xong. Mọi tool call (trừ thao tác nội bộ) đi qua `agent/policy.rs::gate` → `risk::classify`. Studio tạo session theo chế độ đã chọn trong Settings (mặc định `balanced`) và đồng bộ lại trước mỗi lượt, nên session cũ khi resume cũng theo Settings. Việc cố ý để sau: [backlog.md](backlog.md).

## Tham khảo

Đối chiếu tài liệu chính thức, 11/2026:

| | Claude Code | Cursor | Codex | VS Code / Copilot | 5ilence |
| --- | --- | --- | --- | --- | --- |
| Phân tầng | auto mode: classifier xét từng hành động | Auto-review (mặc định): allowlist, sandbox, rồi classifier | sandbox mode + approval policy | mức duyệt: Default / Bypass / Autopilot | Luật cứng 4 tầng; classifier cho vùng xám là việc sau |
| Sandbox | khuyên chạy bypass trong container/VM | chặn mạng mặc định, ghi trong workspace; macOS + Linux | `workspace-write`, tắt mạng mặc định; có Windows gốc | độc lập với mức duyệt; macOS, Linux, WSL2 | Job Object (đã có); chặn mạng (sau) |
| Nhớ quyền | theo mẫu `Bash(npm test:*)` | allowlist lệnh | — | auto-approve theo lệnh | theo mẫu lệnh (B3) |
| Chặn cứng | deny rules, hook PreToolUse | file-deletion / external-file protection | — | — | Tầng 3 trong Engine |
| Chế độ bỏ qua hết | `bypassPermissions`, công tắc "Allow bypass permissions mode"; admin tắt bằng `disableBypassPermissionsMode` | Run Everything (không sandbox, không classifier) | `--yolo` = `danger-full-access` + `never`, "not recommended" | Bypass Approvals / Autopilot | **Không có.** `yolo` chỉ dùng trong `eval_runner` |

Điểm chung: chế độ bỏ qua hết luôn có, nhưng không bên nào đặt làm mặc định, kèm cảnh báo "chỉ dùng trong container/VM", và admin tắt được. Hướng đầu tư là **tự chạy trong ranh giới sandbox**, cũng là hướng của `autonomous`. Lý do không thêm bypass: [backlog.md](backlog.md).

## 4 tầng

| Tầng | Tên | Ý nghĩa | Ví dụ |
| --- | --- | --- | --- |
| 0 | `auto` | Chỉ đọc trong workspace | `read`, `grep`, `git status`, `ls`, `--version` |
| 1 | `logged` | Thay đổi nhưng đảo ngược được hoặc nằm trong workspace | `edit` (có checkpoint), `cargo test`, `npm test`, `python calc.py`, `git add` |
| 2 | `ask` | Rủi ro: mạng, ngoài workspace, mất dữ liệu, secrets, không rõ | `npm install`, `git push`, `git reset --hard`, `cat .env`, `python -c` |
| 3 | `block` | Nguy hiểm hoặc là dấu hiệu tấn công | `curl … \| sh`, `-EncodedCommand`, `rm -rf /`, `reg add HKLM`, gửi `.env` ra mạng |

Danh sách đầy đủ theo mã: [risk-catalog.md](risk-catalog.md).

## Chế độ (PermissionMode)

| Mode | Nhãn UI | T0 | T1 | T2 | T3 |
| --- | --- | --- | --- | --- | --- |
| `ask` | Thận trọng | tự | hỏi | hỏi | chặn |
| `balanced` | **Cân bằng (mặc định)** | tự | tự + audit | hỏi | chặn |
| `autonomous` | Tự chủ | tự | tự + audit | tự **chỉ khi** lệnh chạy trong sandbox chặn mạng; chưa có sandbox thì hỏi | chặn |
| `yolo` | — | Chỉ `eval_runner` tạo trong process. **RPC `session.create` từ chối** (B0) | | | |

`allowlist` (mode cũ) được giữ để tương thích, so khớp giống `ask` (B0 đã sửa lỗi so khớp tiền tố JSON).

## Risk Engine

`risk::classify(tool, args, RiskCtx{workspace, tainted, mcp_read_only}) -> Verdict{tier, codes}` trong `crates/runtime/src/risk/`. Thuần, đồng bộ, không I/O ngoài tính toán đường dẫn.

```mermaid
flowchart LR
  TC[tool call] --> K{tool}
  K -- shell --> P[parse: tách đoạn, quote, $( ), redirect]
  P --> S[mỗi đoạn: alias → tên gốc, bóc sudo, luật YAML, interpreter]
  S --> X[ghép: pipe tải-về→sink, encoded, secrets+mạng]
  K -- read/edit/write --> PA[đường dẫn: workspace / secrets / policy file]
  K -- mcp__* --> M[MCP_CALL hoặc MCP_READ]
  X --> V[Verdict = tầng cao nhất + mã lý do]
  PA --> V
  M --> V
  V --> T{tainted?}
  T -- có, tầng < 2 --> R[+ TAINTED_CONTEXT → ask]
```

Quy tắc (bảo thủ):

1. **Chỉ nâng, không hạ.** Tầng của dòng lệnh là tầng cao nhất của các đoạn. Chương trình hoặc tool không có trong policy → `ask`.
2. **Không parse được thì hỏi.** Gặp `$(…)`, backtick subshell, process substitution, quote không đóng → `UNPARSED`.
3. **Đường dẫn:** mọi tham số trông như đường dẫn đều được chuẩn hoá lexical theo workspace. Ngoài workspace → `FS_OUTSIDE_WS`. Xoá đệ quy ngoài workspace → `FS_DELETE_SYSTEM` (chặn). Secrets → `SECRET_READ`. Ghi policy file → `POLICY_TAMPER` (chặn).
4. **Tải về rồi chạy:** downloader (`curl`, `iwr`, `irm`, `Net.WebClient`) nối pipe vào một sink đọc stdin (`sh`, `bash -s`, `iex`, `python` không đối số…), hoặc `iex` đi kèm downloader → `NET_DOWNLOAD_EXEC`.
5. **Taint:** khi phiên đã nhận output từ MCP hoặc nội dung tải từ mạng (`curl`, `iwr`; mã trong `taint_codes`), shell tầng 0–1 được nâng lên `ask` (`TAINTED_CONTEXT`). Prompt injection thường đến qua đúng các kênh này. Taint giữ **cho cả phiên**, vì nội dung đó vẫn nằm trong lịch sử; resume tính lại từ lịch sử. Log của `npm install`/`git pull` không gây taint.
6. **Giải thích không do model viết:** `title`/`detail` (tiếng Việt, cho user) và `hint` (tiếng Anh, cho model) là văn bản cố định trong `default_policy.yaml`.

Policy theo workspace `.silence/policy.yaml` (B3) chỉ được **siết**: thêm luật ask/block, không hạ được tầng 3. Engine là nơi duy nhất ghi `.silence/permissions.json`.

## Gắn vào Engine (B3)

```mermaid
sequenceDiagram
  participant M as Model
  participant D as dispatch_tool
  participant G as policy::gate
  participant R as risk::classify
  participant U as Studio
  M->>D: tool call
  D->>G: name, args
  G->>R: classify (workspace, tainted, mcp_read_only)
  R-->>G: Verdict{tier, codes}
  alt tier 3
    G-->>D: Blocked → ToolEnd(ok=false) + audit tool.blocked
    D-->>M: "blocked by policy (CODE): hint"
  else mode không hỏi tầng này / allowlist khớp
    G-->>D: Run
  else hỏi
    G->>U: Permission{reason, risk{tier, reasons, pattern}}
    U-->>G: allow / deny (+ remember)
    G-->>D: Run / Denied ("permission denied by user")
  end
  D->>D: chạy tool; audit tool {tier, codes}; taint nếu MCP/mạng
```

- `write`/`edit`: mode `ask`/`allowlist` vẫn **stage** chờ Apply. `balanced`/`autonomous` **ghi luôn**, event `diff{applied:true}`; DiffCard hiện "Đã áp dụng · Hoàn tác" (Hoàn tác ghi lại `before`, cùng đường với Restore checkpoint).
- Nhớ quyền: entry `shell:<mẫu>` (vd `shell:npm install *`) chỉ khớp **một lệnh đơn** cùng chương trình và lệnh con; pipeline, chuỗi lệnh, redirect, cú pháp động không bao giờ được nhớ. Entry cũ `shell` (cả tool) bị bỏ khi nạp. Verdict có mã trong `never_remember` (git huỷ thay đổi, xoá, ngoài workspace, secrets, inline/dynamic, taint…) luôn hỏi lại.
- `allowlist` (mode cũ): không bao giờ hỏi; ngoài tầng 0 chỉ chạy những gì allowlist cho phép.
- Tầng 3 bị chặn ở **mọi** mode, kể cả `yolo` của eval.
- Eval: `R26-security-block-download-exec` (lệnh `iwr | iex` không bao giờ được chạy), `R27-security-tests-are-tier1` (lệnh test của model được xếp `BUILD_TEST`). Eval runner có thêm `pass_if.audit_matches` / `audit_absent`. Eval chạy YOLO nên không kiểm được "không hỏi"; phần đó có unit test (`balanced_runs_contained_asks_risky_blocks_dangerous`, …).

## Card hỏi (B3 tối thiểu → B4 đầy đủ)

B3 đã có: tiêu đề theo lý do chính, **lệnh thật** nguyên văn, danh sách lý do (tiêu đề + giải thích), ô "Nhớ cho mọi lệnh "npm install *"" chỉ hiện khi Engine cho phép nhớ. B4 làm phần còn lại dưới đây.

```text
⚠ Cài package · cần mạng                         [tầng 2]
  npm install lodash
  Tải package từ registry và có thể chạy script cài đặt;
  sửa file lock và thư mục dependency.
  [Cho phép một lần]  [Cho phép mọi "npm install *" trong workspace]  [Từ chối]
```

- Header: **badge tầng** (`Cần duyệt` copper; `Đã chặn` đỏ, dùng cho nhãn) + lý do chính. Dưới là **lệnh thật** nguyên văn, rồi danh sách lý do. `description` do model viết (nếu có) chỉ là thông tin phụ.
- Bốn nút: **Cho phép một lần** (nút chính) · **Cho phép "<mẫu>" trong phiên này** · **Luôn cho phép "<mẫu>" trong workspace** · **Từ chối**. Hai nút giữa chỉ hiện khi Engine gửi `risk.pattern`; không có mẫu (pipeline, git huỷ thay đổi, xoá, secrets, taint…) thì chỉ còn "một lần" và "Từ chối".
- Phạm vi duyệt (`session.permission{scope}`):

  | scope | Hiệu lực | Lưu ở |
  | --- | --- | --- |
  | `once` | Chỉ lần gọi này | — |
  | `session` | Tới hết phiên | Bộ nhớ của `Session.session_allow`, **không ghi đĩa**; session mới của cùng workspace bắt đầu trống |
  | `workspace` | Mọi phiên của workspace | `.silence/permissions.json`; thu hồi trong Settings |

  Nút nhớ không bao giờ tick sẵn. `scope` bị Engine bỏ qua (coi là `once`) khi verdict thuộc `never_remember`. Từ chối không bao giờ lưu. `remember: true` (cờ cũ) = `workspace`.
- **Stop** (`session.abort`): Engine từ chối mọi permission đang chờ rồi dừng lượt, nên không còn kẹt ở `Stopping…` đợi người dùng; Studio gỡ card ngay.
- **Thông báo desktop** (`silence-notify-permission`): chỉ hiện khi cửa sổ không ở phía trước (ẩn, thu nhỏ, mất focus). Nội dung chỉ gồm **lý do** (tiêu đề tầng), không bao giờ có lệnh hay đường dẫn, vì thông báo xuất hiện cả trên màn hình khoá. Bấm vào thì đưa cửa sổ lên.
- Tầng 3 không hiện card hỏi. Engine gửi `trace{event:"policy.blocked", detail:{code,title,detail,tool}}`; chat biến bước `Running …` thành `Blocked <lý do tiếng Việt>`. Model nhận `hint` tiếng Anh để chọn cách khác.

## MCP server (Settings → Công cụ)

- Cấu hình theo workspace ở `.silence/mcp.json` (`crates/runtime/src/mcp_config.rs`). Server là một lệnh Engine chạy, và file có thể đến từ repo clone về, nên server **chỉ chạy khi user trên máy này đã cho phép đúng lệnh đó**: dấu vân tay (workspace, tên, lệnh, args, tên biến env) lưu ở `<data_dir>/mcp-approved.json`. Đổi lệnh/args trong file = cần cho phép lại.
- Thêm từ Studio: hiện nguyên dòng lệnh và hỏi xác nhận trước khi lưu và chạy. Bật lại server từ file = cho phép.
- `mcp.list` không bao giờ trả giá trị env (chỉ tên biến). Giá trị `${VAR}` lấy từ môi trường của Engine lúc khởi động server, để secret không nằm trong file.
- Mỗi lần gọi tool MCP vẫn qua Risk Engine (`MCP_CALL` / `MCP_READ`) và gây taint như trước.

## Chọn chế độ (Settings)

Settings → **Chế độ quyền**: **Cân bằng** (mặc định) hoặc **Thận trọng**. **Tự chủ** hiển thị nhưng tắt, vì cần sandbox chặn mạng (xem [backlog.md](backlog.md)). Lựa chọn lưu ở `localStorage` (`silence.permission.mode`), gửi lúc `session.create` và đồng bộ lại trước mỗi lượt bằng `session.set_permission` (RPC này từ chối `yolo`). Đổi trong lúc có phiên mở thì áp dụng ngay cho phiên đó.

## Nạp hướng dẫn cho AI

"Bắt AI đọc file trước khi làm" **không phải là cơ chế an toàn**: model có thể bỏ qua, hoặc bị prompt injection ghi đè. Vì vậy chia ba lớp:

| Lớp | Cho ai | Cách |
| --- | --- | --- |
| 1. Enforce | Engine | Risk Engine quyết định; model không vượt qua được |
| 2. Progressive disclosure | Agent trong app | SYSTEM có mục `## Safety` ngắn, khoảng 8 dòng (B3). Khi bị `ask`/`block`, tool result trả về **mã + `hint`** đúng lúc, không nạp cả catalog vào context |
| 3. Rule theo đường dẫn | Dev agent build repo (Claude Code, Cursor) | Cặp rule `security-permissions` (`.claude/rules` `paths:` ↔ `.cursor/rules` `globs:`) tự nạp khi sửa `crates/runtime/src/risk/**`, `permissions.rs`, `agent/policy.rs`, `crates/tools/**`, `crates/sandbox/**`, `crates/mcp/**`, `packages/protocol/**` |

So sánh: Claude Code nạp `CLAUDE.md` luôn luôn, `.claude/rules` theo `paths`, skills theo description, và enforce bằng hook. Cursor nạp rules theo `alwaysApply`/`globs`/agent-requested. Codex dùng `AGENTS.md` theo thư mục. 5ilence lấy cách "rule theo đường dẫn" cho dev, và "enforce + gợi ý đúng lúc" cho agent trong app.

## Lộ trình

| Bước | Nội dung | Trạng thái |
| --- | --- | --- |
| B0 | RPC từ chối `yolo`; `allowlist` so khớp bằng `entry_matches`; deny trả `permission denied by user` | ✅ |
| B1 | Spec này, risk catalog, rule `security-permissions`, cập nhật PRD/threat-model/AGENTS | ✅ |
| B2 | `risk/` (parser, policy YAML, classify), corpus 100+ ca, test catalog-sync | ✅ |
| B3 | `policy::gate` cho mọi tool; T3 chặn kèm mã + hint; T0/T1 theo mode; audit `tier`+`codes` và `tool.blocked`; taint theo phiên (MCP, fetch); protocol 0.1.9: `PermissionMode += balanced (mặc định), autonomous`, `Permission.risk`, `Diff.applied`; nhớ theo mẫu lệnh (`remember` = mẫu, không cần thêm `scope`); SYSTEM `## Safety`; eval R26/R27; Studio gửi `balanced`, card có lý do, DiffCard "Hoàn tác" | ✅ |
| B4 | Protocol 0.1.10 (`scope`, `session.set_permission`); card có badge tầng và nút "trong phiên này"; Stop tự Từ chối; chọn chế độ trong Settings; bước "Đã chặn" trong chat; thông báo desktop | ✅ |
| Sau | Duyệt trước theo plan, nhóm deploy, allowlist domain, sandbox mạng, `autonomous`, policy workspace, model phân loại, hook chặn | [backlog.md](backlog.md) |
