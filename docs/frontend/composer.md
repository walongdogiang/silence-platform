---
description: Spec ô nhập chat — context usage, danh sách file, textarea, chọn mode, Auto model, cụm tool bên phải.
type: spec
code:
  - apps/studio/src/renderer/components/Composer.tsx
  - apps/studio/src/renderer/modes.ts
  - apps/studio/src/renderer/models.ts
  - apps/studio/src/renderer/contextUsage.ts
  - apps/studio/src/renderer/pastedImages.ts
  - apps/studio/src/renderer/imageStore.ts
  - apps/studio/src/renderer/components/ImageLightbox.tsx
---
# Composer

Bám Cursor chat input. File: `components/Composer.tsx`.

## Cấu trúc (trên → dưới)

1. **Context Usage panel** — chỉ khi bấm vòng gauge.
2. **Files + Review** — chỉ khi `files.length > 0` (tree workspace). Ẩn khi 0 Files.
3. **Ảnh dán** — chỉ khi có ảnh (xem "Dán ảnh").
4. **Textarea** — placeholder luôn: `Plan, Build, / for skills, @ for context`.
5. **Hàng dưới:** mode + Auto (trái) · tools (phải).

## Mode

Thứ tự menu: **Plan → Agent → Debug → MultiTask → Review → Ask**. Icon: List, Infinity, Bug, Users, GitCompare, MessageCircle.

Nút trigger: pill 22px, `border-radius: 999px`, nền `--accent`, chữ/icon `--on-accent` (đen trên copper). Auto **sát phải** mode, **không viền**.

Mỗi mode gửi đúng `mode` cho Engine (hồ sơ ở `profile()` trong `crates/runtime/src/agent/modes.rs`). Hover mục menu hiện mô tả.

| Mode | `mode` | Hành vi |
| --- | --- | --- |
| Plan | `plan` | Chỉ đọc + `submit_plan`. Banner: **Duyệt plan** (Engine lưu `.silence/plans/<ts>.md`, chuyển Agent và tự chạy lượt implement) và **Góp ý / sửa** (giữ Plan, model nộp lại plan). |
| Agent / Code | `agent` | Đủ tool; ghi qua permission + diff. |
| Debug | `debug` | Như Agent + quy trình tái hiện → giả thuyết → bằng chứng → sửa nhỏ nhất → chạy lại. Auto dùng tier `strong`. Gửi kèm 60 dòng cuối tab Output (`context` của `session.prompt`, Engine redact). |
| MultiTask | `multitask` | Như Agent; tách việc độc lập và giao cho sub-agent `task` (hiện chạy tuần tự). |
| Review | `review` | Chỉ đọc; review thay đổi chưa commit, báo lỗi theo mức độ kèm `path:line`. Auto dùng `strong`. Nút **Review** ở hàng Files chọn mode này và điền sẵn yêu cầu. |
| Ask | `ask` | Chỉ đọc, hỏi đáp; không sửa. |

Ask/Review có thêm tool `suggest_mode` (xem "Gợi ý đổi mode" trong `chat.md`). Mode chỉ đọc (Plan/Ask/Review): không có `write`/`edit`/`shell`/`task`, chỉ MCP tool có `readOnlyHint`; Engine từ chối tool ghi kể cả khi model tự gọi. Sub-agent ghi file luôn đi qua permission + diff như agent chính. Mode được đồng bộ bằng `session.set_mode` trước mỗi `session.prompt`.

## Model và Effort

