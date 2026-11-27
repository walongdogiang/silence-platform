---
description: 5ilence là harness cá nhân chỉ cộng thêm trên Claude CLI để thay hẳn Claude desktop app; mục đích, hoà giải nguyên tắc cũ, tám trụ, lõi TS ở khay, Agent SDK, Tailscale.
type: adr
status: draft
code:
  - crates/runtime/src/risk/mod.rs
  - crates/runtime/src/agent/policy.rs
  - crates/runtime/src/agent/cli.rs
  - apps/studio/src/main/index.ts
---
# ADR 0004 — Harness chuyên môn hoá trên các app AI coding có sẵn

**Status:** Proposed · **Date:** 2026-11-19 · **Sửa:** 2026-11-28 (mục đích, hoà giải, Decision 6 — T-038)
**Spec:** [../adapters/protocol.md](../adapters/protocol.md) (API lõi và adapter), [../adapters/claude-sdk.md](../adapters/claude-sdk.md) (adapter Claude, backend sau), [../adapters/migration.md](../adapters/migration.md) (lộ trình).
**Thay thế:** phần Engine Rust của [ADR 0001](0001-architecture.md) và vòng agent tự viết của [ADR 0002](0002-harness-architecture.md).

## Context

- Claude Code, Codex, Cursor phục vụ mọi người nên chọn mức trung bình: prompt chung, quy trình chung, trí nhớ nông, quyền ở mức an toàn chung.
- 5ilence là **harness cá nhân**: một người dùng, lĩnh vực lập trình, không thương mại. Mục đích là **chuyên môn hoá** các app đó cho riêng người dùng, không làm lại vòng agent.
- Hiện trạng: Engine Rust (khoảng 28k dòng) tự viết vòng agent, tool, router, gateway, compact, sandbox Windows, eval. Đường chat duy nhất chạy `claude -p --tools ""` qua MCP bridge, nên mất phần tốt nhất của Claude Code.
- Tài khoản: gói **Claude Pro**, không API key; quota là giới hạn thật. Không cần gọi API model trực tiếp. Sau này có thể thêm Codex CLI, Antigravity CLI.
- Một máy; Windows/PowerShell là chính, có thể macOS/Linux. Trả lời theo ngôn ngữ người hỏi.
- Người dùng đang làm việc hằng ngày trong Claude desktop app (tab Code). Đích là 5ilence nối Claude CLI và **thay hẳn** desktop app, nên thiết kế coi người dùng là người dùng CLI. Thứ dùng hằng tuần: session song song, theo dõi PR/Auto-fix, việc theo lịch, browser preview; muốn điều khiển từ điện thoại.
- Người dùng không còn dùng Cursor.

## Mục đích

1. **Bù chỗ CLI yếu hơn desktop app.** Người dùng dùng Claude CLI qua 5ilence; cái gì app làm tốt hơn terminal thì 5ilence làm.
2. **Bám Claude CLI, harness chỉ cộng thêm.** Vòng agent, tool, system prompt là của Claude Code (qua Agent SDK). 5ilence không thay, không bớt, không làm sai lệch cách Claude suy luận và chạy flow; Claude trong 5ilence chạy như Claude trong terminal, cộng thêm phần của 5ilence.
3. **Ngang tính năng desktop app.** Desktop app có gì thì 5ilence có bản tương đương, làm theo thứ tự ưu tiên trong [danh mục clone](../adapters/desktop-parity.md); thêm chỗ app còn thiếu (Risk Engine, kiểm chứng, vòng học, số liệu).

### Hoà giải với nguyên tắc cũ

| Nguyên tắc cũ / mâu thuẫn | Cách xử lý |
| --- | --- |
| "Không đuổi theo tính năng của Claude Code" (PRD cũ) | Bỏ. Vẫn clone, nhưng xếp ưu tiên theo điểm bất tiện người dùng gặp hằng tuần; tính năng chưa dùng vào Later |
| Harness riêng của desktop app (danh sách task, câu hỏi cuối có nút, tách session, chapter) | Clone bằng cơ chế cộng thêm (`systemPrompt.append`, MCP của lõi, hook). Có test đồng nhất: cùng prompt chạy trong terminal và trong 5ilence, khác biệt chỉ ở phần cộng thêm |
| Tính năng cần cloud hoặc tài khoản Anthropic (session cloud, Remote Control, artifact, connector, lịch chạy trên cloud) | Chỉ làm bản cục bộ tương đương (Tailscale + PWA, lịch ở lõi, trang HTML cục bộ) |
| Computer use, điều khiển Chrome | Làm sau cùng; người dùng tự bật trong Settings; có Risk Engine và audit riêng |

