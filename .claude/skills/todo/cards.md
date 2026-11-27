# Thẻ trình bày cho user

Dùng khi agent trình bày việc, review đóng việc, hỏi dọn worktree, hoặc báo xong. Mọi thẻ theo một khung, để user quen một kiểu đọc.

## Nguyên tắc viết

- **Dòng đầu là kết luận**: đọc mỗi dòng đầu cũng biết chuyện gì, cần làm gì.
- **Thứ tự mục cố định**: Tóm tắt → mục nội dung → Agent sẽ làm → Bạn chọn. Không đổi tên mục, không đảo thứ tự.
- **Gạch đầu dòng ngắn**: mỗi mục tối đa 3 gạch, mỗi gạch một dòng, một ý.
- **Không lặp**: ý đã ở mục này thì không nhắc ở mục khác.
- **Không bịa**: thiếu thông tin thì ghi "chưa rõ"; mục không có nội dung thì bỏ hẳn.
- **Từ thường trước, mã sau**: tên file, lệnh chỉ khi user cần dùng.
- **Câu hỏi cuối có lựa chọn đánh số**, để user trả lời một chữ. Thẻ không chờ quyết định thì không có câu hỏi.
- **Icon chú ý** theo `CLAUDE.md` → **Icon chú ý**: `⚠️ **Lưu ý**`, `👉 **Bạn làm**`, `➡️ **Tiếp:**`, `❓ **Bạn chọn:**`. Biểu tượng ở tiêu đề thẻ (📋 ✅ 🧹 🏁) giữ nguyên.
- Viết bằng Markdown thật (in đậm, gạch đầu dòng, bảng), không bọc trong khối code.

## Khung chung

```
**[biểu tượng] Loại thẻ · Mã · Tên ngắn**
Một dòng tóm tắt ý chính

**Mục nội dung** (1–4 mục, gạch đầu dòng)

**Agent sẽ làm** (bước đánh số, tối đa 4)

❓ **Bạn chọn:** 1) … 2) …
```

## 1. Thẻ việc — trình bày việc tiếp theo

Nguồn: Vấn đề và Xong thì ← Mục tiêu, Bối cảnh, Tiêu chí xong (nếu có); Phạm vi ← Phạm vi; Chi phí và rủi ro ← `size`, `model`, `area`, file trong `highRiskPaths` (`.claude/git-policy.json`).

```
**📋 Việc tiếp theo · T-023 · Chống các chat đụng nhau (phần 2)**
Hỏi user trước khi một chat sửa file mà chat khác đang sửa dở.

**Vấn đề**
- Hai chat có thể sửa cùng một file mà không biết nhau.
- T-020 mới chặn commit, chưa chặn sửa file.

**Xong thì**
- Sửa trùng file → Claude Code dừng lại hỏi, có tên chat kia và giờ sửa.

**Phạm vi**
- Làm: máy tự ghi chat nào sửa file nào; hỏi khi trùng; bắt cả sửa bằng shell.
- Không làm: chặn hẳn; phát hiện hai file khác nhau mâu thuẫn ý.

**Chi phí và rủi ro**
- Cỡ M, 1–3 phiên Opus.
- Sửa settings (rủi ro cao) → user duyệt trước khi merge.

**Agent sẽ làm**
1. Đọc code liên quan, đưa phương án (pha design).
2. Lập kế hoạch và tiêu chí xong → hỏi ở cổng duyệt.
3. User duyệt → tự làm tới merge, báo kết quả.

❓ **Bạn chọn:** 1) Bắt đầu 2) Để sau 3) Xem việc khác
```

## 2. Review đóng việc — khi user nói "xong" / "đóng"

Kiểm trước khi viết: tiêu chí đã tick kèm kết quả; bước Kế hoạch chưa tick; thay đổi chưa commit; PR chưa merge; mục Phát sinh. Dòng tóm tắt là kết luận "Nên đóng" hoặc "Chưa nên đóng" kèm lý do chính.

