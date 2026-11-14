# Phase 0 spike: sandbox Windows

Code thử nghiệm để quyết go/no-go cho sandbox (xem plan Phase 0). Engine không dùng phần này. Xoá thư mục `spike/` và `examples/spike.rs` khi backend thật đã xong.

1. Build (user thường): `.\scripts\cargo-msvc.bat build -p silence-sandbox --example spike`
2. Mở PowerShell **Administrator**, đứng ở root repo, chạy `.\crates\sandbox\spike\setup.ps1`. Script tạo user ẩn `silence-sbx`, thư mục `D:\5ilence-spike\{ws,other,tmp}`, ACE cho SID 5ilence trên `ws`/`tmp`, và firewall rule chặn outbound của user đó (trừ loopback).
3. Mở PowerShell **thường**, chạy `.\crates\sandbox\spike\run.ps1`. Kết quả nằm ở `spike\result.txt`.
4. Gỡ: chạy `.\crates\sandbox\spike\teardown.ps1` bằng Admin.

## Kết quả (2026-11-15, Windows 10 Pro 19045, user thường, firewall bật): GO

| Kiểm | Kết quả |
|---|---|
| Path A (`CreateProcessAsUserW` trực tiếp bằng token `silence-sbx`) | ❌ 1314: user thường thiếu `SeAssignPrimaryTokenPrivilege`. **Bắt buộc dùng runner** |
| Capability SID làm restricting SID | ❌ `CreateRestrictedToken` trả về `E_INVALIDARG` |
| SID tổng hợp (± logon SID, ± `RESTRICTED`) | ❌ process chết lúc khởi động `0xC0000142` |
| **SID tổng hợp + logon SID + `Everyone`, cờ `WRITE_RESTRICTED\|LUA_TOKEN\|DISABLE_MAX_PRIVILEGE`, default DACL cấp cho các SID đó, user và SYSTEM** | ✅ chạy được, cả có và không có ConPTY |
| `TEMP` thuộc profile `silence-sbx` | ❌ PowerShell rơi vào ConstrainedLanguage. **Phải đặt TEMP/TMP trỏ vào thư mục có ACE** |
| Ghi workspace, ghi TEMP sandbox | ✅ |
| Ghi `D:\5ilence-spike\other` (`D:\` cấp Modify cho Authenticated Users) | ✅ bị chặn |
| Ghi `C:\Users\Public` | ✅ bị chặn |
| Đọc profile của user thật | ✅ bị chặn |
| Internet (`example.com`) | ✅ bị chặn. Còn phải xác nhận nguyên nhân là firewall rule chứ không phải lỗi DNS/proxy (Phase 3) |
| Loopback tới cổng Engine | ⚠️ kết nối được, đúng như dự kiến. **Phase 1 (RPC token) là điều kiện bắt buộc** |
| `git`, `node` (cài cho toàn máy) | ✅ |
| `cargo` (nằm trong profile user thật) | ❌ không thấy. Cần `extra_read` + `PATH`, hoặc `CARGO_HOME`/`RUSTUP_HOME` riêng |
| UTF-8 | ✅ con xuất byte UTF-8 đúng. Chữ hiển thị lỗi chỉ do console của `run.ps1` dùng OEM codepage |
| Overhead logon + runner + `cmd` | 113–136 ms (mục tiêu < 150 ms). PowerShell khởi động thêm 300–600 ms, giống hiện nay |

> **Cập nhật Phase 3:** token write-restricted ở trên (SID tổng hợp + logon + Everyone) làm Schannel trả `SEC_E_NO_CREDENTIALS`, nên curl.exe, cargo và .NET mất TLS. Hiện sandbox dùng token **deny-only** (`Authenticated Users`, `INTERACTIVE`); xem `src/win/token.rs` và docs/security/permissions.md.

Ghi chú khi cài:
- `icacls` từ chối SID không ánh xạ tới tài khoản nào. Dùng `Set-Acl` với `SecurityIdentifier`, hoặc Win32 `SetEntriesInAclW`.
- Vì `Everyone` nằm trong restricting SID, mọi chỗ mà `Everyone` có quyền ghi thì sandbox cũng ghi được. `status()` nên kiểm các thư mục phổ biến và ghi rõ giới hạn này trong docs.

Ma trận kiểm:
- **Path A:** `LogonUserW` → token restricted → `CreateProcessAsUserW` trực tiếp. Dự đoán lỗi 1314, vì user thường không có `SeAssignPrimaryTokenPrivilege`.
- **Path B:** `CreateProcessWithLogonW` khởi động runner chạy dưới user sandbox. Runner hạ token của chính nó (write-restricted, SID 5ilence), rồi spawn lệnh, có hoặc không có ConPTY. Các mục kiểm: UTF-8, ghi workspace, ghi thư mục khác trên `D:\` (phải lỗi), ghi `C:\Users\Public` (phải lỗi), đọc profile user thật (phải lỗi), ra internet (phải lỗi), loopback tới cổng Engine (ghi nhận), toolchain (`git`/`node`/`cargo`), và thời gian mỗi lệnh.
