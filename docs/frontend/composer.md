---
description: Spec ô nhập chat — context usage, danh sách file, textarea, chọn mode, Auto model, cụm tool bên phải.
type: spec
code:
  - apps/studio/src/renderer/components/Composer.tsx
  - apps/studio/src/renderer/components/AutoSettings.tsx
  - apps/studio/src/renderer/components/NetworkPanel.tsx
  - apps/studio/src/renderer/components/ModelListTab.tsx
  - apps/studio/src/renderer/autoConfig.ts
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
4. **Textarea** — placeholder theo ngôn ngữ UI (`composer.placeholder` trong `i18n.ts`): EN `Plan, Build, / for skills, @ for context`, VI `Lập kế hoạch, xây dựng, / để dùng skill, @ để thêm ngữ cảnh`.
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

- **Auto** luôn là dòng đầu danh sách, ở **mọi source** (kể cả Claude CLI). Dưới chữ Auto có một dòng tóm tắt theo cấu hình của source đang chọn, ví dụ "Opus lập kế hoạch · Sonnet thực thi · Haiku việc phụ" (`autoSummary`). Auto **không đọc nội dung prompt**. Engine chọn slot theo mode và mục đích của lời gọi (mặc định dưới đây; slot của lượt chính đổi được theo từng mode trong Tuỳ chỉnh Auto):
  - **Frontier**: Plan, Review, subagent review.
  - **Strong**: Agent, Ask, Debug, MultiTask, lượt thực thi sau Approve plan, subagent implement.
  - **Small**: tiêu đề chat, subagent explore.

  Gặp khó thì leo cấp, bậc 1 là effort +1, bậc 2 là lên Frontier, và giữ Frontier đến hết lượt. Tín hiệu leo cấp: test đỏ sau khi sửa, cùng tool lỗi 2 lần, lặp cùng lời gọi 3 lần hoặc 4 bước liền không tiến triển, trả lời rỗng, lỗi provider tạm thời. Ở Debug, test đỏ đầu tiên lên thẳng Frontier. Trên Claude CLI không đổi model giữa lượt được: lượt có tín hiệu xấu khiến lượt **sau** bắt đầu ở Frontier.
- Dòng **Auto** đứng đầu: icon ✦ (`--accent`) + chữ Auto, **không có dòng phụ**. Rê chuột thì tooltip ghi model của từng việc (Lập kế hoạch & review / Thực thi / Việc phụ).
- Chữ trong menu model và toàn bộ UI Auto theo ngôn ngữ giao diện (`docs/frontend/i18n.md`).
- Dòng **Auto settings / Cài đặt Auto** (trên Nguồn, giá trị là tên preset) mở submenu **chỉ có lựa chọn nhanh** (`AutoQuickMenu`):
  - 4 preset Cân bằng / Tiết kiệm / Thông minh nhất / Tuỳ chỉnh, mỗi preset có dòng phụ là model của 3 slot (Tuỳ chỉnh: "Chọn model từng slot trong Cài đặt");
  - ô "Trần chi phí / chat" (placeholder "Không giới hạn") kèm "Đã dùng $x" của chat hiện tại;
  - **More settings…** mở Settings → mục **Model** ở tab **Auto** (`NetworkPanel.focusAuto`).
