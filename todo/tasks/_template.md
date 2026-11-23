---
id: T-000
title: Tên việc
type: feature          # feature | fix | chore | docs | research
status: todo           # todo | in-progress | blocked | done | dropped
phase:                 # design | plan | build | verify — điền khi bắt đầu; size S bắt đầu ở build
area: []               # studio | core | engine | docs | ci | agent-kit
size: M                # S (<1 phiên) | M (1–3 phiên) | L (nên tách)
depends: []            # vd [T-012]
branch:                # điền khi bắt đầu
pr:                    # điền khi mở PR
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

<!--
Chi tiết tăng dần (skill todo → "Chi tiết theo vòng đời"):
- Lúc thêm: Mục tiêu + Phạm vi sơ bộ.
- Pha design: + Đọc trước, Bối cảnh, Tái hiện/Thiết kế (theo type), Câu hỏi mở.
- Pha plan: + Kế hoạch, Tiêu chí xong.
- Pha build/verify: tick bước + tiêu chí, ghi Nhật ký.
Xoá mục không dùng; không để mục rỗng.
-->

## Mục tiêu

Vì sao làm, xong thì cái gì đúng (1–3 câu).

## Phạm vi

**Làm:** …
**Không làm:** …

## Đọc trước

<!-- Điểm vào cụ thể: file → hàm, mục spec, rule. Để phiên sau khỏi phải tìm lại. -->

## Bối cảnh

<!-- Link ADR / docs / việc liên quan; không chép lại nội dung. -->

## Tái hiện

<!-- Chỉ type = fix: các bước · mong đợi · thực tế. -->

## Thiết kế

<!-- type = feature / research: phương án a/b/c · **Đã chốt:** … vì … · Ràng buộc không được phá: … -->

## Câu hỏi mở

<!-- Việc chờ user quyết. Gặp câu hỏi ở đây thì dừng lại hỏi, không đoán. -->

## Kế hoạch

<!-- Bước nhỏ, mỗi bước: việc · file · cách kiểm. Bước khó ghi "(cần Opus: lý do)". -->

1. [ ] …

## Tiêu chí xong

<!-- Chốt với user trước khi code. Mỗi dòng kiểm được; tick kèm chứng cứ, vd: - [x] vitest xanh (npm test, 214 pass). Hơn ~7 dòng thì tách việc. -->

- [ ] Code + test theo phạm vi (AGENTS.md → Test theo phạm vi)
- [ ] Docs/spec/rule cập nhật nếu đổi hành vi
- [ ] PR đã merge

## Nhật ký

<!-- Mỗi phiên dở dang: ### YYYY-MM-DD · pha … · model … rồi Đã làm / Nhánh-PR / Vướng / Bước kế. -->
