---
id: T-038
title: Harness chỉ cộng thêm trên Claude CLI, mục đích clone desktop app
type: docs
status: todo
phase:
area: [docs, core]
size: M
model: opus
depends: []
branch:
pr:
created: 2026-11-27
updated: 2026-11-27
---

## Mục tiêu

Chốt lại mục đích và nguyên tắc kiến trúc trong ADR 0004 theo đúng cách user làm việc: user dùng **Claude CLI trong terminal**, không dùng Claude desktop app. Bối cảnh hiện tại của ADR ghi sai điểm này. `model: opus` vì đây là quyết định kiến trúc, không phải sửa chữ.

Mục đích user chốt (2026-11-27):
1. 5ilence bù những chỗ CLI yếu hơn desktop app.
2. Bám Claude CLI (qua Agent SDK). Harness chỉ **cộng thêm**: không thay vòng agent, tool hay system prompt của Claude, không làm sai lệch cách Claude suy luận và chạy flow.
3. Desktop app có tính năng gì thì 5ilence có bản tương đương, làm theo thứ tự ưu tiên.

## Phạm vi

**Làm (pha design → cổng duyệt):**
- Sửa ADR 0004:
  - Bối cảnh: user dùng CLI, không dùng desktop app.
  - Mục đích: ba ý trên, thay câu "không đuổi tính năng Claude Code".
- Ghi 4 cách hoà giải các điểm mâu thuẫn với nguyên tắc cũ:
  - "Không đuổi tính năng" → vẫn clone, nhưng xếp ưu tiên theo điểm bất tiện user gặp; tính năng chưa dùng vào Later.
  - Harness riêng của desktop (danh sách task, hộp bước tiếp theo, tách session, chapter) → clone bằng cơ chế cộng thêm (`systemPrompt.append`, MCP, hook), kèm test đồng nhất app ↔ terminal.
  - Tính năng cần cloud hay tài khoản Anthropic (session cloud, Remote Control, artifact, connector, lịch chạy trên cloud) → chỉ làm bản cục bộ tương đương.
  - Computer use và điều khiển Chrome → làm sau cùng, user tự bật trong Settings, có Risk Engine và audit riêng.
- Ghi thứ tự ưu tiên khi thêm tính năng: CLAUDE.md → skill/plugin → hook của Claude → MCP riêng → xử lý luồng sự kiện trong app.
- Bảng **tính năng desktop app → bản 5ilence → hiện trạng → ưu tiên**, làm danh mục clone; mỗi dòng chưa có thì đề xuất thành một việc.
- Quyết 4 chỗ adapter Claude (`packages/core/src/backends/claude/`) đang làm Claude trong app khác Claude trong terminal:
  - `settingSources: ["project"]` → nạp thêm `"user"` qua cổng duyệt cấu hình.
  - Kho luật quyền riêng `~/.silence/permissions.yaml` → gộp với file của Claude (`~/.claude/settings.json`, `.claude/settings.local.json`).
  - Danh sách tool viết cứng (`toolMap.ts`, thiếu `AskUserQuestion`, `EnterPlanMode`…) → preset `claude_code`, chỉ tắt đúng tool có lý do.
  - Biến môi trường chỉ giữ theo danh sách (`env.ts`) → giữ toàn bộ, chỉ bỏ biến khoá API và biến của chính app.
- Sửa lộ trình `docs/adapters/migration.md` (Giai đoạn 3 "Bỏ hẳn Claude desktop") cho khớp mục đích mới.

**Không làm:**
- Sửa code adapter: tách thành việc riêng sau khi user duyệt.
- Làm tính năng clone nào: mỗi tính năng một việc.

## Bối cảnh

- Thảo luận chốt mục đích: chat b112d5f5 (2026-11-22 → 2026-11-27).
- Chạm `docs/security/` (kho luật quyền) và có thể cả `AGENTS.md`, nên cần user duyệt ở cổng duyệt.
- Nên làm trước T-006, vì kiểm kê RPC (T-006) và phạm vi T-031/T-032 phụ thuộc các quyết định này.
- Ý tưởng phát sinh từ T-003 (cột pane + tab Xem trước, PR #91) để bảng tính năng tính tới, chưa thành việc riêng:
  - Thẻ dev server kiểu desktop app (chạy/dừng, nút Open vào Xem trước): làm trên lõi mới, sau T-034.
  - Đưa Diff vào cột pane bên phải, giống desktop app.
  - Chia đôi cột pane (trang + log dev server cùng lúc): phụ thuộc Ports/Output đang qua Engine, T-034 xoá Ports nên chỉ xét lại sau khi lõi có quản lý tiến trình.
- Chưa kiểm: danh sách tool đầy đủ của bản CLI hiện tại; SDK xử lý `AskUserQuestion` thế nào; vòng kiểm chứng gửi lỗi cho Claude ra sao; sandbox trên Windows.
