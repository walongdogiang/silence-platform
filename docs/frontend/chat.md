---
description: Hợp đồng UI hội thoại — cấu trúc một lượt, câu trả lời Markdown, thought, bước, lỗi, thẻ diff, code block, link file.
type: spec
code:
  - apps/studio/src/renderer/components/ChatPane.tsx
  - apps/studio/src/renderer/components/MessageMenu.tsx
  - apps/studio/src/renderer/messageMenu.ts
  - crates/runtime/src/agent/history.rs
  - apps/studio/src/renderer/components/MarkdownMessage.tsx
  - apps/studio/src/renderer/components/CodeView.tsx
  - apps/studio/src/renderer/components/DiffCard.tsx
  - apps/studio/src/renderer/components/ImageLightbox.tsx
  - apps/studio/src/renderer/components/WorkspaceImage.tsx
  - apps/studio/src/renderer/components/VisualBlock.tsx
  - apps/studio/src/renderer/workspaceImages.ts
  - apps/studio/src/renderer/syntax.ts
---
# Hội thoại (ChatPane)

Trung tâm là thảo luận user ↔ AI. Bám Cursor: bubble user → **Worked for** (Thought + **Explored** + bước) → chữ AI → chân tin nhắn.

Nhãn trong file này ghi bản tiếng Anh; UI hiện theo ngôn ngữ đã chọn ([i18n.md](i18n.md)).

## Cấu trúc một lượt (Cursor-like)

```
[1] User bubble
[2] Agent meta
      summary: Worked for 21s | Working…
      body:
        Thought 3s ▾                                 ← một nhãn; mở = full thinking
          <toàn bộ reasoning stream>
        Explored 2 files, 4 searches ▾               ← ẩn nếu không có activity
          Reading STATE.md
        chat → claude-haiku                          ← route muted, không pill
        Checkpoint · Restore
[3] AI text
[4] Footer: Copy · Fork Chat                         ← không hiện thời gian tin nhắn
```

- **User bubble có ảnh** (dán / kéo-thả / chọn file ở composer): ảnh nằm trên chữ, bấm để mở lightbox. Chi tiết: mục "Ảnh" và "Lightbox" trong `composer.md`.

## Câu trả lời AI (Markdown-first)