- **Settings → Model** (mục Model trong hộp Settings, `NetworkPanel.tsx` với `embedded`): header ghi model + nguồn đang dùng, rồi 3 tab (nhớ ở `localStorage` `silence.shell.networkTab`, helper `networkTabs.ts`):
  - Thanh dưới cùng (dính đáy trang): **Đặt lại mặc định** bên trái; **Huỷ**, **Lưu** (phím tắt Ctrl+S, hiện ở tooltip, không in trên nút) bên phải. Không có chữ trạng thái hiển thị (chỉ đọc cho trình đọc màn hình qua `.sr-only`). Lưu dùng `.btn-solid` (nền `--accent`, như "Open workspace"), Huỷ / Đặt lại dùng `.btn-light` (nền sáng). Khi không bấm được, nút giữ nguyên màu và kích thước, chỉ mờ đi (`opacity`). Đổi nguồn mặc định, cài đặt Auto và công tắc/thêm/xoá model chỉ là bản nháp cho tới khi bấm Lưu; Huỷ bỏ bản nháp; tab có thay đổi chưa lưu có dấu chấm `•`. **Đặt lại mặc định** chỉ áp cho tab đang mở và chỉ đưa vào bản nháp: Nguồn → Claude CLI (không đụng key); Auto → `DEFAULT_AUTO` của nguồn đang xem; Danh sách model → mọi công tắc về mặc định, giữ model tự thêm (`defaultPrefs`). API key vẫn lưu riêng bằng nút Save trên từng thẻ nguồn. Menu Auto nhanh trong composer vẫn áp dụng ngay. Đóng hộp Settings hoặc chuyển sang mục khác khi còn bản nháp thì hiện hộp thoại **Lưu và rời trang / Bỏ thay đổi / Ở lại** (`UnsavedDialog`; Esc hoặc bấm nền = Ở lại; nút Lưu được focus sẵn). `SettingsDialog` nhận trạng thái bản nháp qua `NetworkPanel.guardRef`.
  - **Nguồn** (`ProviderSources`): Nguồn mặc định, thẻ từng nguồn (trạng thái, ô key). Thẻ Claude CLI chỉ hiện tài khoản + mức dùng hôm nay; Cài đặt / Cách 5ilence chạy CLI / Mức dùng đầy đủ nằm trong "Chi tiết kỹ thuật" thu gọn (`CliDetails`). Tab có chấm cảnh báo khi nguồn mặc định không dùng được. Picker → Source → **Set up** mở tab này (`focusSources`).
  - **Auto**: như dưới.
  - **Danh sách model** (`ModelListTab`): ô lọc, model nhóm theo nguồn kèm đếm "x/y bật", tên model dạng ngắn không tiền tố hãng (`shortName`: `Opus 5.5`), công tắc từng dòng (nền `--accent`, núm trắng). Mỗi nhóm thu/mở được bằng tiêu đề; nhóm có nguồn chưa dùng được mặc định thu gọn và ghi "nguồn chưa dùng được" kèm link **Thiết lập** sang tab Nguồn; khi đang lọc thì mọi nhóm mở. Nút "+ Thêm model OpenRouter" (chỉ khi có nguồn OpenRouter) mở form slug. Picker → **Thêm model** mở tab này với form mở sẵn (`focusAdd`); **Enable** model `opt_in` mở tab này rồi cuộn + nháy dòng (`focus`). Tín hiệu focus cũ hơn 3 giây bị bỏ qua (`isFreshFocus`) để mở lại trang không nhảy tab.
- **Settings → Model → Auto** (`AutoSettings`), tab theo source:
  - 4 thẻ preset kèm mô tả và model;
  - **Trần chi phí mỗi chat** ngay dưới preset (thiết lập liên quan tiền nên đặt cao), kèm số chat đang mở đã dùng;
  - preset Tuỳ chỉnh: chọn model cho từng slot;
  - bảng **"Việc nào dùng slot nào"**: mỗi mode một nút phân đoạn Frontier/Strong/Small (chấm `--accent` = slot mặc định), cột cuối là model sẽ dùng; dòng "Việc phụ" cố định Small (`AutoConfig.mode_slots`, `withModeSlot`). Chỉ áp dụng khi chọn Auto, leo cấp vẫn chạy từ slot đã chọn;
  - **pool** "Model Auto được chọn": dòng giải thích "chỉ áp dụng cho Auto; model tắt ở tab Danh sách model thì ẩn khỏi cả picker lẫn Auto" + link mở tab đó. Model đang tắt ở tab Danh sách model vẫn hiện trong pool nhưng xám, ô tích khoá, ghi "đang tắt ở tab Danh sách model" (`offModels`). Bỏ/tích một model thì hiện "Sau thay đổi: Frontier → Sonnet 5.5" nếu có slot đổi model (`poolImpact`). Model `opt_in` chỉ dùng được khi được tích;

  Cấu hình lưu ở `localStorage` `silence.auto.v1`, dạng `{[source]: AutoConfig}`. Model tắt ở Settings → Models không vào pool (`engineConfig`). Tên model trong phần Auto dùng dạng ngắn `Opus 5.5` như picker (`shortName`).
