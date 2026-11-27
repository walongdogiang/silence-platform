---
id: T-003
title: 1.12 Pane xem dev server / URL
type: feature
status: done
phase: verify
area: [studio]
size: L
depends: []
branch: feat/T-003-browser-preview
pr: 91
model: opus
model-build: sonnet
created: 2026-11-23
updated: 2026-11-27
---

## Mục tiêu

Studio có pane xem dev server / URL (Electron `WebContentsView`), để xem app đang làm ngay cạnh chat. Mốc cuối của giai đoạn 1.

## Phạm vi

**Làm:** dời panel dưới (Terminal, Output, Ports, …) thành **cột pane bên phải ngoài cùng** kiểu Claude desktop; thêm tab **Xem trước** mở URL localhost trong cột đó; link localhost trong chat và hàng Ports mở vào pane; bản xem trước tĩnh cho user duyệt trước khi code; cập nhật `docs/frontend/layout.md`, rule `frontend-shell.md`, `docs/threat-model.md`.

**Không làm:** agent tự điều khiển trình duyệt; mở URL ngoài loopback trong pane; chia đôi cột pane; tách pane ra cửa sổ riêng; chuyển Diff vào cột pane; gắn Problems/Debug.

## Đọc trước

- `docs/frontend/layout.md` (TitleBar, Trình duyệt, Ports, Grid, Shell flags), `.claude/rules/frontend-shell.md`, `frontend-boundary.md`.
- `apps/studio/src/main/index.ts` → `createWindow` (chặn `will-navigate`, `setWindowOpenHandler`), handler `silence-open-external`; `main/safeUrl.ts`.
- `apps/studio/src/preload/index.ts`, `renderer/global.d.ts`.
- `apps/studio/src/renderer/App.tsx`: state `panelOpen`/`panelTab`, phím Ctrl+J trong `onKey`, khởi tạo xterm + `FitAddon`, `<BottomPanel>` trong `main.workspace`, `<ChatHistoryPanel>` trong `.shell`; `components/BottomPanel.tsx`; `components/TitleBar.tsx` (nút `PanelBottom`); `components/DiffPane.tsx` (tab con `preview` giả); `components/MarkdownMessage.tsx` (`a` → `openExternal`); `renderer/procs.ts` → `isLocalUrl`; CSS `.shell`, `.app.view-chat .shell`, `.bottom-panel` trong `styles.css`.

## Bối cảnh

- Mốc 1.12 trong `docs/adapters/migration.md`.
- Panel dưới hiện nằm trong `main.workspace`, chỉ dưới khung chat. Tab **Trình duyệt** cũ chỉ phản chiếu ảnh trình duyệt headless của agent Engine Rust; tab đó và **Ports** sẽ bị xoá ở T-034.
- DiffPane nằm **dưới** chat (`.chat-split` chia hàng), có tab con "Xem trước" giả (`review.previewStub`).
- Electron 33 có `WebContentsView`. View native luôn vẽ đè lên DOM renderer; phím bấm khi focus trong view không tới renderer.
- Tham khảo: Claude desktop (cột pane phải, chuyển bằng icon trên thanh tiêu đề, đầu pane có phóng to/đóng; link localhost và thẻ server mở vào pane); Cursor 2.x Browser Tab trong vùng editor, link localhost trong chat mở vào tab.

## Thiết kế

**Layout (user chốt 2026-11-27):**

```
[ TitleBar                                                 … ▣ 🌐 ⚙ ]
[ Chat Workspace: tab + hội thoại (+ diff dưới) | lịch sử ] [ Cột pane ]
```

- Cột pane là cột thứ ba của `.shell`, **ngoài cùng bên phải**, cao từ dưới TitleBar tới đáy. Không chèn vào giữa chat và lịch sử (một khối). Không còn panel dưới.
- Tab của cột: Terminal · Output · Ports · Xem trước · Trình duyệt agent (nhãn mới của tab cũ) · Problems · Debug (vẫn "chưa gắn").
- Bề rộng mặc định ~520px, kéo mép trái để đổi (min 360px, max 70% cửa sổ), nhớ trong `silence.shell.paneWidth`. Đầu cột: tab, nút **phóng to** (ẩn tạm Chat Workspace, bấm lại thì trả về) và **đóng**.
- Ctrl+J và icon panel trên TitleBar (đổi `PanelBottom` → `PanelRight`) bật/tắt cột, giữ tab đang chọn. Icon 🌐 (`Globe`) và Ctrl+Shift+B mở cột ở tab Xem trước. Tắt Chat Workspace thì cột pane chiếm hết bề ngang.
- Tab con "Xem trước" giả trong DiffPane bị bỏ.
- Đổi chat **không** xoá trang đang xem (pane theo cửa sổ, không theo chat).

