---
description: Yêu cầu sản phẩm 5ilence — mục đích harness cá nhân chuyên môn hoá (đã cập nhật theo ADR 0004); persona, job, non-goals, NFR là bản cũ chờ viết lại.
type: prd
---
# PRD — 5ilence AI Engineer Platform

**Status:** Đổi hướng theo [ADR 0004](adr/0004-backend-adapters.md) (2026-11-18). Mục Mục đích dưới đây đã cập nhật; các mục còn lại là bản cũ, sẽ viết lại theo [lộ trình](adapters/migration.md).  
**Audience:** một người dùng (cá nhân, không thương mại); Windows là chính, có thể macOS/Linux  
**Success:** agent làm đúng theo cách của người dùng ngay lần đầu, tự kiểm chứng trước khi báo xong, không làm điều nguy hiểm; đo được là tốt hơn dùng Claude Code trần; người dùng bỏ được app Claude desktop.

## Mục đích

5ilence là **harness cá nhân cho lĩnh vực lập trình** (code, database, app, website, hệ thống). Các app AI coding có sẵn (Claude Code, Codex, Cursor…) phục vụ mọi người nên phải "cân bằng". 5ilence **chuyên môn hoá** chúng cho riêng người dùng qua tám trụ: hồ sơ cá nhân, tri thức project, kỹ năng, quy trình, kiểm chứng, vòng học, đo lường, kiểm soát và kinh tế quota.

Hướng bắc: **không tự xây vòng agent, không đuổi theo tính năng của Cursor hay Claude Code.** Vòng agent là của app có sẵn (Claude Code trước, qua Agent SDK). 5ilence giữ phần làm nên khác biệt: Risk Engine, audit, hồ sơ và skill của người dùng, kiểm chứng, số liệu, và Studio làm nơi làm việc hằng ngày. Không fork VS Code; 5ilence Studio (Electron) + 5ilence Engine (sidecar Rust).

## Persona

- **Dev:** sửa bug, thêm feature, đọc codebase lạ, viết test, đụng DB/schema, dựng app/website. Windows, PowerShell, repo Git.
- **Tech lead:** audit tool call, kiểm soát model/cost, ép convention qua skills/hooks/rules.
- **Không phải:** designer hay sales thuần; không thay VS Code như IDE đầy đủ năm 1 (editor đủ dùng: Monaco + terminal + diff).

## Jobs to be done (lõi năm 1 — đã chốt)

1. Mở workspace → prompt AI → agent đọc/grep/sửa file / chạy shell → xem diff → apply/reject.
2. Plan mode: agent lập kế hoạch, người Approve, rồi mới edit.
3. Gắn **model cloud hoặc local** (khai báo provider trong `config/models.yaml`) và/hoặc Auto (harness route fast/mid/strong).
4. Bật MCP stdio (Git, ticket, CI, DB tools, …) theo allowlist workspace.
5. Ủy thác explore / implement / review cho sub-agent, nhận summary.
6. Xem cost/token và audit trail của session.

## Hướng phát triển (sau lõi — backlog, chưa khóa năm 1)

Đã chốt: năm 1 không ôm tab/index/CLI/marketplace. Bổ sung khi lõi ổn. Thứ tự đề xuất:

| Nhóm | Ví dụ |
| --- | --- |
| Context & convention | `@` file/folder, `/` skills, `AGENTS.md` / rules theo path, hooks |
| Modes | Ask, Plan, Agent chạy được; Debug và Review hiện mờ trong menu, chưa làm; bỏ MultiTask (xem `docs/frontend/composer.md`) |
| Git & session | commit khi user hỏi, worktree, resume thread (event log — ADR 0002) |
| Task & bối cảnh | project / task / decisions trong `.silence/`, agent nạp vào context (ADR 0002) |
| CLI | 5ilence CLI kiểu Claude Code, cùng harness với Studio |
| Index codebase | grep/ripgrep trước; embedding/RAG nếu cần sau |
| Editor phụ | Tab autocomplete, LSP đầy đủ — sau năm 1 trừ khi chốt sớm |

Phần này **chưa khóa năm 1**. Có thể thêm/bớt.

## Non-goals (năm 1)

- Fork VS Code; marketplace extension; fleet agent trên cloud VM.
- Control plane đa tenant / session từ xa (chỉ sau khi local ổn).
- Nhồi BMAD/GSD/ECC **nguyên bản vào UI** (các bộ công cụ build ngoài không ship vào app).

Tab autocomplete, RAG mặc định, CLI: **không cấm** — để backlog, không phải job lõi Phase 0.

## NFR Windows (hạng 1)

- ConPTY + PowerShell mặc định; path dài; UTF-16/UTF-8 không vỡ tiếng Việt.
- Sidecar Rust tách process; UI crash không giết agent.
- Permission mặc định = **Cân bằng**: tự chạy hành động an toàn hoặc đảo ngược được (luôn hiển thị + audit); rủi ro thì `ask` kèm giải thích; nguy hiểm thì chặn. Nhớ quyền theo workspace và theo mẫu lệnh. Không silent YOLO. Spec: `docs/security/permissions.md`.
- Secret redaction trước khi gửi model.
- Named pipe local-only; không bind LAN.

## Success metrics

| Metric | Mục tiêu Phase 1 | Mục tiêu năm 1 |
| --- | --- | --- |
| Eval pass rate (22 task v0) | ≥ 40% trên 1 model cloud mạnh | ≥ 70% với Auto |
| Latency time-to-first-token | < 2s khi mạng cloud ổn (model local: tuỳ phần cứng, không đặt mục tiêu) | < 1.5s |
| Cost/task (median) | đo được, log 100% | Auto rẻ hơn strong-only ≥ 30% |
| Tool reliability Windows | edit/grep không lỗi encoding | shell/ConPTY ổn định |

## Principles

UI không gọi model. Mọi sửa file đi qua tool runtime (diff + audit). Mỗi thay đổi harness kèm eval, không “feel better”. Model = do người vận hành cung cấp, cloud hoặc local, qua gateway OpenAI-compatible; Engine không gắn cứng nhà cung cấp nào.
