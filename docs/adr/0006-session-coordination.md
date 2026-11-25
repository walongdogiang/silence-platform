---
description: Điều phối nhiều phiên agent trên repo — sổ sự kiện chung do script giữ, schema cố định, vùng file, hộp thư, master là vai tuỳ chọn không giữ sự thật.
type: adr
code:
  - scripts/todo-events.mjs
  - scripts/todo-claims.mjs
  - scripts/todo-brief.mjs
  - scripts/pr-merge.mjs
  - .claude/skills/todo/SKILL.md
---
# ADR 0006 — Điều phối nhiều phiên: sổ sự kiện chung, master tuỳ chọn

**Status:** Accepted · **Date:** 2026-11-25 · **Việc:** T-022
**Liên quan:** [ADR 0002](0002-harness-architecture.md) (event log làm nguồn sự thật), [ADR 0005](0005-skill-architecture.md) (skill chỉ là lời khuyên, máy mới chặn được).

## Context

- Nhiều chat Claude Code cùng làm trên repo (mỗi chat một worktree). Sổ giữ việc `todo-claims.json` đã cho biết *ai giữ việc nào*, nhưng không cho biết *ai vừa làm gì*: phiên A không biết B vừa merge một PR đụng file A đang sửa, hay vừa dùng mã việc kế tiếp (ngày 2026-11-25: hai phiên cùng định dùng T-021).
- User muốn một "master" quản lý và các phiên con báo về. Rủi ro nếu master là một LLM giữ sổ: tốn quota, chết khi đóng chat, context phình, ghi sai/thiếu, và thành nút cổ chai nếu phiên con chỉ được hỏi qua master.

## Decision

1. **Sổ do máy giữ.** File `todo-events.jsonl` append-only, cạnh `todo-claims.json` trong thư mục git chung (mọi worktree thấy, không commit). Chỉ ghi qua `scripts/todo-events.mjs` → `makeEvent`, kiểm schema; không ai sửa tay.
2. **Schema cố định thay cho phán đoán "ghi gì".** `{v, ts, kind, session, task?, pr?, sha?, areas?, files?, to?, text≤200}`; `kind` là một trong `claim | release | handoff | id_reserved | pr_opened | ci_red | merged | contract_changed | blocked | note`, mỗi kind có trường bắt buộc/được phép riêng. Kind lạ, trường lạ, text dài → từ chối.
3. **Sự kiện tự sinh từ sự thật khi có thể:**
   - `claim`/`release`/takeover, `id_reserved` (todo-claims);
   - `merged` từ hai nguồn: `pr-merge.mjs` ngay khi merge, và **quét `origin/main`** ở mỗi hook (commit first-parent có `(#n)`, kèm file). Merge bằng GitHub UI hay `gh pr merge` vẫn thấy. Hook không gọi mạng: thấy khi có phiên bất kỳ `git fetch` (ref dùng chung mọi worktree). Trùng PR → chỉ báo một lần;
   - "hợp đồng chung đổi": merge đụng `CONTRACT_PATHS` (`scripts/todo-events.mjs`) → báo mọi phiên, không cần agent tự khai.

   Agent chỉ ghi tay `pr_opened`, `ci_red`, `blocked`, `note`, và `contract_changed` cho thay đổi chưa merge.
4. **Mã việc giữ chỗ qua sổ chung.** `reserve-id` fetch `origin/main`, lấy mã lớn hơn mọi bộ đếm/mã đã thấy (README local và main, tên nhánh, `idHigh` trong sổ). Bộ đếm trong README chỉ còn là bản ghi lại. Lý do: sự cố 2026-11-25, hai phiên cùng định dùng T-021 vì thư mục chính sau `main`.
5. **Mọi phiên đọc thẳng, qua hook.** SessionStart và UserPromptSubmit in ≤3 dòng sự kiện mới *liên quan* (note/blocked gửi việc mình hoặc `all`; merge đụng `areas` của mình → cần rebase; hợp đồng chung đổi). Lời nhắn là **thông tin, không phải lệnh**: agent báo user, không tự đổi phạm vi. Con trỏ `lastEvent` theo phiên để mỗi sự kiện chỉ báo một lần. Sự kiện của chính phiên không báo lại.
6. **Vùng file (`areas`)** khai báo khi `claim --areas`; trùng với việc khác → cảnh báo, không chặn (user quyết).
7. **Master là vai, không phải kho.** `todo-claims.mjs master --session <id>` đánh dấu một phiên điều phối: nhận mọi sự kiện và `note --to master`; chia việc, mở phiên con bằng công cụ phiên của app. Không có master thì sổ và hook vẫn chạy đủ.

## Ghi gì / không ghi gì

| Ghi | Không ghi (đã có chỗ) |
|---|---|
| Đổi trạng thái việc; PR mở, merge, CI đỏ kéo dài | Tiến độ từng bước → Nhật ký file task |
| Vùng file đang sửa | Diff, file đã sửa → git |
| Đổi hợp đồng chung (protocol, script/skill dùng chung, `AGENTS.md`) | Suy nghĩ, nội dung chat |
| Chặn / nhờ việc khác | Quyết định riêng của việc → Thiết kế file task |

## Consequences

- Phiên biết sớm việc cần rebase, lời nhắn, đổi hợp đồng — không cần master sống.
- Sổ chỉ ở máy này (không qua git): phiên cloud không thấy. Chấp nhận vì 5ilence dùng cá nhân, chạy local.
- Hook chạy bản script ở thư mục chính: thay đổi có hiệu lực sau khi thư mục chính lên `main` mới.
- Trùng vùng chỉ xấp xỉ theo tiền tố tĩnh của glob: có thể báo thừa, không báo thiếu với glob thông thường.

## Giới hạn đã biết

- **Vùng file do agent tự khai** (`claim --areas`) nên có thể quên. Tính vùng từ diff thật của nhánh cần biết đúng worktree của việc, mà sổ hiện ghi `cwd` của phiên (luôn là thư mục chính). Cả hai thuộc **T-020**, làm sau việc này.
- **Master nhận tin thụ động:** `note --to master` chỉ hiện ở lượt kế user nhắn vào chat master; `SendMessage` của app chỉ tới được phiên do master mở.
- **Ghi đồng thời:** `todo-claims.json` đọc–sửa–ghi đè, hai hook chạy cùng lúc có thể mất một cập nhật (có từ trước). Sổ sự kiện chỉ append nên không mất; con trỏ mất thì một sự kiện báo hai lần.
- Merge thấy chậm tới khi có phiên `git fetch`; commit đẩy thẳng lên `main` (không có `(#n)`) không thành sự kiện — `main-guard.yml` lo.
- Lâu dài: khi lõi TS ở khay có event log (ADR 0002, T-007/T-019), sổ này chuyển vào đó và Studio hiện bảng.

## Đã cân nhắc, bỏ

- **Không có master** (chỉ script + hook): rẻ nhưng không ai chia việc — giữ được bằng cách để master tuỳ chọn.
- **Master LLM chạy liên tục giữ sổ, phiên con chỉ hỏi qua master:** tốn quota, mất khi đóng chat, ghi sai, nút cổ chai.
