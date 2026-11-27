---
id: T-072
title: Mỗi lượt kết thúc bằng một dòng trạng thái việc (xong / dở / chờ bạn)
type: feature
status: done
phase: verify
area: [agent-kit]
size: S
model: opus
model-build: sonnet
depends: []
branch: feat/T-072-turn-status-line
pr:
created: 2026-11-27
updated: 2026-11-27
---

## Mục tiêu

User không biết việc đã xong chưa hay còn dở, nên phải hỏi lại "xong chưa". Sau việc này, mỗi lượt có làm việc kết thúc bằng một dòng trạng thái có điều kiện rõ ràng.

## Phạm vi

**Làm** (bản rút gọn user chọn 2026-11-27):
- Quy định **Kết thúc lượt** trong `CLAUDE.md`: 🏁 / ⏳ / ⛔ kèm điều kiện "xong" cho việc trong `todo/` và việc nhờ trong chat.
- Thẻ **5. Dòng trạng thái** trong `.claude/skills/todo/cards.md`.
- Hook `heartbeat` (`scripts/todo-claims.mjs` → `holdingLine`) in mỗi tin nhắn: phiên đang giữ việc nào, kèm tên.

**Không làm:** hook Stop chặn khi thiếu dòng hoặc báo xong sai (tốn code và một lượt model mỗi lần chặn) → đã ghi vào Ideas. Hook "ngoài vùng" vẫn thuộc T-071.

## Thiết kế

- **Đã chốt:** quy định chữ + dòng nhắc ~30 token mỗi tin, vì việc ít quan trọng và user muốn tốn ít usage nhất.
- **Đã thử, bỏ:** hook Stop đối chiếu 🏁 với file việc và tự tính n/m — chắc hơn nhưng tốn hơn phần lợi.

## Tiêu chí xong

- [x] Phiên giữ việc → `heartbeat` in dòng nhắc kèm tên việc; không giữ → không in — kiểm: `npm run test:todo` → 30 pass
- [x] Docs và rule hợp lệ — kiểm: `npm run check:docs` → OK 26 file; `npm run check:rules` → OK 6 rule
- [ ] (user) Ở việc kế tiếp, tin cuối mỗi lượt có làm việc có dòng 🏁/⏳/⛔

## Nhật ký

### 2026-11-27 · Opus
- Quyết định: làm trước T-071 dù từng ghi `blocked-by: T-071`, vì bản rút gọn không đụng hook `todo-hook.mjs`; user chọn làm ngay.