**Tab Xem trước:**
- Thanh trên: ← → ⟳, ô URL (Enter để mở; thiếu scheme thì thêm `http://`), nút mở bằng trình duyệt ngoài, nút DevTools (cửa sổ tách). Trống: gợi ý gõ `localhost:<port>`. Lỗi tải: thông báo + nút Thử lại. URL ngoài loopback gõ vào: từ chối kèm dòng giải thích.
- Nhớ URL gần nhất theo workspace (`silence.preview.urls`, JSON map workspace → URL).

**Nguồn mở (user chọn 2a):** link `http(s)://localhost|127.0.0.1|[::1]` trong câu trả lời → mở vào tab Xem trước; **Ctrl+click** → trình duyệt ngoài. Link không loopback giữ như cũ (`openExternal`). Nút URL ở hàng Ports → Xem trước.

**Main / bảo mật:**
- Module mới `main/preview.ts`: một `WebContentsView` cho cửa sổ; IPC `silence-preview-*` (open, back, forward, reload, close, setBounds, setVisible, devtools); main kiểm URL lại, không tin renderer. Gửi trạng thái về renderer qua `silence-preview-state` (url, title, loading, canGoBack/Forward, error).
- `webPreferences`: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, **không preload**; `partition: "preview"` (không `persist:`, không chung với UI).
- `isLoopbackUrl` trong `main/safeUrl.ts` (http/https, host `localhost`/`127.0.0.1`/`[::1]`, không username/password). Hàm thuần `previewNavDecision(url) → "allow" | "external" | "deny"` dùng cho `will-navigate`, `will-redirect`, `setWindowOpenHandler` (luôn deny cửa sổ mới; loopback thì mở trong pane, http(s) khác ra ngoài qua `isSafeExternalUrl`).
- `setPermissionRequestHandler` và `setPermissionCheckHandler` → từ chối hết; `will-download` → huỷ.
- Phím tắt của app khi focus trong view: `before-input-event` bắt Ctrl+J, Ctrl+Shift+B, Ctrl+Alt+U, F12 rồi chuyển cho renderer (hoặc xử lý ở main).
- Lớp phủ DOM: renderer theo dõi (`MutationObserver` trên `body`) phần tử lớp phủ (hộp thoại, menu, toast — chốt selector khi build theo class thật) → `setVisible(false)`, ô giữ chỗ hiện ảnh `capturePage()`; hết lớp phủ thì hiện lại.
- Bounds: `ResizeObserver` + `getBoundingClientRect` của ô giữ chỗ → `setBounds` (làm tròn, nhân `zoomFactor` nếu khác 1).

**Đã thử, bỏ:** đặt pane chung chỗ DiffPane (DiffPane nằm dưới chat, trang chỉ cao ~40%); chèn cột giữa chat và lịch sử (cắt khối Chat Workspace); cài đặt vị trí panel đáy/phải như VS Code (phải giữ hai layout).

## Kế hoạch

