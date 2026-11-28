---
id: T-074
title: Adapter Claude chạy như Claude trong terminal (4 chỗ lệch)
type: feature
status: todo
phase:
area: [core, studio]
size: M
model: opus
model-build:
depends: [T-038]
branch:
pr:
created: 2026-11-28
updated: 2026-11-28
---

## Ý bạn

- 👤 **Hỏi:** 5ilence chạy qua Claude CLI, có bù được những chỗ CLI yếu hơn desktop app không
- 🤖 **Đề xuất:** bám CLI, chỉ cộng thêm harness, bù chỗ yếu bạn gặp hằng ngày
- 👤 **Muốn:** 5ilence bù chỗ yếu của CLI, bám CLI + harness, và "Desktop app có gì thì 5ilence cũng clone về như vậy" — "đây là mục đích tôi làm app này"
- 🤖 **Cảnh báo:** có 4 chỗ ngược mục đích cũ; trong đó adapter đang chạy khác Claude trong terminal ở 4 điểm
- 👤 **Chọn:** theo đề xuất → chốt ở T-038 (ADR 0004); việc này là phần code
- Nguồn: chat «App như harness của Claude CLI» (`local_18d3a694`) · 2026-11-27

## Mục tiêu

Sửa code adapter Claude (`packages/core/src/backends/claude/`) theo 4 quyết định ở ADR 0004 (T-038) để Claude trong 5ilence chạy như Claude trong terminal, trước khi T-033 bật lõi mặc định. `model: opus` vì đụng quyền và bảo mật.

## Phạm vi

- `settingSources`: `["user","project","local"]`; từ chối duyệt cấu hình repo → `["user"]`.
- Risk Engine đọc luật quyền trong `~/.claude/settings.json` và `.claude/settings.local.json`; "Luôn cho phép" ghi vào `.claude/settings.local.json`; file settings Claude vào mục tiêu `POLICY_TAMPER`.
- `tools`: preset `claude_code` + `disallowedTools` có lý do từng tên; UI trả lời `AskUserQuestion` trong Studio.
- `env`: giữ toàn bộ, bỏ `AUTH_VARS` và biến của app chủ; test init `tools` không có tool của app chủ.
- Spike trước: hook trả `allow` thì `AskUserQuestion` còn tới `canUseTool` không; `EnterPlanMode` đi đường nào.
- Quyết định gốc: `docs/adr/0004-backend-adapters.md` (Decision 6), `docs/adapters/claude-sdk.md`, `docs/security/permissions.md`.