- Trigger khi chọn Auto: `Auto · Sonnet 5.5`, là model của lượt chính gần nhất (bỏ qua route của title/subagent); chưa có lượt nào thì chỉ hiện `Auto`.
- **Chip mỗi lượt**: summary của meta lượt có chip `Auto → Opus · leo cấp: tests failed after an edit` (màu `--warning` khi đã leo cấp). Tooltip liệt kê mọi route trong lượt. Các dòng route trong phần mở rộng ghi model, slot và mục đích.
- **Chi phí theo slot**: panel Context Usage có thêm "Chi phí phiên này", tách theo Frontier/Strong/Small, kèm "tiết kiệm ~$X so với dùng toàn model mạnh nhất" (lấy từ `cost.baseline_usd`). Số này theo từng thread, còn sau reload.
- **Trần chi phí**:
  - Dùng ≥ 80% trần thì Auto không leo lên Frontier.
  - Dùng ≥ 100%, **hoặc bước tiếp theo ước tính sẽ vượt trần**, thì Engine dừng lượt bằng `done{stop:"budget"}` (dừng ở bước đầu thì bỏ luôn câu hỏi chưa trả lời). Ước tính một bước = chi phí bước trước nếu cùng model, không thì tính theo kích thước history cộng 2K token trả lời.
  - Số đã tiêu được lưu theo **thread** (`localStorage` `silence.auto.spend.v1`), gửi lại bằng `session.carry_spend` trước mỗi lượt; Engine giữ số lớn hơn. Nhờ vậy Engine restart hay tạo session mới cho cùng thread không reset trần. Resume session thì Engine cộng lại từ các event `cost` trong log. UI trả câu đó vào composer và hiện banner trên composer gồm "Nâng trần +50%", "Tiếp tục 1 lượt" (`session.budget_continue` rồi gửi lại) và ×.
  - Trần chỉ áp cho Auto. Chọn model tường minh thì không bị chặn.
