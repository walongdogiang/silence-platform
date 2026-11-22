---
description: Lộ trình chuyển 5ilence từ Engine Rust sang lõi TS và adapter Claude — giữ/mang sang/xoá, các giai đoạn tới khi bỏ được Claude desktop và điều khiển từ điện thoại.
type: roadmap
status: draft
code:
  - crates/runtime/src/risk/mod.rs
  - crates/runtime/src/risk/default_policy.yaml
  - crates/runtime/src/session/log.rs
  - packages/protocol/src/index.ts
  - apps/studio/src/main/index.ts
---
# Lộ trình chuyển sang harness

Quyết định: [ADR 0004](../adr/0004-backend-adapters.md). API lõi: [protocol.md](protocol.md). Adapter Claude: [claude-sdk.md](claude-sdk.md).

Nguyên tắc: xong giai đoạn này mới sang giai đoạn sau. Mỗi việc một PR nhỏ từ `origin/main`. Engine Rust đóng băng: chỉ sửa lỗi chặn việc dùng hằng ngày, không thêm tính năng, không dọn từng phần.

## Mang từ Rust sang `packages/core`

| Phần | Nguồn Rust | Ghi chú |
| --- | --- | --- |
| Risk Engine | `risk/mod.rs`, `risk/command.rs`, `risk/default_policy.yaml`, `risk/corpus.yaml` | Giữ nguyên file YAML. Bộ phân tích lệnh PowerShell/bash cần nhiều test nhất. So khác biệt với bản Rust trên corpus |
| Quyết định quyền | `agent/policy.rs`, `permissions.rs` | Allow/ask/block theo chế độ; quyền đã nhớ theo workspace |
| Event log, audit, redact | `session/log.rs`, `audit.rs`, `redact.rs` | Giữ định dạng `events.jsonl` nếu được |
| Snapshot theo lượt | `agent/sandbox.rs` (`take_snapshot`, `restore_snapshot`) | Gọi `git`, trung lập với backend |
| Terminal | `pty.rs` | Đổi sang `node-pty` |
| Đọc file cho UI | RPC `fs.*` | Viết lại nhỏ |

## Xoá

| Khi nào | Nội dung | Rủi ro |
| --- | --- | --- |
| Giai đoạn 0 | `.cursor/` (rule, `.cursorignore`) + sửa `scripts/check-rules-sync.mjs`, `docs-check.yml`, `AGENTS.md`, `CLAUDE.md`; `docs/archive/`; `harness/` (dữ liệu session lỡ commit); `ContextPanel.tsx`, `ProjectHeader.tsx` (không ai import); `.github/workflows/evals.yml` | Thấp. Không còn dùng Cursor |
| Giai đoạn 2 (một lần) | Toàn bộ `crates/`, `Cargo.toml`, `scripts/cargo-msvc.bat`, `config/models.yaml`, `templates/silence/`, `evals/`; UI chỉ phục vụ Engine cũ (Evals, Auto, nguồn model và API key, sandbox, Ports, browser của agent); kiểu tương ứng trong `packages/protocol`; job Rust trong `ci.yml` | Mất đường chat cũ (lõi mới đã thay). Khôi phục từ tag `archive/pre-harness-pivot` |

## Giai đoạn 0 — Chốt và dọn rẻ

| # | Nhánh | Nội dung |
| --- | --- | --- |
| 0.1 | `docs/harness-adapters` | ADR 0004, spec, PRD |
| 0.2 | — | Tag `archive/pre-harness-pivot` trên `origin/main`, push lên GitHub |
| 0.3 | `chore/remove-cursor` | Xoá `.cursor/`; `check:rules` chỉ còn kiểm `.claude/rules`; sửa `AGENTS.md`, `CLAUDE.md`, `docs/README.md` |
| 0.4 | `chore/remove-junk` | `docs/archive/`, `harness/`, hai component không dùng, workflow `evals.yml` |
| 0.5 | — | Tạo repo private `~/.silence` trên GitHub với hồ sơ khởi đầu, 5 skill, `verify.yaml` cho repo này |

**Xong khi:** CI xanh, docs và rule khớp, Studio vẫn chat được bằng đường cũ.

## Giai đoạn 1 — Lõi TS + Claude, dùng được hằng ngày