**Thứ tự cơ chế khi thêm tính năng** (rẻ và ít lệch Claude nhất trước): `CLAUDE.md`/hồ sơ → skill/plugin → hook của Claude → MCP của lõi → xử lý luồng sự kiện trong app. Chỉ xuống bậc sau khi bậc trước không làm được; ghi lý do trong việc đó.

## Decision

### Tám trụ

| # | Trụ | Nội dung | Nơi lưu |
| --- | --- | --- | --- |
| 1 | Hồ sơ cá nhân | Quy ước, sở thích, môi trường; ngắn (dưới 60 dòng) | `~/.silence/profile.md` |
| 2 | Tri thức project | Kiến trúc, codemap, quyết định | Trong repo (`CLAUDE.md`, `AGENTS.md`, `docs/`), do chủ repo quyết định |
| 3 | Kỹ năng | Skill, subagent, lệnh của người dùng | `~/.silence/plugin/` (plugin cục bộ) |
| 4 | Quy trình | Plan → làm → kiểm → PR; bước tất định xen bước agent | `~/.silence/workflows/` |
| 5 | Kiểm chứng | "Định nghĩa xong" theo phạm vi file đổi; fail thì trả lỗi cho agent, tối đa 2 lần | `~/.silence/projects/<repo>/verify.yaml`, hoặc `.silence/verify.yaml` trong repo |
| 6 | Vòng học | Bắt đầu thủ công: nút "ghi bài học" → agent đề xuất sửa trụ 1, 3, 4, 5 → người dùng duyệt | `~/.silence/lessons/` |
| 7 | Đo lường | Số liệu từ session thật (số lần sửa lại, báo xong sai, số lượt, quota); eval chỉ là bộ hồi quy nhỏ | event log |
| 8 | Kiểm soát, kinh tế | Risk Engine duyệt mọi tool call, audit, taint; model theo bước; quota | lõi |

`~/.silence/` là một repo git, push lên **GitHub (private)** để không mất. Không bao giờ chứa secret; lõi chặn ghi secret vào đó.

Trụ 1, 3, 4, 5, 6 là **của người dùng, không thuộc hãng nào và không ghi vào repo của người khác**. Với Claude, lõi nạp chúng qua `systemPrompt.append` và option `plugins` của SDK. Đổi hãng thì viết bộ chuyển cho hãng đó.

### Kiến trúc

```
Studio (Electron: main + renderer)          Điện thoại (PWA)
        │ MessagePort                           │ WebSocket qua Tailscale Serve
        └──────────────► packages/core (TS) ◄───┘
                         Risk Engine, audit, event log, hồ sơ, kiểm chứng,
                         hàng đợi + quota, lịch, theo dõi PR, snapshot
                         │ interface Backend (trong tiến trình)
                         ├── adapter Claude: Agent SDK → binary Claude Code
                         └── (sau) adapter Codex: codex app-server
```

