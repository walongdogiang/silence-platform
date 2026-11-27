---
name: phan-bien
description: Phản biện một ý tưởng, đề xuất hay quyết định (của user hoặc của chính agent) trước khi làm — kết luận trước, chỉ chỗ yếu có dữ kiện, đưa hướng rẻ hơn hoặc bác tiền đề. Dùng khi user gõ /phan-bien, hỏi "có nên…", nhờ đánh giá / review / phản biện ý tưởng hay đề xuất, hoặc nhờ tự review đề xuất vừa đưa.
---

# Phản biện

Mục tiêu: giúp user quyết định đúng với ít công nhất, không phải tỏ ra kỹ lưỡng.

## Quy trình

1. **Nắm vấn đề thật.** Nhắc lại ý tưởng và vấn đề nó muốn giải trong 1–2 câu. Mơ hồ tới mức đổi kết luận → hỏi đúng một câu rồi dừng.
2. **Dữ kiện trước khi chê.** Xem cái đã có (repo, `todo/`, skill, hook, memory); tra nguồn chính thức chỉ khi kết luận phụ thuộc vào nó. Mỗi phản bác gắn một dữ kiện; chỗ đoán ghi "(suy đoán)".
3. **Đánh giá như ý tưởng của người lạ** — không nghiêng theo việc user thích hay chính mình đề xuất:
   - Dạng mạnh nhất: ý tưởng đúng ở đâu.
   - Pre-mortem: giả sử 3 tháng sau nó hỏng — lý do khả dĩ nhất.
   - Đảo câu hỏi: vấn đề thật có cách giải nào không cần ý tưởng này, kể cả "không làm"?
4. **Tối đa 3 phản bác**, xếp theo hậu quả × khó hoàn tác. Ý tưởng tốt thì nói thẳng; không bịa cho đủ.
5. **Cắt.** Từng phần của đề xuất: bỏ đi còn đạt mục tiêu không? Còn → bỏ.
6. **Hướng đi:** chỉ hướng thật sự khác nhau, luôn có hướng rẻ nhất; có hướng bác tiền đề thì đưa. Mỗi hướng: được gì, tốn gì (công, usage), rủi ro.

## Đầu ra

Thứ tự cố định; icon theo `CLAUDE.md` → **Icon chú ý**.

- **Kết luận** (dòng đầu): nên làm / làm khác đi / không nên · độ chắc cao/vừa/thấp · vì sao trong một câu.
- **Tiêu chí và giả định** đã dùng.
- **Phản bác** (≤3), mỗi cái gắn dữ kiện.
- **Điều phải đúng để thành công** + **cách thử rẻ nhất**.
- **Hướng đi**: gạch đầu dòng, tên in đậm, khuyến nghị đứng đầu.
- `❓ **Bạn chọn:**` khi cần user quyết.

## Khi user bảo "review lại"

Chỉ đổi khi có dữ kiện mới hoặc tìm ra lỗi cụ thể; nói rõ đổi gì, vì sao. Không có → "giữ nguyên" kèm lý do. Không thêm tính năng để tỏ ra đã review.

## Phản biện độc lập (tuỳ chọn, tốn hơn)

Khi user nói "kỹ" / "độc lập", hoặc quyết định khó hoàn tác (kiến trúc, bảo mật, xoá dữ liệu): giao một subagent mới, chỉ đưa ý tưởng + dữ kiện, không đưa kết luận của mình; gộp kết quả, ghi chỗ hai bên khác nhau.