| # | Nhánh | Nội dung |
| --- | --- | --- |
| 1.1 | `chore/spike-claude-sdk` (không merge) | Các test bắt buộc ở [claude-sdk.md](claude-sdk.md) trên Windows. **Cổng:** fail điều kiện nền thì dừng và xem lại ADR |
| 1.2 | `feat/core-skeleton` | `packages/core`: API không phụ thuộc kênh truyền, host tiến trình riêng do Studio khởi chạy, client trong main/renderer, công tắc đường cũ/đường mới |
| 1.3 | `feat/core-risk` | Port Risk Engine + quyền + so khác biệt với corpus |
| 1.4 | `feat/core-log` | Event log, audit, redact, snapshot |
| 1.5a | `feat/adapter-claude` | Interface `Backend`, adapter Claude (hook `PreToolUse` → `decide`), env chỉ đăng nhập gói, phát hiện đăng nhập, quota; test record/replay |
| 1.5b | `feat/core-sessions` | Session manager: Risk Engine → Cân bằng (`ask` hỏi qua `session.event`, không người trông thì `deny`, lỗi thì `deny`), diff trước khi ghi, taint, event log/audit/snapshot, `session.create/prompt/abort/permission/close/list` (gồm session ngoài), nạp hồ sơ + plugin `~/.silence` |
| 1.5c | `feat/studio-core-chat` | Studio dùng lõi cho chat khi `SILENCE_CORE=1`: main định tuyến `session.create` và các method lượt (`prompt`/`abort`/`permission`/`set_mode`/`set_model`) của session lõi sang lõi; renderer không đổi; còn lại (fs, terminal, lịch sử, eval) ở Engine. Chưa có trên lõi: `session.context`, `rewind`, `fork`, lịch sử chat |
| 1.6 | `feat/repo-config-review` | Duyệt cấu hình repo theo hash: lõi liệt kê hook, MCP, env, lệnh trợ giúp, plugin, `` !`lệnh` `` trong slash command/skill; chưa duyệt thì hỏi (Studio: hộp thoại native) hoặc chạy không nạp cấu hình repo |
| 1.7 | `feat/personal-profile` | Hồ sơ cá nhân: đọc lại `~/.silence` mỗi session; hồ sơ theo project `~/.silence/projects/<repo>/profile.md` (tên = thư mục checkout chính, worktree dùng chung); cảnh báo khi quá 60 dòng; có secret thì không nạp; plugin phải có `.claude-plugin/plugin.json`; RPC `profile.status`; mục **Hồ sơ** trong Settings của Studio (chỉ đọc) |
| 1.8 | `feat/verify` | Kiểm chứng theo phạm vi file đổi, trả lỗi cho agent tối đa 2 lần; lệnh của repo duyệt theo nội dung (4d); thẻ "Kiểm chứng" trong chat |
| 1.9 | `feat/lessons` | Nút "Ghi bài học" ở chân câu trả lời → một lần gọi Claude (không tool, mặc định Haiku) đề xuất sửa hồ sơ / hồ sơ project / verify.yaml / skill → duyệt từng diff → ghi + ghi chú bài học, commit và push `~/.silence` |
| 1.10 | `feat/session-metrics` | Số liệu từ event log (lượt, báo xong sai, vòng sửa, nhắc lại, token/chi phí, quota) so với session Claude desktop/terminal; trang Số liệu; session ngoài trong lịch sử, xem chỉ đọc và tiếp tục trong 5ilence |
| 1.11 | `feat/parallel-sessions` | Nhiều chat chạy song song (renderer theo dõi lượt chạy theo từng session); chat tự tách sang git worktree ngoài repo khi trùng thư mục với chat khác đang chạy hoặc để lại thay đổi chưa commit, kèm lý do + đường dẫn, nút ép bật/tắt mỗi chat; thẻ gộp (Gộp / Giữ nhánh / Bỏ); giới hạn lượt cùng lúc (mặc định 2, Settings 1–4) và hàng đợi |
| 1.12 | `feat/browser-preview` | Pane xem dev server/URL (WebContentsView) |

**Xong khi:** dùng Studio 2 tuần cho mọi việc trừ theo dõi PR và việc theo lịch; số liệu so với Claude trần không xấu hơn.

## Giai đoạn 2 — Xoá Rust, chạy nền

| # | Nhánh | Nội dung |
| --- | --- | --- |
| 2.1 | `chore/remove-rust-engine` (có thể chia) | Theo dòng "Giai đoạn 2" ở bảng Xoá |
| 2.2 | `feat/tray` | Lõi sống ở khay khi đóng cửa sổ; tự chạy cùng hệ điều hành (tuỳ chọn) |
| 2.3 | `feat/job-queue` | Hàng đợi, giới hạn chạy cùng lúc theo quota, dừng việc nền khi gần hết quota |

**Xong khi:** repo không còn Rust, CI xanh, đóng cửa sổ thì việc vẫn chạy.

## Giai đoạn 3 — Bỏ hẳn Claude desktop

| # | Nhánh | Nội dung |
| --- | --- | --- |
| 3.1 | `feat/pr-watch` | Theo [ADR 0003](../adr/0003-pr-watch.md), chạy trên lõi mới |
| 3.2 | `feat/schedule` | Việc theo lịch/sự kiện; chạy bù khi máy thức; không người trông thì `ask` → `deny` và ghi lại |
| 3.3 | `feat/job-container` | Container cho job không người trông (mẫu Dev Container + firewall) |
| 3.4 | `feat/workflows` | Quy trình khai báo (plan → làm → kiểm → PR) |
| 3.5 | `feat/model-per-step` | `setModel` theo bước, cảnh báo quota |

**Xong khi:** 2 tuần không mở Claude desktop.

## Giai đoạn 4 — Điều khiển từ điện thoại

| # | Nhánh | Nội dung |
| --- | --- | --- |
| 4.1 | `feat/remote-transport` | Kênh WebSocket của API lõi, chỉ nghe loopback, có token |
| 4.2 | `feat/pwa` | Renderer chạy được trên web; PWA cài lên điện thoại |
| 4.3 | `feat/remote-approve` | Thông báo đẩy; duyệt lệnh rủi ro cần xác nhận thêm |
| 4.4 | — | Hướng dẫn `tailscale serve` |

**Xong khi:** từ điện thoại xem session, gửi prompt, duyệt lệnh, nhận thông báo.

## Giai đoạn 5 — Backend thứ hai

Khi cần: adapter Codex (`app-server`) hoặc ACP, kèm bộ chuyển hồ sơ/skill sang định dạng của hãng đó.

## Docs cần sửa theo

- `docs/codemap.md`: viết lại khi có `packages/core`.
- `docs/adr/0001`, `0002`: đánh dấu phần bị thay thế khi xoá Rust.
- `docs/threat-model.md`, `docs/security/*`: Windows không sandbox khi tương tác, duyệt cấu hình repo, điều khiển từ xa.
- `AGENTS.md`, `CLAUDE.md`: stack, lệnh, test theo phạm vi khi Rust bị xoá.