1. [x] **Bản xem trước tĩnh** — đã trình ở cổng duyệt (widget trong chat). User duyệt cùng Kế hoạch.
2. [x] **URL helpers (main)** — `main/safeUrl.ts`: `isLoopbackUrl`, `previewNavDecision`, `normalizePreviewInput` (thêm `http://`). Kiểm: case mới trong `main/safeUrl.test.ts` (loopback v4/v6/localhost, có user:pass, `file:`, `javascript:`, host giả `localhost.evil.com`, `127.0.0.1.nip.io`).
3. [x] **Preview view (main + preload)** — `main/preview.ts` theo Thiết kế, gắn trong `createWindow`; preload thêm `window.silence.preview.{open,back,forward,reload,close,setBounds,setVisible,devtools,onState}`; `global.d.ts`. Kiểm: `tsc`; chạy Studio mở `localhost` của Vite dev server.
4. [x] **Cột pane phải** — `BottomPanel.tsx` → `SidePanel.tsx` (đổi tên, giữ tab cũ, thêm `preview`, nút phóng to); render làm cột thứ ba của `.shell`; CSS grid cho các tổ hợp chat/lịch sử/pane; kéo mép đổi bề rộng + nhớ; Ctrl+J, icon `PanelRight`, icon `Globe` + Ctrl+Shift+B; xterm `fit()` khi đổi bề rộng; bỏ tab "Xem trước" giả trong DiffPane; i18n VI/EN (`i18n.ts`). Kiểm: `tsc`, vitest (`langSweep`, i18n).
5. [x] **Tab Xem trước (renderer)** — `components/PreviewPane.tsx`: thanh URL, trạng thái trống/lỗi/từ chối, ô giữ chỗ + `ResizeObserver`, ẩn khi tab khác/cột đóng/phóng to chat, lớp phủ → ẩn + ảnh chụp; nhớ URL theo workspace. Kiểm: test logic thuần (`previewState.ts`: nhớ URL, chuẩn hoá) trong vitest.
6. [x] **Nguồn mở** — `MarkdownMessage` nhận `onOpenPreview`; link loopback → Xem trước, Ctrl+click → ngoài; Ports → Xem trước. Kiểm: case mới trong `MarkdownMessage.test.tsx`.
7. [x] **Docs** — `layout.md` (Khối, Grid, Shell flags, mục Cột pane + Xem trước), `frontend-shell.md`, `docs/threat-model.md` (mục pane Xem trước), `docs/codemap.md` nếu có mục liên quan. Kiểm: `npm run check:docs`, `npm run check:rules`.

## Tiêu chí xong

- [x] Kiểm URL ở main đúng: loopback mở trong pane, http(s) khác ra trình duyệt ngoài, scheme khác và host giả bị từ chối — kiểm: `npm test --workspace @silence/studio -- safeUrl` → 11 pass
- [x] Link localhost trong chat mở vào Xem trước, Ctrl+click và link không loopback ra ngoài — kiểm: `npm test --workspace @silence/studio -- MarkdownMessage` → 21 pass
- [x] Type và toàn bộ vitest Studio xanh — kiểm: `npx tsc --noEmit -p apps/studio` và `npm test --workspace @silence/studio` → tsc sạch, 59 file / 385 test pass
- [x] Docs và rule hợp lệ — kiểm: `npm run check:docs` và `npm run check:rules` → OK 26 docs, OK 6 rule
- [x] (user, chặn) Cột pane ngoài cùng bên phải, Ctrl+J bật/tắt, kéo rộng được và nhớ, phóng to/đóng, terminal gõ được và vừa khung — kiểm: `npm run studio`
- [x] (user, chặn) Xem trước mở dev server localhost, ← → ⟳ chạy, gõ URL ngoài bị từ chối, link ngoài trong trang ra trình duyệt ngoài, mở Settings/menu thì trang không đè lên — kiểm: `npm run studio`, mở `npm run studio:watch` hoặc dev server bất kỳ
- [x] (user) Ctrl+J / Ctrl+Shift+B vẫn chạy khi đang focus trong trang xem trước — kiểm: `npm run studio`

## Phát sinh

- Chia đôi cột pane (xem trang và log dev server cùng lúc, như Claude kéo pane).
- Chuyển Diff vào cột pane; gắn Problems / Debug Console.
- Thẻ server kiểu Claude (chạy/dừng dev server, nút Open) trên lõi TS, sau T-034 khi Ports bị xoá.

## Nhật ký

### 2026-11-27 16:35 · verify · Opus
- Quyết định: tay kéo đổi bề rộng nằm **ngoài** mép cột (left -7px) vì trang native đè lên mọi thứ bên phải mép; trong lúc kéo ẩn trang (`body[data-pane-drag]`) để trang không nuốt chuột.
- Phát hiện: gõ địa chỉ ngoài loopback khi đang có trang thì dòng từ chối bị trang che → ẩn trang khi có `notLocal`.
- Đã chạy thử bản build (`electron-vite preview`, không có Engine): mở `localhost:8765`, link loopback + Lùi, Settings đè trang → ảnh mờ, Ctrl+J từ trong trang, phóng to/thu nhỏ, kéo rộng/hẹp, nhớ tab + bề rộng sau khi mở lại. Chưa thử: Terminal (cần Engine), link ngoài trong trang mở trình duyệt ngoài, xin camera bị từ chối.
- 2026-11-27: user xác nhận ("ok") sau khi kiểm tay; đóng việc trong PR #91. Chat được app mở lại với mã phiên mới (611be935) nên `claim --takeover` từ 612c36e3 (cùng chat, đúng trường hợp T-036).
