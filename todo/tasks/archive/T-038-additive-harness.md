---
id: T-038
title: Harness chỉ cộng thêm trên Claude CLI, mục đích clone desktop app
type: docs
status: done
phase: verify
area: [docs, core]
size: M
model: opus
model-build: sonnet
depends: []
branch: docs/T-038-additive-harness
pr: 104
created: 2026-11-27
updated: 2026-11-28
---

## Mục tiêu

Chốt lại mục đích và nguyên tắc kiến trúc trong ADR 0004 theo đúng hướng user chốt: hiện user dùng Claude desktop app (tab Code), đích là 5ilence nối Claude CLI và **thay hẳn** desktop app (user trả lời 2026-11-28). Vì vậy thiết kế coi user là người dùng CLI: 5ilence bù chỗ CLI yếu hơn app, có đủ tính năng app có (kể cả theo dõi PR, lịch, điều khiển từ điện thoại) và thêm chỗ app còn thiếu. Bối cảnh hiện tại của ADR ghi sai điểm này. `model: opus` vì đây là quyết định kiến trúc, không phải sửa chữ.

Mục đích user chốt (2026-11-27):
1. 5ilence bù những chỗ CLI yếu hơn desktop app.
2. Bám Claude CLI (qua Agent SDK). Harness chỉ **cộng thêm**: không thay vòng agent, tool hay system prompt của Claude, không làm sai lệch cách Claude suy luận và chạy flow.
3. Desktop app có tính năng gì thì 5ilence có bản tương đương, làm theo thứ tự ưu tiên.

## Phạm vi

**Làm:** chỉ docs — ADR 0004, câu "Hướng bắc" trong PRD, `docs/adapters/claude-sdk.md`, `docs/security/permissions.md` (nguồn luật quyền), `docs/adapters/migration.md`, một file mới `docs/adapters/desktop-parity.md` (danh mục clone), mục lục `docs/README.md`.

**Không làm:**
- Sửa code adapter: thành việc riêng (đề xuất ở cổng duyệt).
- Làm tính năng clone nào: mỗi tính năng một việc.
- Sửa `AGENTS.md` / `CLAUDE.md` (kit đóng băng tới T-033): chỗ nào lệch thì ghi một dòng `[kit]` ở Later.

## Đọc trước

- `docs/adr/0004-backend-adapters.md`, `docs/adapters/claude-sdk.md` (mục options cố định, kết quả spike dòng 63–72, mục Xác thực), `docs/security/permissions.md` (bảng Nguồn, dòng 44–50).
- Code: `packages/core/src/backends/claude/{index.ts,env.ts,toolMap.ts}`, `packages/core/src/permissions/rules.ts`.
- SDK chính thức (đọc 2026-11-28): `code.claude.com/docs/en/agent-sdk/{typescript,permissions,user-input}`.

## Bối cảnh

- Thảo luận chốt mục đích: chat b112d5f5 (2026-11-22 → 2026-11-27).
- Câu cũ cần bỏ nằm ở `docs/PRD.md` dòng 15 ("không đuổi theo tính năng của … Claude Code"), không phải trong ADR 0004. ADR 0004 Context ghi "bỏ Claude desktop thì phải có đủ bốn thứ" — hẹp hơn mục đích mới.
- Ý tưởng phát sinh từ T-003 để bảng tính năng tính tới: thẻ dev server kiểu desktop (chạy/dừng, Open vào Xem trước, sau T-034); Diff vào cột pane phải; chia đôi cột pane (xét lại khi lõi quản lý tiến trình).

Dữ kiện SDK (tài liệu chính thức, 2026-11-28):
- `settingSources` bỏ trống = nạp như CLI: `user`, `project`, `local`. `[]` tắt cả ba. Luật quyền trong file settings chỉ áp khi nguồn của file đó được nạp.
- Thứ tự duyệt: hook `PreToolUse` → luật deny → luật ask → `permissionMode` → luật allow → `canUseTool`. Hook trả `allow` **không** bỏ qua deny/ask. Tool được allow rule duyệt thì **không** tới `canUseTool`, nhưng hook vẫn chạy trước → Risk Engine vẫn thấy mọi call.
- `tools: { type: 'preset', preset: 'claude_code' }` = bộ tool mặc định của Claude Code; `disallowedTools: ["Tên"]` gỡ hẳn tool khỏi ngữ cảnh.
- `AskUserQuestion` tới host qua `canUseTool`; host trả `{ behavior: "allow", updatedInput: { questions, answers } }`. Không có trong subagent.
- `env` **thay** môi trường tiến trình con, không gộp; mặc định là `process.env`.

## Thiết kế

### 1. Mục đích (sửa ADR 0004 Context + thêm mục "Mục đích"; PRD dòng 15)