1. **Lõi là `packages/core` (TypeScript), không import Electron.** Lõi chạy như một tiến trình riêng do Studio khởi chạy và **sống ở khay hệ thống**: đóng cửa sổ thì lõi vẫn chạy. Cùng package chạy được bằng `node` độc lập khi cần.
2. **API lõi không phụ thuộc kênh truyền.** Trên máy đi qua MessagePort; từ điện thoại đi qua WebSocket. Renderer gọi qua một client trừu tượng, giữ tên method RPC hiện có khi được.
3. **Adapter là module TS trong lõi** cài interface `Backend` ([protocol.md](../adapters/protocol.md)). Adapter tự khởi chạy tiến trình của hãng. Không còn sidecar hay giao thức stdio riêng giữa lõi và adapter.
4. **Backend đầu tiên: Claude Code qua Claude Agent SDK.** Không gọi thẳng `claude -p`. SDK chạy binary Claude Code kèm theo, **không có** `ANTHROPIC_API_KEY` hay biến xác thực khác, dùng phiên đăng nhập Pro.
5. **Duyệt từng tool call:** cổng Risk Engine ở hook `PreToolUse` (theo tài liệu SDK, hook chạy trước mọi permission rule); `canUseTool` là lưới an toàn; `permissionMode` luôn `default`.
6. **Cấu hình Claude như terminal** (đích; code ở T-074, chi tiết [claude-sdk.md](../adapters/claude-sdk.md)):
   - `settingSources: ['user', 'project', 'local']` như CLI. Từ chối duyệt cấu hình repo (mục 7) thì chỉ `['user']`. `~/.claude/settings.json` là của người dùng, tin như terminal.
   - Luật quyền: Risk Engine đọc thêm luật trong file settings của Claude; "Luôn cho phép" ghi vào `.claude/settings.local.json` để terminal cũng dùng được; kho `~/.silence/*permissions.yaml` giữ cho luật riêng 5ilence ([permissions.md](../security/permissions.md)).
   - Tool: `tools` preset `claude_code`; `disallowedTools` chỉ cho tool đi vòng qua harness hoặc cần cloud, mỗi tên một lý do.
   - `env`: giữ toàn bộ môi trường, chỉ bỏ biến khoá API/nhà cung cấp và biến của app chủ.
   - Hồ sơ qua `systemPrompt.append`; skill/subagent/lệnh cá nhân qua `plugins: [{ type: 'local', path: '~/.silence/plugin' }]`.
7. **Duyệt cấu hình repo:** hook, `env`, `apiKeyHelper` trong `.claude/settings.json`, server trong `.mcp.json`, lệnh slash của project chạy ngoài tool call hoặc đổi môi trường. Lõi đọc trước khi mở session và hỏi người dùng một lần cho mỗi nội dung (theo hash).
8. **Không tự dựng sandbox.** Tương tác: Risk Engine + sandbox của hãng khi có (Claude: option `sandbox`, `failIfUnavailable: true`, chỉ macOS/Linux/WSL2) + snapshot git theo lượt. Không người trông: mỗi job một **container** (mẫu Dev Container + firewall), dùng chung cho mọi backend. Hệ quả: trên Windows native, khi tương tác **không có sandbox**.
9. **Chạy nền:** lịch và theo dõi PR chạy khi lõi đang chạy (máy thức). Lượt lỡ do máy ngủ thì **chạy bù một lần** khi thức dậy. Máy tắt thì không chạy; trạng thái trên GitHub vẫn đúng ([ADR 0003](0003-pr-watch.md)). Không có runner trên cloud.
10. **Điều khiển từ xa:** lõi chỉ nghe trên loopback; `tailscale serve` đưa ra mạng riêng của người dùng; điện thoại dùng web app (PWA) dựng từ renderer. Duyệt lệnh rủi ro từ xa cần xác nhận thêm (PIN hoặc sinh trắc học của trình duyệt). Không bind LAN, không mở ra internet.
11. **Nguồn sự thật của session:** event log của lõi phục vụ UI, audit, số liệu; jsonl của Claude (`~/.claude/projects/`) phục vụ resume. Studio đọc được cả session tạo từ Claude desktop hay terminal (`listSessions`, `getSessionMessages`).
12. **Test không tốn quota:** adapter và UI test bằng luồng `SDKMessage` ghi lại rồi phát lại (record/replay). Chỉ spike và bộ hồi quy nhỏ gọi model thật.
13. **Backend không có callback duyệt** (sau này): tắt tool ghi/shell có sẵn, cho agent dùng tool MCP do lõi cung cấp.

## Các phương án đã cân nhắc

**Ngôn ngữ của lõi.**

| Phương án | Ưu | Nhược | Kết luận |
| --- | --- | --- | --- |
| a. Giữ Engine Rust + sidecar Node chạy SDK | Giữ code có sẵn; Zed chạy adapter Claude bằng TS làm tiến trình con, nên cách này chạy được | Thêm tầng (TCP + token, stdio); phải build Rust/MSVC trên mỗi nền tảng; ba lý do giữ Rust (vòng riêng, sandbox tự làm, gateway) đều đã bị loại | Loại |
| b. Toàn TS trong `utilityProcess` của Electron | Một ngôn ngữ, cùng ngôn ngữ với SDK, ít tầng, không mở socket | Gắn vào vòng đời Electron | Gần đúng |
| **c. Lõi TS không phụ thuộc nơi chạy** | Như b, cộng chạy độc lập được (khay, sau này CLI) | Cần kỷ luật: lõi không import Electron | **Chọn** |
| d. Risk Engine Rust qua WASM/napi, phần còn lại TS | Giữ bộ phân tích lệnh | Build phức tạp, không đáng cho khoảng 1.2k dòng | Loại |