```
**✅ Review đóng việc · T-020 · Chủ worktree theo chat**
Nên đóng: 8/8 tiêu chí đạt, không còn gì dở.

**Tiêu chí**
- ✅ 7 tiêu chí kiểm bằng test (29 pass).
- ✅ User đã kiểm tay: chat B commit bị chặn.

**Còn dở**
- Không.

⚠️ **Lưu ý: rủi ro nếu đóng**
- Chưa thử hook ở chế độ Bypass permissions.

**Phát sinh (đề xuất thêm vào Later)**
1. Lời báo chặn ghi tên chat và việc đang làm — dễ nhận ra chat chủ.
2. Thử hook khi bật Bypass — chắc không bị lách.

**Agent sẽ làm**
1. Chuyển việc sang DONE, file vào archive.
2. Thêm các mục Phát sinh user chọn vào Later.
3. Mở PR, merge khi CI xanh.

❓ **Bạn chọn:** 1) Đóng + thêm cả hai 2) Đóng, chỉ thêm số … 3) Chưa đóng
```

## 3. Dọn worktree — đầu phiên có thư mục thừa

Kiểm từng thư mục trước khi đánh giá: git còn nhận là worktree không (`git worktree list`); có thay đổi chưa commit không (`git status --porcelain`); có commit chưa nằm trên `origin/main` không; có chat nào giữ không (sổ chủ worktree). Còn bất kỳ thứ gì chưa lên main → đánh giá **Giữ**, kèm lý do. Chỉ xoá đúng thư mục user chọn.

```
**🧹 Dọn worktree · 3 thư mục**
2 thư mục xoá an toàn, 1 thư mục nên giữ.

| # | Thư mục | Tình trạng | Đánh giá |
|---|---|---|---|
| 1 | `todo-owner-msg` | Rỗng; PR #81 đã merge | ✅ Xoá được |
| 2 | `5ilence-wt2` | Sạch, commit đã có trên main | ✅ Xoá được |
| 3 | `5ilence-wip` | 3 file chưa rõ nguồn | ⚠️ Giữ, user xem trước |

**Agent sẽ làm**
1. Xoá đúng các thư mục user chọn.
2. Kiểm lại `git worktree list`, báo kết quả.

❓ **Bạn chọn:** 1) Xoá 1 và 2 2) Xoá số … 3) Giữ hết
```

## 4. Báo xong — tin cuối mỗi việc

Không có câu hỏi, trừ khi có Phát sinh chờ user chọn thêm vào Later. Mục rỗng thì bỏ.

```
**🏁 Đã xong · T-xxx · Tên việc**
Đã merge PR #n.

👉 **Bạn làm**
- Pull thư mục chính (hook / settings / skill vừa đổi): `git -C <thư mục chính> pull --ff-only`
- Kiểm tay: …

**Phát sinh (đề xuất thêm vào Later)**
1. … — vì sao

❓ **Bạn chọn:** 1) Thêm cả 2) Thêm số … 3) Không thêm
```

## 5. Dòng trạng thái — cuối mỗi lượt có làm việc

Một dòng ở cuối tin; tin có dòng ❓ **Bạn chọn** thì đặt dòng này ngay trước nó. Điều kiện từng loại: `CLAUDE.md` → **Kết thúc lượt**. Thẻ 4 đã mở bằng 🏁 thì không cần thêm dòng này.

```
🏁 Đã xong T-072: PR #97 đã merge.
➡️ **Tiếp:** mở chat mới cho T-039, chọn `/model opus` trước (việc thiết kế).
⏳ Đang dở T-072: 2/3 tiêu chí · bước kế: chờ CI của PR #97 rồi merge.
⛔ Chờ bạn T-072: duyệt merge PR #97 (đụng CLAUDE.md)?
```

- Dòng `➡️ **Tiếp:**` luôn tách riêng, ngay sau 🏁, và chỉ có khi mang thông tin (`CLAUDE.md` → **Kết thúc lượt**).
- `n/m` đếm ô đã tick trong **Tiêu chí xong** của file việc, không ước lượng.