- Menu model chỉ hiện tên model; **tier** (`fast`/`mid`/`strong`/`free` trong `models.yaml`) là gợi ý route của Auto nên không hiện ra UI (không còn nhãn Fast / Balanced / Powerful / Free). Tooltip khi rê chuột hiện nguồn model.
- Model `opt_in` trong `models.yaml` (hiện có Fable 5.2 ở Claude CLI, rất tốn token) tắt mặc định: vẫn hiện trong picker nhưng xám, không chọn được, có nút **Enable** mở Settings → Models và cuộn tới + nháy dòng đó (`lockedModels`, `NetworkPanel.focus`); Auto không bao giờ chọn, cho tới khi user bật công tắc ở Settings → Models (`ModelPrefs.enabled`; dòng đó ghi "Uses many more tokens — off by default"). Tắt lại khi đang chọn nó → về model mặc định của nguồn.
- **Source** (dòng trong menu model, trên Effort, submenu cùng kiểu Effort): OpenRouter / Claude API / Claude CLI. Danh sách model chỉ hiện model của nguồn đang chọn, chỉ **tên model** (bỏ tiền tố `Claude `, ví dụ `Opus 5.5`), không tiêu đề nhóm hay tên hãng. Nguồn chưa dùng được (chưa có key, chưa cài CLI) vẫn có trong submenu, mờ, chữ **Set up** mở Settings → Model → Nguồn. Dòng Claude CLI hiện email rút gọn của tài khoản CLI (`providers.cli_info`), hoặc "not signed in". Đổi nguồn: model hiện tại thuộc nguồn mới thì giữ, không thì về Auto (mọi nguồn, kể cả Claude CLI). Đổi ở đây chỉ có hiệu lực cho lần chạy hiện tại; Studio mở lên với **Nguồn mặc định** đặt ở Settings → Model → Nguồn (`localStorage` `silence.models.defaultSource`; chưa đặt = Claude CLI). Nguồn không dùng được vẫn giữ nguyên, không tự đổi sang nguồn khác. Nguồn gửi Engine kèm `session.set_model {model, source}` để Auto chỉ chọn trong nguồn đó; `providers.set_preferred` vẫn gửi (CLI → `""`) cho các lookup theo tier.
- Dòng **Effort** cuối menu, có cho mọi model: model OpenRouter không khai báo `efforts` (model free, model tự thêm) được đủ 5 mức; chưa chọn mức thì không gửi effort, không có badge Recommended. Submenu dùng `position: fixed` (không bị khung chat cắt), đặt bởi `placeSubmenu`: bên phải menu model nếu đủ chỗ, không thì bên trái (chevron đổi hướng), không bên nào đủ thì đè lên menu; đáy thẳng hàng với dòng Effort, luôn nằm trong cửa sổ; Esc đóng. Nội dung: câu mô tả ngắn, rồi Low / Medium / High / Extra / Max (không có dòng Auto). Badge pill **Recommended** ở `default_effort` của model; Max có pill cảnh báo màu `--warning` (icon tam giác, "Highest usage"); dấu ✓ màu `--accent`. Recommended = `default_effort` của model, hiện là Medium cho mọi model Claude (giống Claude Code). Chưa chọn mức nào (`auto`) thì Engine gửi hẳn mức Recommended (không phó mặc mặc định của API, vốn khác nhau theo model), nên ✓ nằm ở đó; với Auto (model), ✓ chỉ hiện khi mọi model có chung một mức mặc định. Auto (model) chỉ hiện các mức mọi model trong catalog đều hỗ trợ.
- Trigger: tên model rút gọn (bỏ tiền tố `Claude `, ví dụ `Opus 5.5`) màu `--text-primary`, độ đậm thường; cách 6px là mức effort đang dùng (kể cả mức Recommended khi chưa chọn) màu `--text-secondary`, không dấu chấm ngăn; chevron `--text-muted`. Model không có mức mặc định và chưa chọn effort thì chỉ hiện tên. Model + effort lưu ở `localStorage` (`silence.composer.pick.v1`), còn sau reload; model không còn trong catalog → về Auto; đổi model mà mức effort không hỗ trợ → về Auto.
- Đồng bộ trước mỗi `session.prompt`: `session.set_model` (kèm `source`), `session.set_mode`, `session.set_effort`, `auto.set_config` (cấu hình Auto của source đang chọn), `providers.set_preferred`. Khi mở app và khi bật/tắt model, mọi cấu hình Auto đã lưu được gửi lại, vì Engine chỉ giữ chúng trong bộ nhớ. Engine ánh xạ effort theo nguồn: Claude API `output_config.effort`, OpenRouter `reasoning.effort` (giữ nguyên mức; với Claude, OpenRouter đổi thành thinking budget theo `max_output_tokens`), CLI `--effort`.

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
- **Lịch sử:** `silence.chat.history` (localStorage) không lưu base64, chỉ `imageIds` + `imageCount`. Ảnh nằm trong IndexedDB `silence-images` (`imageStore.ts`, key = SHA-256 của data URL). Mở lại thread → điền ảnh từ IndexedDB; không còn → "N ảnh (không lưu trong lịch sử)". Mở app → xoá ảnh không thread nào trỏ tới. Lịch sử ghi trễ (~800 ms sau lần đổi cuối, `flushHistory` trong `App.tsx`) vì `threads` đổi theo từng token khi stream; ẩn hoặc đóng cửa sổ thì ghi ngay.

## Lightbox (`ImageLightbox.tsx`)

- Overlay toàn màn hình, nền tối. Đóng: Esc, click nền, nút ×; đóng thì focus về ảnh đã bấm.
- Nhiều ảnh trong cùng tin/composer: ←/→ (phím hoặc nút hai bên), đếm `2 / 3`.
- Click ảnh: vừa khung ↔ kích thước thật (cuộn khi lớn hơn khung).
- **Copy:** ảnh PNG vào clipboard (ảnh khác vẽ lại ra PNG). **Lưu:** hộp thoại lưu của Electron, tên `5ilence-image-<n>.<ext>`. Kết quả copy hiện ngay trên thanh lightbox.

## Files menu

Mở xuống từ chip (khi có file) hoặc lên từ kẹp giấy (khi 0 file, chỉ usage). “Show context usage” một dòng, `min-width: 240px`.