Ba ý ở Mục tiêu, thay câu "không đuổi theo tính năng". Bối cảnh: user đang dùng desktop app (tab Code); đích là 5ilence trên Claude CLI thay hẳn app; user được coi là người dùng CLI.

### 2. Bốn cách hoà giải với nguyên tắc cũ (mục mới trong ADR)

| Mâu thuẫn | Cách xử lý |
| --- | --- |
| "Không đuổi tính năng" | Vẫn clone, xếp ưu tiên theo điểm bất tiện user gặp hằng tuần; tính năng chưa dùng vào Later |
| Harness riêng của desktop (danh sách task, câu hỏi cuối có nút, tách session, chapter) | Clone bằng cơ chế cộng thêm (`systemPrompt.append`, MCP của lõi, hook); có test đồng nhất: cùng prompt chạy terminal và trong 5ilence, khác biệt chỉ ở phần cộng thêm |
| Tính năng cần cloud/tài khoản Anthropic (session cloud, Remote Control, artifact, connector, lịch trên cloud) | Chỉ làm bản cục bộ tương đương (Tailscale + PWA, lịch ở lõi, trang HTML cục bộ) |
| Computer use, điều khiển Chrome | Làm sau cùng; user tự bật trong Settings; Risk Engine + audit riêng |

Thứ tự cơ chế khi thêm tính năng (rẻ và ít lệch Claude nhất trước): `CLAUDE.md`/hồ sơ → skill/plugin → hook của Claude → MCP của lõi → xử lý luồng sự kiện trong app. Chỉ xuống bậc sau khi bậc trước không làm được, ghi lý do trong việc đó.

### 3. Bốn chỗ adapter (quyết định; code ở việc riêng)

