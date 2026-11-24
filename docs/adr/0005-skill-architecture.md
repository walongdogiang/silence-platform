---
description: Kiến trúc skill cá nhân — 4 tầng theo cách nạp, đơn vị là chủ đề, mdm/skm là việc bảo trì, vòng đời có cổng duyệt, global qua plugin; ánh xạ sơ đồ agent-srule Trang-3.
type: adr
status: draft
code:
  - .claude/skills/todo/SKILL.md
  - .claude/skills/task-git/SKILL.md
  - .claude/rules/security-permissions.md
  - scripts/check-rules.mjs
  - scripts/check-docs-meta.mjs
---
# ADR 0005 — Kiến trúc skill cá nhân

**Status:** Proposed · **Date:** 2026-11-25
**Nguồn gốc:** sơ đồ `agent-srule.drawio`, Trang-3 (file của user trên Google Drive).
**Liên quan:** [ADR 0004](0004-backend-adapters.md) (harness chuyên môn hoá Claude Code).

## Context

- Sơ đồ Trang-3 liệt kê khoảng 20 khối: `AI Prompt` → Skills / Code / Docs; Environment, Doc, Code, Master, Question, Research, Log/Backup, Training, Apps, Test, Security, Operation, Naming, Process Skills; hai khối quản lý `mdm` (md) và `skm` (skills).
- Vấn đề của sơ đồ:
  - Trộn 3 trục phân loại trong một danh sách phẳng: theo lĩnh vực (Code, Doc, Apps, Environment), theo hoạt động (Research, Question, Test, Training), xuyên suốt (Master, Naming, Security, Log, Operation, Process).
  - Trùng nhau: Log/Backup và Operation; Master và `skm`; Naming và `mdm`; Test và một phần Question.
  - Coi mọi thứ là skill. Nhưng skill chỉ là lời khuyên: model có thể không nạp, hoặc nạp mà không làm theo.
  - "Tích luỹ theo thời gian" chưa có cơ chế.
- Tài liệu tham khảo (mục **Nguồn**):
  - Claude Code tách CLAUDE.md (luôn nạp), skill (nạp khi cần), subagent (context riêng), hook (chạy chắc chắn). Slash command đã gộp vào skill.
  - Context là tài nguyên hữu hạn, nên nạp đúng lúc thay vì nạp sẵn.
  - Nghiên cứu 2025–2026: skill do LLM tự viết thường không giúp, skill do người chọn lọc thì giúp rõ. Skill thừa làm agent phân tâm. Eval là nút thắt lớn nhất.

## Decision

### Bốn tầng theo cách nạp

Phân loại theo **lúc nào được nạp và ai bảo đảm nó xảy ra**, không theo "tri thức hay năng lực".

| Tầng | Cách nạp | Ai bảo đảm | Công cụ Claude Code |
| --- | --- | --- | --- |
| Luôn nạp | Mọi phiên, hoặc khi đụng file khớp đường dẫn | Model đọc | `CLAUDE.md`, `AGENTS.md`, `.claude/rules/` |
| Nạp khi cần | Theo `description`, hoặc user gõ `/tên` | Model chọn | Skill (model tự gọi hoặc chỉ user gọi) |
| Cô lập | Context riêng, trả kết quả về phiên chính | Model ở phiên con | Subagent, skill chạy ở context fork |
| Cưỡng chế | Theo sự kiện hoặc lịch | Code | Hook, script, CI, Risk Engine, `permissions.deny` |

Quy tắc chọn tầng:
- Điều **bắt buộc** hay **bị cấm** → Cưỡng chế. Không dựa vào skill.
- Điều đúng trong mọi phiên và ngắn → Luôn nạp. `CLAUDE.md` dưới 200 dòng; dài thì tách sang rules theo đường dẫn.
- Cách làm một việc cụ thể → Nạp khi cần. `SKILL.md` dưới 500 dòng, chi tiết để ở file phụ.
- Việc cần góc nhìn độc lập hoặc đọc rất nhiều → Cô lập.

### Đơn vị quản lý là chủ đề

Một chủ đề (ví dụ Doc) có thể có mảnh ở nhiều tầng: quy ước ở Luôn nạp, cách viết ở Nạp khi cần, kiểm tra ở Cưỡng chế. Không ép mỗi khối thành đúng một skill. Mẫu chuẩn: **hook hoặc script phát hiện, skill chỉ cách sửa**.

### mdm và skm là việc bảo trì, không phải tầng

- **mdm**: giữ docs, memory, rules đúng và gọn. Có trách nhiệm giữ bảng thuật ngữ (Naming).
- **skm**: giữ skills, subagents, hooks đúng và gọn. Thay cho Master Skills.
  - Phần máy làm được (trùng tên, `description` trùng nhau, vượt trần, thiếu eval) → script ở tầng Cưỡng chế, mở rộng từ `check:rules`.
  - Phần cần đánh giá → skill rà soát, chỉ user gọi.

### Vòng đời có cổng duyệt

