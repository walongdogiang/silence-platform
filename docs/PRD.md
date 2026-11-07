# PRD — 5ilence AI Engineer Platform

**Status:** Phase 0  
**Audience:** kỹ sư nội bộ, Windows  
**Success:** app lập trình AI đầy đủ như Cursor / Claude Code; agent nói chuyện với **model cloud** (OpenAI-compatible / nhà cung cấp cloud). Không khóa “chỉ model công ty”.

## Mục đích

5ilence là **app AI engineer hoàn chỉnh** — chuyên lập trình: code, database, build app, build website, build hệ thống kỹ thuật. Người dùng làm việc với nó như với Cursor hoặc Claude Code: chat/prompt AI, AI dùng harness (đọc/sửa file, grep, shell, terminal), MCP, plan, sub-agent, skills/hooks, xem diff, audit.

Hướng bắc: **Cursor và Claude Code có chức năng gì thì 5ilence cũng có**. Năm 1 **làm lõi trước** (6 job dưới đây); phần còn lại là backlog, không phải phạm vi Phase 0/1. Không fork VS Code năm 1 — 5ilence Studio (Electron) + 5ilence Engine (sidecar Rust) như ADR hiện tại.

## Persona

- **Dev:** sửa bug, thêm feature, đọc codebase lạ, viết test, đụng DB/schema, dựng app/website. Windows, PowerShell, repo Git.
- **Tech lead:** audit tool call, kiểm soát model/cost, ép convention qua skills/hooks/rules.
- **Không phải:** designer hay sales thuần; không thay VS Code như IDE đầy đủ năm 1 (editor đủ dùng: Monaco + terminal + diff).

## Jobs to be done (lõi năm 1 — đã chốt)

1. Mở workspace → prompt AI → agent đọc/grep/sửa file / chạy shell → xem diff → apply/reject.
2. Plan mode: agent lập kế hoạch, người Approve, rồi mới edit.
3. Gắn **model cloud** và/hoặc Auto (harness route fast/mid/strong).
4. Bật MCP stdio (Git, ticket, CI, DB tools, …) theo allowlist workspace.
5. Ủy thác explore / implement / review cho sub-agent, nhận summary.
6. Xem cost/token và audit trail của session.

## Hướng phát triển (sau lõi — backlog, chưa khóa năm 1)

Đã chốt: năm 1 không ôm tab/index/CLI/marketplace. Bổ sung khi lõi ổn. Thứ tự đề xuất:

| Nhóm | Ví dụ |
| --- | --- |
| Context & convention | `@` file/folder, `/` skills, `AGENTS.md` / rules theo path, hooks |
| Modes | Ask / Debug / Review / MultiTask đã gắn runtime (xem `docs/frontend/composer.md`); còn lại: MultiTask chạy sub-agent song song |
| Git & session | commit khi user hỏi, worktree, resume thread |
| CLI | 5ilence CLI kiểu Claude Code, cùng harness với Studio |
| Index codebase | grep/ripgrep trước; embedding/RAG nếu cần sau |
| Editor phụ | Tab autocomplete, LSP đầy đủ — sau năm 1 trừ khi chốt sớm |

Phần này **chưa khóa năm 1**. Có thể thêm/bớt.

## Non-goals (năm 1)

- Fork VS Code; marketplace extension; fleet agent trên cloud VM.
- Control plane đa tenant / session từ xa (chỉ sau khi local ổn).
- Nhồi BMAD/GSD/ECC **nguyên bản vào UI** (kit chỉ dùng khi *build* 5ilence trong Cursor).

Tab autocomplete, RAG mặc định, CLI: **không cấm** — để backlog, không phải job lõi Phase 0.

## NFR Windows (hạng 1)

- ConPTY + PowerShell mặc định; path dài; UTF-16/UTF-8 không vỡ tiếng Việt.
- Sidecar Rust tách process; UI crash không giết agent.
- Permission default = `ask` (remember theo workspace). Không silent YOLO.
- Secret redaction trước khi gửi model.
- Named pipe local-only; không bind LAN.

## Success metrics

| Metric | Mục tiêu Phase 1 | Mục tiêu năm 1 |
| --- | --- | --- |
| Eval pass rate (20 task v0) | ≥ 40% trên 1 model cloud mạnh | ≥ 70% với Auto |
| Latency time-to-first-token | < 2s khi mạng cloud ổn | < 1.5s |
| Cost/task (median) | đo được, log 100% | Auto rẻ hơn strong-only ≥ 30% |
| Tool reliability Windows | edit/grep không lỗi encoding | shell/ConPTY ổn định |

## Principles

UI không gọi model. Mọi sửa file đi qua tool runtime (diff + audit). Mỗi thay đổi harness kèm eval, không “feel better”. Model = cloud (gateway OpenAI-compatible).