- Menu model chỉ hiện tên model; **tier** (`fast`/`mid`/`strong`/`free` trong `models.yaml`) là gợi ý route của Auto nên không hiện ra UI (không còn nhãn Fast / Balanced / Powerful / Free). Tooltip khi rê chuột hiện nguồn model.
- Model `opt_in` trong `models.yaml` (hiện có Fable 5.2 ở Claude CLI, rất tốn token) tắt mặc định: vẫn hiện trong picker nhưng xám, không chọn được, có nút **Enable** mở Settings → Models và cuộn tới + nháy dòng đó (`lockedModels`, `NetworkPanel.focus`); Auto không bao giờ chọn, cho tới khi user bật công tắc ở Settings → Models (`ModelPrefs.enabled`; dòng đó ghi "Uses many more tokens — off by default"). Tắt lại khi đang chọn nó → về model mặc định của nguồn.
- **Source** (dòng trong menu model, trên Effort, submenu cùng kiểu Effort): OpenRouter / Anthropic API / Claude CLI. Danh sách model chỉ hiện model của nguồn đang chọn, chỉ **tên model** (bỏ tiền tố `Claude `, ví dụ `Opus 5.5`), không tiêu đề nhóm hay tên hãng. Nguồn chưa dùng được (chưa có key, chưa cài CLI) vẫn có trong submenu, mờ, chữ **Set up** mở Settings → Model sources. Dòng Claude CLI hiện email rút gọn của tài khoản CLI (`providers.cli_info`), hoặc "not signed in". Đổi nguồn: model hiện tại thuộc nguồn mới thì giữ, không thì về Auto; nguồn Claude CLI không có Auto (chọn sẵn model tier `mid`). Nguồn lưu ở `localStorage` (`silence.models.preferredProvider`) và gửi Engine qua `providers.set_preferred` để Auto chỉ route trong nguồn đó (Engine chỉ lùi sang nguồn khác khi nguồn đó thiếu tier cần). Settings không còn radio ưu tiên.
- Dòng **Effort** cuối menu, có cho mọi model: model OpenRouter không khai báo `efforts` (model free, model tự thêm) được đủ 5 mức; chưa chọn mức thì không gửi effort, không có badge Recommended. Submenu dùng `position: fixed` (không bị khung chat cắt), đặt bởi `placeSubmenu`: bên phải menu model nếu đủ chỗ, không thì bên trái (chevron đổi hướng), không bên nào đủ thì đè lên menu; đáy thẳng hàng với dòng Effort, luôn nằm trong cửa sổ; Esc đóng. Nội dung: câu mô tả ngắn, rồi Low / Medium / High / Extra / Max (không có dòng Auto). Badge pill **Recommended** ở `default_effort` của model; Max có pill cảnh báo màu `--warning` (icon tam giác, "Highest usage"); dấu ✓ màu `--accent`. Recommended = `default_effort` của model, hiện là Medium cho mọi model Claude (giống Claude Code). Chưa chọn mức nào (`auto`) thì Engine gửi hẳn mức Recommended (không phó mặc mặc định của API, vốn khác nhau theo model), nên ✓ nằm ở đó; với Auto (model), ✓ chỉ hiện khi mọi model có chung một mức mặc định. Auto (model) chỉ hiện các mức mọi model trong catalog đều hỗ trợ.
- Trigger: tên model rút gọn (bỏ tiền tố `Claude `, ví dụ `Opus 5.5`) màu `--text-primary`, độ đậm thường; cách 6px là mức effort đang dùng (kể cả mức Recommended khi chưa chọn) màu `--text-secondary`, không dấu chấm ngăn; chevron `--text-muted`. Model không có mức mặc định và chưa chọn effort thì chỉ hiện tên. Model + effort lưu ở `localStorage` (`silence.composer.pick.v1`), còn sau reload; model không còn trong catalog → về Auto; đổi model mà mức effort không hỗ trợ → về Auto.
- Đồng bộ trước mỗi `session.prompt`: `session.set_model`, `session.set_mode`, `session.set_effort`, `providers.set_preferred`. Engine ánh xạ effort theo nguồn: Anthropic `output_config.effort`, OpenRouter `reasoning.effort` (giữ nguyên mức; với Claude, OpenRouter đổi thành thinking budget theo `max_output_tokens`), CLI `--effort`.

## Cụm phải

| Trạng thái | Icon |
| --- | --- |
| Ô trống | gauge context · kẹp giấy (tệp) · mic (chưa gắn) · waveform (chưa gắn) |
| Có chữ (`prompt.trim()`) hoặc có ảnh dán | gauge · kẹp giấy · **mũi tên Enter** (ẩn mic + waveform) |

- **Vòng gauge** = Show context usage, **không** phải Image. Tooltip CSS (không native Windows): `Context · 6.2K / 1M (1%)`.
- **Context của một đoạn chat** = những gì model nhận ở request kế tiếp của session đó. Lấy từ `session.context` (`{ session_id, mode, model }` — mode/model đang chọn trên UI, vì UI chỉ đồng bộ sang session lúc gửi). **Không** dùng `cost.summary`: đó là tổng input token mọi lần gọi của mọi session (số 382K cũ là lỗi này).
  - Các phần: System prompt (`SYSTEM` + system theo mode) · Rules (workspace, `org::system_append`) · Tool definitions (built-in + `submit_plan`/`suggest_mode`/`task`) · MCP tools · Summarized (ghi chú do `compact_if_needed` chèn) · Conversation (user/assistant/tool).
  - Mẫu số = `context_window` của model lượt kế tiếp (Auto → model đã route ở lượt trước; chưa có lượt nào thì router chọn). Không hard-code 256K.
  - Đo vs ước lượng: sau mỗi lần gọi model, Engine lưu `input + output` provider báo về → tổng là số đo, các phần chia theo tỷ lệ ước lượng. Chưa có lượt nào → ước lượng chars/4, hiển thị `~`.
  - Chat trống = System + Rules + Tools (vài nghìn token).
  - Màu: thường < 70% · `--warning` ≥ 70% (Engine tự tóm tắt ở 70%) · `--error` ≥ 90%.
  - Làm mới khi đổi session/thread, mode, model và khi lượt kết thúc. Lỗi (session không còn sau khi Engine restart) → gauge trống đến lượt gửi kế tiếp.