```
Ghi nhận (audit log, phiên làm việc)
  → Đề xuất (agent viết nháp skill hoặc sửa skill)
  → User duyệt            ← bắt buộc; agent không tự sửa skill đang dùng
  → Eval (2–3 tình huống: có nạp đúng lúc không, kết quả có đúng không)
  → Dùng ở project
  → Nâng lên global (khi đã có ích ở ≥ 2 project)
  → Rà soát định kỳ / loại bỏ
```

### Giới hạn số lượng và loại bỏ

- Trần: khoảng **15–20 skill global**, vì `description` của mọi skill luôn nằm trong context.
- Loại bỏ khi: không được dùng sau một thời gian (mặc định 8 tuần), trùng skill khác, hoặc model đã làm tốt mà không cần nó.

### Global và Project

- Project: `.claude/skills/`, `.claude/rules/` trong repo.
- Global: gom thành **một plugin cá nhân** (skills, subagents, hooks) cài cho mọi project. Nâng cấp = chuyển từ repo sang plugin.
- Dữ liệu để rà soát: ghi skill nào được nạp trong phiên nào (audit log của 5ilence).

## Ánh xạ Trang-3

Ký hiệu: ✅ đã có · 🟡 có một phần · ⬜ chưa có.

| Khối | Luôn nạp | Nạp khi cần | Cô lập | Cưỡng chế | Hiện trạng |
| --- | --- | --- | --- | --- | --- |
| Code Skills | Rules theo đường dẫn | | | | ✅ `rust-harness`, `frontend-*`, `protocol` |
| Environment | Stack và lệnh (`AGENTS.md`) | Cài đặt, sửa lỗi môi trường | | | 🟡 |
| Doc Skills | Quy ước frontmatter | Cách viết docs | | `check:docs` | 🟡 thiếu "cách viết" |
| Naming | Bảng thuật ngữ (mdm) | | | | 🟡 mới có mục "Tên sản phẩm" |
| Process | | `todo`, `task-git` (user gọi) | | | ✅ |
| Apps Skills | | Một skill cho mỗi app | | | ⬜ xem câu hỏi mở |
| Training | | Skill giải thích (user gọi) | | | ⬜ xem câu hỏi mở |
| Research | | | Subagent tìm kiếm, lưu kết quả về mdm | | 🟡 có `deep-research`, thiếu bước lưu |
| Question | | | Subagent phản biện thiết kế, kế hoạch | | ⬜ `/code-review` chỉ cho code |
| Test | | | Subagent viết test | CI, test theo phạm vi | ✅ CI · ⬜ subagent |
| Security | Rule `security-permissions` | | | Risk Engine, `permissions.deny`, pre-push | ✅ |
| Log/Backup + Operation (gộp) | | | | Audit log, backup theo lịch | 🟡 chưa backup memory/docs ngoài git |
| Master (tách đôi) | | Skill rà soát (skm) | | Script kiểm trùng, xung đột | 🟡 mới có `check:rules` |

Bỏ khỏi cây: `AI Prompt` (điểm vào phiên), các nút nhóm Skills / Code / Docs (được thay bằng 4 tầng).

Kết quả: còn khoảng 8–10 skill hoặc subagent thật, dưới trần.

## Việc cần xây (theo thứ tự)

1. Subagent **Question**: phản biện thiết kế và kế hoạch, context sạch.
2. Mở rộng `check:rules` thành kiểm cả skills: trùng tên, trùng `description`, vượt trần, thiếu eval.
3. **Plugin global** cá nhân; chuyển Research, Question, Process sang đó.
4. Backup memory và docs ngoài git, theo lịch.
5. Apps và Training, sau khi trả lời câu hỏi mở.

Mỗi việc thêm vào `todo/` khi bắt đầu, không làm hết một lần.

## Consequences

- Rõ skill mới đặt ở đâu và dùng công cụ nào.
- Điều bắt buộc không còn phụ thuộc model có làm theo hay không.
- Thêm chi phí bảo trì: eval cho từng skill, rà soát định kỳ.
- Cổng duyệt làm vòng học chậm hơn, nhưng tránh thư viện bị bẩn.

## Câu hỏi mở

- **Apps Skills**: "app" là các project của user (5ilence, …), hay các ứng dụng user dùng (draw.io, VS Code, …)? Nếu là project thì skill nằm trong từng repo, không global.
- **Training Skills**: viết hướng dẫn cho người khác đọc, hay giải thích cho chính user khi học? Tạm xếp ưu tiên thấp vì 5ilence chỉ dùng cá nhân.
- Ngưỡng loại bỏ (8 tuần) và trần (15–20) là số khởi điểm, chỉnh sau khi có dữ liệu dùng thật.

## Nguồn

- [Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [Steering Claude Code: CLAUDE.md, skills, hooks, subagents](https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more)
- [Claude Code features overview](https://code.claude.com/docs/en/features-overview)
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Ratchet (arXiv 2605.22148)](https://arxiv.org/html/2605.22148v1), [SkillsVote (arXiv 2605.18401)](https://arxiv.org/pdf/2605.18401), [Dynamic Agent Skills survey (arXiv 2607.10113)](https://arxiv.org/abs/2607.10113), [SoK: Agentic Skills (arXiv 2602.20867)](https://arxiv.org/html/2602.20867) — mới đọc phần tóm tắt.
