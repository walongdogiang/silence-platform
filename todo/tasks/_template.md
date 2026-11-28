---
id: T-000
title: Tên việc
type: feature          # feature | fix | chore | docs | research
status: todo           # todo | in-progress | blocked | done | dropped
phase:                 # design | plan | build | verify — điền khi bắt đầu
area: []               # studio | core | engine | docs | ci | agent-kit
size: M                # S (<1 phiên) | M (1–3 phiên) | L (nên tách)
model:                 # opus | sonnet — tối thiểu cho design/plan; trống = suy từ type/size (skill todo → Model)
model-build:           # tuỳ chọn, model tối thiểu cho build/verify; trống = như model
depends: []            # vd [T-012]
branch:                # <type>/T-000-slug — điền khi bắt đầu
pr:                    # điền khi mở PR
created: YYYY-MM-DD
updated: YYYY-MM-DD
---

<!--
Chi tiết tăng dần (skill todo → "Chi tiết theo vòng đời"):
- Lúc thêm: Ý bạn + Mục tiêu + Phạm vi sơ bộ.
- Pha design: + Đọc trước, Bối cảnh, Tái hiện/Thiết kế (theo type), Câu hỏi mở.
- Pha plan: + Kế hoạch, Tiêu chí xong → CỔNG DUYỆT (user duyệt một lần cả thiết kế, kế hoạch, tiêu chí).
- Sau cổng duyệt: agent tự làm tới merge; ghi Phát sinh và Nhật ký.
Xoá mục không dùng; không để mục rỗng.
-->

## Ý bạn

<!--
Vì sao user muốn việc này — để đọc lại là nhớ. Ghi lúc thêm việc, từ chính cuộc trao đổi; không đi tìm lại chat cũ.
- Mỗi dòng: 👤 (user) hoặc 🤖 (agent) + **hành động** in đậm + nội dung.
  Hành động 👤: Hỏi · Yêu cầu · Chọn · Bác · Muốn. Hành động 🤖: Trả lời · Đề xuất · Cảnh báo.
- Ngoặc kép chỉ cho câu nguyên văn của user; ý tóm lại thì không ngoặc kép.
- 3–6 dòng, đủ ý user đã nêu. Dòng cuối: chat gốc · ngày. Đổi ý sau này → thêm dòng mới có ngày, không sửa dòng cũ.
- Việc agent gom từ lộ trình/backlog, user không tự nêu → một dòng link về quyết định gốc.
-->

👤 **Muốn:** "…"
🤖 **Đề xuất:** …
👤 **Chọn:** …
Nguồn: [tên chat](#local_…) · YYYY-MM-DD

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

<!-- type = feature / research: phương án a/b/c · **Đã chốt:** … vì … · **Đã thử, bỏ:** … vì … · Ràng buộc không được phá: … -->

## Câu hỏi mở

<!-- Việc chờ user quyết. Câu hỏi chặn bước đang làm thì dừng lại hỏi, không đoán. -->

- [ ] …

## Kế hoạch

<!-- Bước nhỏ, mỗi bước: việc · file → hàm · cách kiểm. fix: bước 1 là test đỏ tái hiện lỗi. -->

1. [ ] …

## Tiêu chí xong

<!--
Mỗi dòng: hành vi — kiểm: `lệnh` (hoặc chỗ xem cụ thể). Tick kèm kết quả: - [x] … — kiểm: `npm test …` → 214 pass
(user): user tự kiểm tay; không chặn merge trừ khi ghi (user, chặn). Hơn ~7 dòng thì tách việc.
-->

- [ ] … — kiểm: `…`
- [ ] (user) …

## Phát sinh

<!-- Việc thấy được ngoài phạm vi: ghi vào đây, không ngắt user. Lúc đóng việc, đề xuất đưa vào Later. -->

## Nhật ký

<!--
Chỉ ghi điều git và Kế hoạch không cho biết. Ghi khi: xong một bước, chốt quyết định, một cách thử hỏng, trước khi dừng.
### YYYY-MM-DD HH:MM · bước N · Opus|Sonnet
- Dở: …  - Quyết định: … vì …  - Đã thử, bỏ: …  - Phát hiện: …  - Bước kế: …
(chỉ những dòng có nội dung; >~40 dòng thì gộp mục cũ thành "Tóm tắt tới nay")
-->