- Panel usage: tổng `used / window`, thanh màu theo phần, chỉ liệt kê phần > 0, dòng ghi chú "Số đo từ lượt gần nhất" / "Ước lượng".
- Hạn chế đã biết: mở lại thread sau khi khởi động lại app → Engine tạo session mới chưa replay lịch sử, nên context chỉ còn phần nền (đúng với cái model thấy). Chi phí `cost.summary` vẫn là tổng toàn cục.
- Enter xóa ô **ngay**. Nút gửi disable nếu chưa session/busy.
- Khi `busy`: nút gửi đổi thành nút **Dừng** (hình vuông, `aria-label="Dừng"`) → `session.abort`; Engine phát `done` (stop=abort) thì tắt busy. Mic/waveform ẩn trong lúc chạy.

## Ảnh (dán, kéo-thả, chọn file)

- Ba cách thêm, cùng đi qua `addFiles` → `imagesFromFiles` (`pastedImages.ts`):
  - **Ctrl+V** vào textarea. Chữ dán vẫn như cũ; clipboard có ảnh thì không dán chữ kèm.
  - **Kéo-thả** ảnh vào khung composer (viền `--accent` khi đang kéo).
  - Menu kẹp giấy → **Thêm ảnh…** (hộp thoại chọn file, nhiều ảnh).
- **Tự thu nhỏ:** cạnh dài > 2048px hoặc file > 5 MB → vẽ lại bằng canvas ở 2048px, ra PNG; vẫn > 5 MB → WebP 0.85. GIF giữ nguyên (animation) nên GIF > 5 MB vẫn bị từ chối.
- Thumbnail 56px phía trên textarea: bấm để **phóng to** (lightbox), nút × ở góc để bỏ. Tối đa **4 ảnh × 5 MB** sau khi thu nhỏ, PNG/JPEG/GIF/WebP; vượt giới hạn → dòng `composer-hint` báo lý do. Giới hạn khớp `crates/runtime/src/images.rs`.
- Trước khi gửi ảnh, UI gọi `ping`: Engine protocol < `0.1.7` (build cũ, vd. chỉ renderer được hot-reload) bỏ qua `images` im lặng → báo lỗi "chưa nhận ảnh… chạy lại `npm run studio`", trả lại chữ + ảnh.
- Gửi: `session.prompt` thêm `images: string[]` (`data:image/...;base64,...`). Chỉ có ảnh, không chữ vẫn gửi được. Xoá ảnh cùng lúc với xoá ô; RPC lỗi thì trả lại cả chữ lẫn ảnh. Retry chỉ gửi lại chữ.
- Model chọn tay không có `vision` (catalog) → hint "`<model>` không đọc được ảnh." + nút **Dùng Auto**, Enter/nút gửi bị chặn. Engine cũng từ chối. Auto: Engine chọn model có vision cho lượt có ảnh.
- Engine lưu tin user có ảnh dạng content parts OpenAI (`text` + `image_url`). Model không vision ở lượt sau → gateway thay ảnh bằng ghi chú chữ. Context gauge tính mỗi ảnh ~1.6K token, không tính base64.
- Bong bóng tin user hiện ảnh (tối đa 220×160), bấm để phóng to.
- **Lịch sử:** `silence.chat.history` (localStorage) không lưu base64, chỉ `imageIds` + `imageCount`. Ảnh nằm trong IndexedDB `silence-images` (`imageStore.ts`, key = SHA-256 của data URL). Mở lại thread → điền ảnh từ IndexedDB; không còn → "N ảnh (không lưu trong lịch sử)". Mở app → xoá ảnh không thread nào trỏ tới.

## Lightbox (`ImageLightbox.tsx`)

- Overlay toàn màn hình, nền tối. Đóng: Esc, click nền, nút ×; đóng thì focus về ảnh đã bấm.
- Nhiều ảnh trong cùng tin/composer: ←/→ (phím hoặc nút hai bên), đếm `2 / 3`.
- Click ảnh: vừa khung ↔ kích thước thật (cuộn khi lớn hơn khung).
- **Copy:** ảnh PNG vào clipboard (ảnh khác vẽ lại ra PNG). **Lưu:** hộp thoại lưu của Electron, tên `5ilence-image-<n>.<ext>`. Kết quả copy hiện ngay trên thanh lightbox.

## Files menu

Mở xuống từ chip (khi có file) hoặc lên từ kẹp giấy (khi 0 file, chỉ usage). “Show context usage” một dòng, `min-width: 240px`.