Risk Engine chuyển sang TS dùng nguyên `default_policy.yaml` và `corpus.yaml`. Trong lúc chuyển, **cả hai bản cùng phân loại corpus**, mọi khác biệt là lỗi.

**Cách nối Claude.** A gọi thẳng CLI: không có callback trong tiến trình, tự theo flag. B bọc TUI qua PTY: parse màn hình, dễ vỡ. C chỉ cấu hình Claude Code: không có kiểm chứng, vòng học, UI. **D Agent SDK: chọn** (hook và `canUseTool` trong tiến trình, `interrupt`/`setModel`, message có kiểu, resume/fork, `plugins`, `listSessions`).

**Chạy nền.** Chỉ khi app mở: đóng cửa sổ là dừng. **Lõi ở khay: chọn.** Runner trên cloud: cần đưa phiên Pro lên cloud, để sau nếu thật cần.

**Điều khiển từ xa.** **Tailscale Serve + PWA: chọn.** Bot Telegram: giao diện nghèo, dữ liệu qua bên thứ ba. Cloudflare Tunnel + Access: mở ra internet. Remote Control của Claude: đi vòng qua harness, chỉ cho Claude.

## Rủi ro đã biết

- **Điều khoản gói Pro (vùng xám, chưa xác minh).** Trang Agent SDK overview: Anthropic không cho bên thứ ba cung cấp đăng nhập claude.ai cho sản phẩm. Trang pháp lý (02/2026, theo báo chí): dùng OAuth Free/Pro/Max trong công cụ khác, **kể cả Agent SDK**, vi phạm Consumer Terms. Anthropic nói dùng cá nhân không đổi, nhưng chưa có văn bản cho phép rõ. Đường lui: gọi CLI, hoặc API key.
- **Quota Pro** là nút thắt khi làm việc 60–80 giờ/tuần: chia cho làm việc, kiểm chứng, eval. Lõi theo dõi quota và dừng việc nền khi gần hết.
- **Binary đi kèm SDK đi sau bản CLI mới nhất**: lịch nâng SDK định kỳ.
- **Viết lại Risk Engine** có thể sai phân loại: giảm thiểu bằng so khác biệt với bản Rust trên corpus.
- **Tool của Claude ghi file trực tiếp; Windows native không có sandbox**: Risk Engine + snapshot + container cho việc không người trông.
- **Điều khiển từ xa:** tài khoản Tailscale bị lộ đồng nghĩa với việc người khác chạy được lệnh trên máy; cần xác nhận thêm khi duyệt từ xa.
- **Vòng học tự sửa luật:** chỉ áp dụng khi người dùng duyệt; không bao giờ tự nới quyền.

## Xem lại quyết định khi

- Anthropic chặn kỹ thuật hoặc nói rõ Agent SDK với gói Pro dùng cá nhân là không được.
- Agent SDK đổi thứ tự hook so với permission rule.
- Claude Code có giao thức điều khiển chính thức tốt hơn SDK (ví dụ ACP gốc).
- Sau giai đoạn 1, số liệu không cho thấy Claude + 5ilence tốt hơn Claude trần.

## Consequences

- Engine Rust (`crates/*`) **đóng băng ngay**, xoá một lần khi lõi TS thay thế xong. Có tag `archive/pre-harness-pivot` để khôi phục.
- Eval cũ, Auto/router, gateway, sandbox Windows, chế độ quyền Tự chủ, tool browser/procs của agent bị xoá cùng Engine Rust.
- `.cursor/` (rule, `.cursorignore`) bị xoá; chỉ giữ `.claude/`. Script `check:rules` và workflow docs-check sửa theo.
- `packages/protocol` trở thành kiểu của API lõi; không còn bản Rust.
- PRD đã sửa mục Mục đích (2026-11-28: bỏ "không đuổi theo tính năng"); các mục khác viết lại theo lộ trình.