- **Nguồn sự thật:** mọi `ChatLine` loại `token` trong lượt → `Turn.ai.text` (chuỗi gốc từ model).
- **Quy ước format:** system prompt runtime (`crates/runtime/src/agent/modes.rs` → `SYSTEM`) bảo model viết câu trả lời user bằng Markdown.
- **Hiển thị:** `components/MarkdownMessage.tsx` (`react-markdown` + `remark-gfm`: đậm/nghiêng, danh sách, bảng, task list, code fence). Streaming: fence chưa đóng vẫn ra khối code.
- **An toàn:** không `rehype-raw` (HTML thô hiện như chữ, không thành phần tử); `javascript:`/`data:`/`file:` không thành link; **ảnh từ xa bị chặn** (URL ảnh là kênh rò rỉ dữ liệu khi model bị prompt-injection); link `http(s)` mở trình duyệt ngoài qua `window.silence.openExternal` (main kiểm lại scheme, từ chối URL kèm user:pass). Main chặn `will-navigate`/`window.open`, link không bao giờ thay giao diện app (`src/main/safeUrl.ts`).
- **Ảnh trong workspace:** `![alt](out/cat.png)` với đường dẫn tương đối (không `..`, không ổ đĩa) → đọc qua Engine `fs.read_image` (jail, ≤ 5 MB, png/jpg/gif/webp/svg) và hiện tại chỗ (tối đa 480×320); lỗi → `[không mở được ảnh …]`. Link `[x](path)` tương đối thành chip mở file như `` `path` ``.
- **Hình minh hoạ (` ```svg `)** (`VisualBlock`): user bảo "vẽ… hiển thị ở đây" → agent trả một khối ` ```svg ` (hợp đồng trong `SYSTEM`, mục Visuals: tự chứa, có `viewBox` và `<title>`, không script/foreignObject/tài nguyên ngoài; sơ đồ nền trong suốt, tranh nền kín bo góc, không chữ trong tranh). App vẽ thành hình trong card có tiêu đề lấy từ `<title>` (không có thì "Hình minh hoạ", cũng là `alt`): nút **Mã** (xem/copy SVG), nút phóng to → lightbox (Copy = PNG 2x; Lưu **PNG** 2x theo `viewBox` hoặc **SVG** gốc); bấm hình cũng phóng to. Hình cao tối đa 400px, bề rộng tính từ tỉ lệ `viewBox`. Tranh nền kín (hình vẽ đầu tiên là `<rect>` phủ cả `viewBox`) → card co theo hình, hình sát mép; sơ đồ → card full, hình có lề 16px. Hiện bằng `<img src="data:image/svg+xml…">` nên SVG không chạy script, không tải gì ngoài. Đang stream (chưa có `</svg>`) → ô chờ "Đang vẽ…" kèm số KB đã nhận, đúng tỉ lệ `viewBox` ngay khi đọc được (chat không nhảy khi hình hiện), không đổ mã ra chat; trả lời xong mà SVG cụt → hiện mã; SVG hỏng → hiện mã kèm "SVG không vẽ được". Không tạo file.
- **Thao tác trên ảnh (`ImageFrame`)** — mọi ảnh trong chat (hình SVG, ảnh workspace tại chỗ và ở dải ảnh, ảnh user dán): hover / focus hiện góc phải trên **Tải** (SVG: menu có icon tải **Download as PNG** — nét 2x — / **Download as SVG**) và **Copy as image** (chỉ icon; copy xong icon Copy chuyển mượt sang icon ✓ khoảng 1,8 giây rồi trở lại, thanh nút giữ hiện trong lúc đó, tooltip "Copied"; bấm dồn khi lần trước chưa xong thì dùng chung lần đó, PNG đã vẽ được nhớ cho vài ảnh gần nhất; lỗi thì hiện "Không copy được". PNG; SVG vẽ lại 2x; ghi clipboard từ main qua IPC `silence-copy-image`, chỉ nhận PNG ≤ 32 MB; data URL giải mã tại chỗ bằng `dataUrlToBlob`, không `fetch` vì CSP `connect-src` chặn `data:` — Clipboard API của trang chỉ là dự phòng khi chạy ngoài app), góc trái dưới pill **Chỉnh sửa**. Bấm ảnh vẫn phóng to; lightbox cũng có nút **Chỉnh sửa**. Ảnh của câu trả lời đang stream chưa có Chỉnh sửa.
- **Tên file khi tải (`fileNameFor`)** — ảnh workspace giữ tên file thật; hình SVG dùng tên model đặt ở `data-filename` trên thẻ `<svg>` (prompt `SYSTEM` → Visuals: tiếng Anh, kebab-case, mô tả nội dung); thiếu thì lấy `<title>`; vẫn không có thì `image-<n>`. Renderer luôn chuẩn hoá (`slugFileName`): chữ thường, bỏ dấu tiếng Việt, từ nối bằng `-`, không dấu cách / ký tự đặc biệt, ≤ 60 ký tự; đuôi theo định dạng thật (hoặc định dạng xuất, vd. SVG → `.png`). Ảnh đã đánh dấu trong trình chỉnh sửa thêm hậu tố `-annotated`.
- **Trình chỉnh sửa ảnh (`ImageEditor`)** — toàn màn hình, nền tối. Trên: ← đóng (có đánh dấu thì hỏi "Bỏ các đánh dấu chưa dùng?"), Hoàn tác / Làm lại, Copy, Tải PNG đã đánh dấu, nút chính **Gửi cho agent**. Dưới: 7 màu (đỏ mặc định; đổi màu khi đang chọn một dấu thì đổi luôn dấu đó) và công cụ **Phác hoạ**, **Văn bản**, **Khung**, **Mũi tên**, **Bình luận** (ghim số + ô ghi chú ở cột phải); **Gỡ nền** / **Xóa vật thể** hiện nhưng disabled, ghi "chưa gắn" (chưa có model sửa ảnh). Phím: Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y, Delete xoá dấu đang chọn, Esc. Dấu lưu theo toạ độ ảnh gốc (SVG: đơn vị `viewBox`). **Gửi cho agent** = ghép ảnh + dấu thành PNG (SVG vẽ 2x, cạnh ≤ 2048), đính vào composer qua đường ảnh dán (`imagesFromFiles`, tối đa 4 ảnh) và điền sẵn `Sửa hình "<tiêu đề>" theo chỗ đánh dấu trong ảnh đính kèm:` kèm danh sách ghim `1. (x=…, y=… theo viewBox): <ghi chú>`; **không tự gửi**. Model không có vision → Composer đã cảnh báo.
- **Dải ảnh dưới câu trả lời** (`ImageRefStrip`): ảnh workspace mà câu trả lời nhắc tới (chip, link, chữ trơn; bỏ ảnh đã nhúng; tối đa 4), mỗi ảnh có tên file dưới. Chỉ hiện khi lượt đã xong; ảnh chưa có trên đĩa (đang chờ Apply) thì bỏ qua. Bấm → lightbox (Copy / Lưu).
- **Mở file ảnh** (chip, menu Files, panel Review): ảnh mở bằng lightbox, không đọc như chữ.
- **Chip file:** inline code dạng `path`, `path:line` (đường dẫn tương đối, không `..`, không ổ đĩa) thành chip bấm mở file trong workspace; chưa cuộn tới dòng.
- **Copy Message:** `clipboard.writeText(ai.text)` — nguyên nguồn; không gồm Thought, Explored, tool details, checkpoint, route, timestamp.
- **Copy UX (Cursor-like):** hover tooltip “Copy Message”; sau khi copy, icon → check ~2s; toast góc dưới trái “Message copied to clipboard”.
- **Tách kênh:** tool / thinking / plan / diff / permission là event protocol riêng, không lẫn vào Copy.
- Roadmap tiếp: `docs/frontend/chat-markdown-roadmap.md`.

## Gợi ý đổi mode (Ask / Review → Agent)

- Ở Ask/Review, khi người dùng muốn thay đổi, model đưa đề xuất bằng khối ```diff có `path:line` rồi gọi tool `suggest_mode` (không ghi gì). Engine phát event `mode_suggestion { mode, reason }`; Engine **không** tự đổi mode.
- UI hiện thẻ dưới câu trả lời của lượt cuối: **Chuyển sang Agent và thực hiện** (đổi mode, gửi lại đúng prompt cũ; vẫn xin quyền + diff) và **Giữ Ask** (ẩn thẻ). Thẻ ẩn khi đang busy hoặc mode đã đổi.
- Trước khi gửi: đang ở Ask/Review mà câu có động từ sửa (`looksLikeEditRequest`, `renderer/modes.ts`) → dòng nhỏ trên ô nhập "Đang ở Ask (chỉ đọc) … **Gửi bằng Agent**". Không chặn gửi.
- Dòng route trong meta của lượt có nhãn mode: `Ask · chat → model`.
- Ngôn ngữ trả lời theo tin nhắn user; code nhắc kèm `path:line` (`SYSTEM`).

## Tiêu đề thread và lịch sử

- Chat chưa gửi tin nào chỉ hiện ở tab, chưa vào lịch sử. New Agent khi đang ở chat trống thì dùng lại chat đó.
- Tiêu đề tạm (`titleSource: "auto"`): 48 ký tự đầu của tin user (`titleFrom`), **viết hoa chữ đầu** (cả chữ có dấu: "sửa" → "Sửa"), phần còn lại giữ nguyên.
- Chat chưa có tin nào: không vào lịch sử/Search (`ChatHistoryPanel` lọc `lines.length > 0`), chỉ hiện ở tab. Tạo thread mới thì bỏ các thread trống cũ.
- Sau lượt đầu có trả lời, renderer gọi `chat.title` một lần (`firstExchange` → Engine, model tier `fast`, `max_tokens` 48, đã `redact`). Kết quả 3–6 từ, cùng ngôn ngữ với user → `titleSource: "ai"`, không tính lại nữa. Lỗi/không key: giữ tiêu đề tạm, ghi `[warn]` vào Output, không retry.
- Đổi tên tay: double-click tiêu đề trong lịch sử → Enter lưu, Esc huỷ → `titleSource: "user"`; AI không ghi đè.
- Fork: giữ tiền tố `Fork · `; cha đã có tiêu đề chốt thì fork dùng lại, không gọi `chat.title`.
- Hết credit/token: nếu lượt đầu lỗi thì chưa có trả lời → không gọi `chat.title`, tên tạm giữ nguyên. Nếu chỉ lệnh `chat.title` lỗi thì cũng giữ tên tạm. Hạn chế đã biết: mở lại app sẽ thử sinh lại cho thread còn ở tên tạm. Việc chưa làm: lược bớt từ đệm ("giúp tôi", "please") ở tên tạm; thử model miễn phí khi tier `fast` lỗi credit; chỉ thử lại khi mở thread.
- Protocol: `chat.title` (`ChatTitleParams` → `{ title }`), `PROTOCOL_VERSION` 0.1.4; Engine ở `crates/runtime/src/title.rs`.

## Fork Chat

- Nút Fork cạnh Copy trên tin AI đã xong (`!live`); disable khi `busy`.
- Tạo thread mới: `lines` cắt từ đầu → hết turn đó; title `Fork · …`; `forkedFromId` = thread gốc.
- Session mới tạo bằng `session.fork` (protocol 0.1.16): Engine chép lịch sử model của session gốc, cắt đúng chỗ UI cắt, nên model thấy hội thoại trước đó. Session gốc không còn trong bộ nhớ (Engine restart) thì Engine đọc từ log. Engine cũ / lỗi → session trống như trước, ghi cảnh báo ở Output.
- Thread gốc không đổi; không revert file workspace (khác Checkpoint Restore).
- Checkpoint Restore giờ cắt cả lịch sử model (`session.rewind`), không chỉ dòng UI.

## Menu chuột phải trên tin nhắn

Chuột phải vào bubble user hoặc câu trả lời AI → `MessageMenu` (cùng kiểu menu ⋯ ở lịch sử: `fixed` theo con trỏ, lật khi sát mép, Esc / click ngoài / mất focus đóng, ↑↓ di chuyển, chữ cái chạy mục). Bàn phím: focus bubble user (Tab) rồi **Shift+F10** hoặc phím Menu.

| Mục | Phím | Tin user | Câu trả lời AI | Làm gì |
| --- | --- | --- | --- | --- |
| Copy phần đã chọn | | ✓ | ✓ | Chỉ hiện khi đang bôi đen chữ trong tin đó |
| Copy message | C | ✓ | ✓ | Chữ thuần: bỏ markup Markdown (`stripMarkdown`), giữ nguyên code block, bảng → tab |
| Copy message as Markdown | M | ✓ | ✓ | Nguồn gốc (như nút Copy ở chân tin AI) |
| Attach message as context | A | ✓ | ✓ | Chèn trích dẫn `> …` vào composer, dưới bản nháp đang có; không gửi |
| Retry | T | | lượt cuối | Bỏ câu trả lời, gửi lại đúng tin user (không kèm ảnh — mô tả phụ nói rõ) |
| Rewind to here | R | ✓ | | Mô tả phụ; hỏi xác nhận (không hoàn tác được) |
| Fork from here | F | ✓ | | Mô tả phụ; tạo chat mới |
| Fork chat | F | | ✓ | Như nút Fork ở chân tin |

Mục đổi hội thoại (Retry, Rewind, Fork) khoá khi đang `busy`. Toast "Đã copy" dùng chung với nút Copy.

- **Rewind to here:** `session.rewind { session_id, keep_user_turns, text }` → Engine cắt `messages` trước tin đó, ghi `messages_replaced` vào log (bền qua restart), xoá phiên CLI, diff đang chờ, plan; audit `session.rewind`. Rồi UI cắt `lines` trước tin đó và đưa nội dung tin (và ảnh nếu còn) về composer để sửa — nháp chưa gửi giữ ở dưới. **Không** đụng file workspace (muốn trả file thì dùng Checkpoint → Restore). Engine từ chối (cũ, đang chờ duyệt quyền, không tìm thấy tin) → UI không cắt, báo lỗi. Session đã mất do Engine restart → chỉ cắt UI (lượt sau tạo session mới như cũ).
- **Fork from here:** chat mới chứa phần **trước** tin này (UI và lịch sử model qua `session.fork`), tin này nằm sẵn trong composer của chat mới để sửa / gửi model khác. Chat cũ giữ nguyên.
- **Ghép số tin:** UI đếm bubble user, Engine đếm tin `user` thật (bỏ tin `[view_image]`). Hai bên lệch khi một lượt lỗi ngay call đầu (Engine rollback), nên UI gửi kèm `text`: Engine tìm tin khớp gần vị trí đó (cùng vị trí, hoặc lùi về trước); tin chưa từng vào lịch sử thì không cắt gì; không thấy mà còn tin sau → từ chối thay vì cắt nhầm (`agent/history.rs` → `cut_index`).

**Sửa đã chốt:** `Worked for` luôn có `ms` khi `done` (không `—`); không trùng dòng Thought; Explored không hiện rỗng; route không hộp xám.

## Thought (hiển thị suy nghĩ)

- Event runtime `thinking` (protocol 0.1.1) — stream `reasoning_content` / `reasoning` / `thinking` từ gateway.
- Live: nhãn **Thinking** + shimmer; body cập nhật dần (full text).
- Xong: **Thought Ns** nếu có `ms`, không thì **Thought briefly**; body giữ nguyên, thu/mở được.
- Brief một dòng = dòng đầu của body (không thay full thinking).
- Không invent Thought nếu lượt không có body/`ms` đáng kể và không có hoạt động.

**Chế độ xem mặc định** (Settings → Trò chuyện, `transcriptOpen` trong `prefs.ts`): khối nào của lượt mở sẵn. User vẫn gập/mở tay được.

| Chế độ | Lượt (Worked for) | Thought | Explored | Tool details |
| --- | --- | --- | --- | --- |
| Gọn (mặc định) | mở khi live | mở khi có body | mở khi live | đóng |
| Suy nghĩ | mở khi live hoặc có Thought | mở khi có body | mở khi live | đóng |
| Chi tiết | luôn mở | mở | mở | mở |

## Bộ bước (live → past)

| Live | Past | Ghi chú |
| --- | --- | --- |
| Planning next moves | *(không lưu)* | Placeholder; bị thay |
| Thinking | Thought briefly / Thought Ns | Bản ghi + full body |
| Reading | Read | |
| Starting | Started | `proc_start` (dev server nền) |
| Reading logs | Read logs | `proc_logs` |
| Stopping | Stopped | `proc_stop` |
| Checking processes | Checked processes | `proc_list` |
| Checking | Checked | `http_check` (`GET localhost:5173/api`) |
| Opening / Reading page | Opened / Read page | `browser_open` (URL) / `browser_snapshot` |
| Clicking · Typing · Selecting · Pressing · Hovering | Clicked · Typed · Selected · Pressed · Hovered | `browser_act` theo `action` (`e3 "3"`, `Enter`) |
| Reading console / Reading network / Closing browser | Read console / Read network / Closed browser | `browser_console` / `browser_network` / `browser_close` |
| Taking screenshot | Took screenshot | `browser_screenshot` (`e4` / `full page`) |
| Writing test | Wrote test | `browser_export_test` (tiêu đề test); file thật được ghi sau đó bằng `write` (DiffCard) |
| Searching | Searched | |
| Editing | Edited | |
| Running | Ran | |
| Testing | Tested | Heuristic lệnh test |
| Exploring | Explored | `task` / codebase rộng |
| Writing plan | Wrote plan | `submit_plan` |
| Using tool | Used tool | MCP / tool khác |

Bước `Running`/`Ran` của lệnh chạy trong sandbox (Tự chủ) có thêm badge **sandbox** (`.msg-step-sbx`, `NarrateStep.sandboxed`).

## Thread

Gửi → Planning + bắt đầu đo thought. `thinking` → Thinking + body. `tool_start`/`token` → seal `ms`. `done`/`error` → drop Planning/Thinking live, past bước, Thought record, checkpoint, worked.

Các bước Read liên tiếp cùng file được gộp thành một dòng có khoảng dòng (`Read App.tsx (1–40, 615–629)`), xem `mergeReadSteps` trong [status.md](status.md).

Trong lúc lượt còn live, dòng summary là run pulse `Working · 1m 12s · 5.9K tokens` (hoặc `Waiting for approval` / `Stopping…`), xem [status.md](status.md). Xong lượt thì quay về `Worked for …`.

## Lỗi trong lượt

- Engine chuẩn hóa lỗi provider → `error` event có `error: { code, status?, retryable, detail }` (`PROVIDER_CREDITS`, `PROVIDER_AUTH`, `PROVIDER_RATE`, `PROVIDER_UNAVAILABLE`, `NETWORK`, `TIMEOUT`, `UNKNOWN`). Thiếu `error` → thông báo chung.
- Hiện **inline trong lượt** bằng `ErrorCard` (tiêu đề + mô tả + hướng xử lý tiếng Việt). Không toast/dialog; không dán JSON/HTTP làm nội dung chính.
- "Chi tiết kỹ thuật" thu gọn (mã · HTTP · `detail` đã lọc secret ở Engine). Output log ghi cùng dòng.
- Nút "Thử lại" chỉ khi `retryable` (rate/5xx/mạng/timeout) và chỉ ở lượt cuối. Credit/key sai: không retry, không auto-retry.
- Sau lỗi: `busy` tắt; prompt vừa gửi được trả lại composer nếu đang trống. Copy: `renderer/errorCopy.ts`.

## Thẻ Diff

- Card phẳng (`DiffCard.tsx`), viền `--border-ui`, bo `--radius-md`; không dùng `.banner`.
- Header: icon file, đường dẫn mono (thư mục muted, tên đậm), `+N −M`, icon mở panel Changes. Bấm tên file cũng mở panel.
- Body: `DiffTable` dùng chung (xem mục dưới), 3 dòng ngữ cảnh mỗi bên. Hiện tối đa 14 hàng, có "Hiện thêm N dòng".
- File `.svg`: header có toggle **Xem trước / Mã**, mặc định Xem trước — hình vẽ từ nội dung đề xuất (`after`, data URL trong `<img>`, nền ô caro), bấm để phóng to. Chưa Apply vẫn xem được.
- Footer căn phải: **Reject** (ghost) rồi **Apply** (primary). Không ghi file nếu chưa Apply. Áp dụng cho mode Thận trọng (`ask`), nơi Engine stage file.
- Mode Cân bằng: Engine đã ghi file (event `diff{applied:true}`, tầng 1). Footer hiện "✓ Đã áp dụng" bên trái và **Hoàn tác** (ghost) bên phải; Hoàn tác ghi lại `before` qua `diff.apply` (như Restore checkpoint). Xem `docs/security/permissions.md`.

## Card xin quyền

- Tiêu đề = lý do chính từ Risk Engine (`risk.reasons[0].title`) + "cho phép <tool>?". Lệnh shell hiện **nguyên văn** (không JSON); tool khác hiện JSON tham số.
- Danh sách lý do: tiêu đề đậm + giải thích (`.perm-reasons`), mã nằm ở `title` để tra catalog.
- Badge tầng cạnh tiêu đề (`Cần duyệt`). Nút: **Cho phép một lần** (chính), **Cho phép "<mẫu>" trong phiên này**, **Luôn cho phép "<mẫu>" trong workspace**, **Từ chối**. Hai nút giữa chỉ hiện khi Engine gửi `risk.pattern`; không có mẫu (pipeline, git huỷ thay đổi, secrets…) thì ẩn. Không còn checkbox "Nhớ". Chi tiết phạm vi: [security/permissions.md](../security/permissions.md).
- Bước bị chặn (tầng 3) không có card: bước `Running …` đổi thành `Blocked <lý do>`.
- **Tự chủ (`autonomous`)**, khi sandbox Ready (`docs/security/permissions.md` → Chế độ Tự chủ):
  - Bước chạy trong sandbox có badge nhỏ **sandbox** sau chi tiết bước (Engine gửi trace `sandbox.run {call_id}`, UI gắn cờ `sandboxed` lên dòng `narrate` vừa tạo; lưu cùng lịch sử).
  - **Card host lạ:** Engine gửi `risk.hosts`. Card liệt kê host (`.perm-hosts`) dưới nhãn "Host chưa có trong danh sách cho phép"; hai nút nhớ đổi thành **Cho phép <host> trong phiên này** / **Luôn cho phép <host> trong workspace** (lưu `.silence/network.json`, không lưu mẫu `curl *`). **Cho phép một lần** chỉ cấp host cho lệnh đó. Host tới từ Engine, client không gửi host nào.
  - **Card leo thang:** Engine gửi `risk.escalation {count, stop_only, blocked[]}` sau 3 lần bị chặn liên tiếp. Tiêu đề "Bị chặn N lần liên tiếp", badge **Đã chặn**, lệnh thật nguyên văn, danh sách "Thứ đã cản" do Engine sinh (không hiện chữ model viết). Nút **Chạy một lần ngoài sandbox** (chính; ẩn khi `stop_only`) và **Dừng** (gửi từ chối; khi `stop_only` là nút chính duy nhất). Không có nút nhớ.
  - **Banner** `.sbx-banner` trên card: khi người dùng chọn Tự chủ mà sandbox không Ready (chưa cài / cần sửa / chưa hỗ trợ), nói rõ Engine đang chạy y như Cân bằng, kèm nút **Mở cài đặt**.
- Bấm Stop: card gỡ ngay, Engine tự từ chối quyền đang chờ.
- Panel Changes dùng `DiffEditor` before/after; Monaco nạp cục bộ, không qua CDN.

## Code block và diff trong câu trả lời

`CodeView.tsx`, gọi từ `MarkdownMessage` cho mọi code fence (không inline).

- **Code thường** (```` ```python ````): card `--surface-1`, viền `--border-subtle`, bo `--radius-md`. Header mảnh ghi tên ngôn ngữ (mono, muted) và nút **Copy** (đổi thành "Đã chép" 1,5 giây). Body mono 12.5px / 20px, syntax highlight, không đánh số dòng.
- **Diff** (```` ```diff ````/`patch`, hoặc nội dung có `@@ -`/`---`+`+++`): parse bằng `unifiedDiff.ts`. Header gồm icon, đường dẫn (bấm mở file nếu hợp lệ theo `parsePathRef`), `+N −M`, Copy (chép diff gốc). Không hiện `diff --git`/`index`/`---`/`+++`/`@@`. Không parse được (không có dòng +/−) thì render như code thường.
- **`DiffTable`** (dùng chung với thẻ Diff):
  - cột vạch 4px: xoá là sọc chéo `--diff-del`, thêm là `--diff-add` đặc; nền dòng `--diff-*-bg`; số dòng giữ màu muted;
  - số dòng lấy từ `@@` (xoá dùng số cũ, thêm dùng số mới), không có `@@` thì ẩn cột số;
  - phần chữ khác nhau giữa cặp dòng xoá/thêm (nới tới ranh giới từ) tô `mark.chg` màu `--diff-*-chg`;
  - hàng "⋯ N dòng không đổi" giữa các hunk;
  - không hiện ký tự `+`/`−`, có `aria-label` "thêm"/"xoá".
- **Syntax highlight**: `syntax.ts` nạp Monaco động và dùng `monaco.editor.tokenize`, ánh xạ sang class `tk-*` với màu `--syn-*`. Không dùng `innerHTML`. Đang stream thì debounce 120ms; dòng chưa có token hiện chữ thường.

## Link và đường dẫn file

- Link http(s) và đường dẫn file trong `code` (`calc.py:4`) dùng cùng font và cỡ với chữ thường (không mono), nét mảnh `font-weight: 400`, màu xanh `--link`, không nền, gạch chân 1px; hover đổi sang `--link-hover`. Token `--link` có bản dark và light trong `theme/tokens.css`. Bấm đường dẫn mở file trong workspace.