| Chỗ | Hiện | Chốt | Vì sao / ràng buộc |
| --- | --- | --- | --- |
| `settingSources` | `["project"]` | `["user","project","local"]` (như CLI). Từ chối duyệt cấu hình repo → `["user"]` | Terminal nạp cả ba. Cổng duyệt cấu hình repo (1.6) giữ nguyên cho `project` + `local` + `.mcp.json`; `~/.claude/settings.json` là của user, tin như terminal. Kiểm `apiKeySource` giữ nguyên (chặn `apiKeyHelper` ở user settings) |
| Luật quyền | kho riêng `~/.silence/permissions.yaml` + `projects/<repo>/permissions.yaml` | Risk Engine đọc thêm luật của Claude (`~/.claude/settings.json`, `.claude/settings.local.json` đủ allow/ask/deny; `.claude/settings.json` của repo chỉ ask/deny như cũ). "Luôn cho phép" ghi vào `.claude/settings.local.json` để terminal cũng có. Kho `~/.silence/*.yaml` giữ cho luật riêng 5ilence, đọc tiếp | Một nguồn luật chung với terminal. Chặn cứng vẫn thắng mọi allow. File settings của Claude thêm vào mục tiêu `POLICY_TAMPER` |
| Danh sách tool | 15 tool viết cứng | `tools: preset claude_code` + `disallowedTools` chỉ cho tool đi vòng qua harness hoặc cần cloud (vd `RemoteTrigger`, `PushNotification`, tool `Artifact…`, connector `mcp__claude_ai_*`), mỗi tên một lý do trong `toolMap.ts` | Có lại `AskUserQuestion`, `EnterPlanMode`, `ToolSearch`, `LSP`, `Monitor`…; tool lạ vẫn qua hook → Risk Engine `ask`. Việc code phải có UI trả lời `AskUserQuestion` |
| Biến môi trường | danh sách giữ (~40 biến) | Giữ toàn bộ `process.env`, bỏ `AUTH_VARS` + biến của app chủ (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SSE_PORT`, `ELECTRON_*`, `SILENCE_*`…; danh sách chốt bằng test) | Lệnh shell của agent cần đủ biến như terminal (`JAVA_HOME`, `GH_TOKEN`, nvm…). Lỗi cũ "lọt tool Artifact" do biến của app chủ → test: init `tools` không có tool của app chủ |

Đã cân nhắc, bỏ: giữ nguyên 4 chỗ (Claude trong app khác terminal, trái mục đích 2); bỏ hẳn kho `~/.silence/*.yaml` (mất luật riêng 5ilence, phải chuyển dữ liệu).

Spike #6 (claude-sdk.md) đã cho biết hook trả `allow` thì **không** gọi `canUseTool` → `AskUserQuestion` phải trả lời trong hook qua `updatedInput` (xác minh ở T-074). Chưa kiểm: `EnterPlanMode` đi đường nào; danh sách đúng biến của app chủ.

### 4. Danh mục clone (`docs/adapters/desktop-parity.md`)

Bảng: tính năng desktop app → bản 5ilence → hiện trạng (có / một phần / chưa) → ưu tiên (Now/Next/Later) → việc (mã T-xxx hoặc "đề xuất"). Nhóm: session (song song, worktree, tách session, chapter, tìm transcript), làm việc (task list, câu hỏi có nút, plan mode, AskUserQuestion), pane (diff, file, terminal, browser preview, dev server), GitHub (theo dõi PR, Auto-fix, sự kiện CI), nền (lịch, chạy khi đóng cửa sổ, giữ máy thức), từ xa (điện thoại, thông báo), khác (artifact, connector, computer use, Chrome, số liệu quota). Ưu tiên lấy từ ADR (bốn thứ dùng hằng tuần + điện thoại); dòng chưa có việc ghi "đề xuất", user chọn thêm vào Later sau.

### 5. Lộ trình (`migration.md`)

Giai đoạn 3 đổi tên "Ngang tính năng desktop app", **Xong khi** trỏ tới danh mục clone (mọi dòng ưu tiên Now/Next đã "có") + 2 tuần không mở desktop app. Thêm việc sửa adapter (mục 3) vào Giai đoạn 2 trước 2.1d.

## Kế hoạch

1. [x] ADR 0004: Context sửa theo mục 1; thêm mục **Mục đích**, **Hoà giải với nguyên tắc cũ** + thứ tự cơ chế (mục 2); Decision 6 đổi theo bảng mục 3; `description` frontmatter cập nhật; Date sửa đổi 2026-11-28. Kiểm: đọc lại, `npm run check:docs`.
2. [x] `docs/PRD.md` dòng 15: thay câu Hướng bắc bằng ba ý mục đích, link ADR. Kiểm: `rg -n "đuổi" docs/PRD.md` không còn kết quả.
3. [x] `docs/adapters/claude-sdk.md`: dòng `options` cố định và mục Xác thực/env theo mục 3; ghi rõ đây là đích, code chưa đổi (trỏ việc code). Kiểm: đọc lại.
4. [x] `docs/security/permissions.md`: bảng Nguồn thêm 2 nguồn file Claude; "Luôn cho phép" ghi đâu; `POLICY_TAMPER` gồm file settings Claude; ghi "đích, code ở việc …". Kiểm: `npm run check:docs`.
5. [x] Tạo `docs/adapters/desktop-parity.md` (frontmatter `description`, `type: roadmap`) theo mục 4; thêm dòng vào `docs/README.md`. Kiểm: `npm run check:docs`.
6. [x] `docs/adapters/migration.md` theo mục 5. Kiểm: đọc lại.
7. [x] Đóng việc trong PR (todo/README, DONE.md, archive) và thêm việc mà user đã chọn ở cổng duyệt. Kiểm: `node scripts/todo-claims.mjs doctor`.

## Tiêu chí xong

- [x] ADR 0004 có mục đích ba ý, bốn cách hoà giải, thứ tự cơ chế, bốn quyết định adapter — kiểm: `rg -n "Mục đích|Hoà giải|settingSources" docs/adr/0004-backend-adapters.md` → dòng 27, 33, 82
- [x] PRD không còn "không đuổi theo tính năng" — kiểm: `rg -n "đuổi" docs/PRD.md` → 0 dòng (ADR còn nhắc câu cũ trong bảng Hoà giải, có chủ ý)
- [x] `claude-sdk.md` và `permissions.md` khớp bốn quyết định, ghi rõ code chưa đổi — kiểm: đọc diff; mục "Cấu hình như terminal" và bảng nguồn claude-user/claude-local đều ghi "code ở T-074"
- [x] Có `docs/adapters/desktop-parity.md`, mỗi dòng có hiện trạng + ưu tiên + mã việc hoặc "đề xuất", có trong `docs/README.md` — kiểm: `npm run check:docs` → OK 27 file
- [x] `migration.md` Giai đoạn 3 trỏ danh mục clone, Giai đoạn 2 có việc sửa adapter — kiểm: đọc diff (dòng 2.1x, Giai đoạn 3 "Ngang tính năng")
- [x] Docs hợp lệ — kiểm: `npm run check:docs` → OK; `npm run check:rules` → OK 6 rule
- [x] Không đụng `AGENTS.md`, `CLAUDE.md` — kiểm: `git diff --name-only origin/main` → không có

## Nhật ký

### 2026-11-28 · build xong · Opus
- Quyết định: luật trong `.claude/settings.local.json` chỉ được allow khi file không bị git theo dõi (repo tự commit file đó thì coi như repo, chỉ ask/deny).
- Phát hiện: spike #6 → `AskUserQuestion` phải trả lời trong hook; ghi vào claude-sdk.md và T-074.
- Phát hiện: preset tool tốn thêm token cache mỗi session (spike ~40k với bộ rút gọn) → đo ở T-074.
- `node_modules` bị `permissions.deny` chặn đọc; dữ kiện SDK lấy từ tài liệu chính thức.
