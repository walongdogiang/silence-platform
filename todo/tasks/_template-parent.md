---
id: T-000
title: Tên việc cha
type: feature          # feature | fix | chore | docs | research
status: todo           # todo | in-progress (khi có con đang làm) | done | dropped
area: []               # gộp vùng của các con
size: L                # việc cha thường là L; mỗi con S/M
model:                 # opus | sonnet — cho pha design của việc cha (tách con)
depends: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

<!--
Việc cha (skill todo → "Việc cha / việc con"): file này là todo/tasks/T-000-slug/README.md.
Không có PR riêng, không claim. Mỗi việc con một file T-000.k-slug.md (mẫu _template.md) cùng thư mục.
Đóng cha trong PR của việc con cuối, khi tiêu chí chung đã đạt. Xoá mục không dùng.
-->

## Mục tiêu

Vì sao làm, xong cả việc thì cái gì đúng (1–3 câu).

## Phạm vi

**Làm:** …
**Không làm:** …

## Thiết kế chung

<!-- Quyết định áp dụng cho mọi con: phương án đã chốt, ràng buộc, thứ tự. Link ADR / docs; không chép lại. -->

## Việc con

<!--
Nguồn sự thật duy nhất của tiến độ. Mỗi dòng một con, theo thứ tự làm; tick trong PR của chính con đó.
Mã con: node scripts/todo-claims.mjs reserve-id --parent T-000 --session <id>
-->

- [ ] T-000.1 Tên con · [chi tiết](T-000.1-slug.md)
- [ ] T-000.2 Tên con · [chi tiết](T-000.2-slug.md) · blocked-by: T-000.1

## Tiêu chí xong

<!-- Tiêu chí chung, kiểm khi con cuối xong. Mỗi dòng: hành vi — kiểm: `lệnh`. Tiêu chí riêng nằm trong file con. -->

- [ ] … — kiểm: `…`
- [ ] (user) …

## Nhật ký

<!-- Chỉ quyết định ảnh hưởng nhiều con; tiến độ từng con nằm trong file con. -->
