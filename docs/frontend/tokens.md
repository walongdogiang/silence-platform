# Tokens & appearance

Nguồn: `theme/tokens.css`, `theme/appearance.ts`. Giữ graphite + copper; không đổi palette khi chỉ sửa layout.

## Mặc định dark (espresso / graphite)

| Token | Vai trò |
| --- | --- |
| `--workspace` `#191a1c` | Nền chat |
| `--surface-1..3` | Sidebar, card, hover |
| `--accent` `#e5a05b` | CTA, mode pill, send |
| `--on-accent` `#171819` | Chữ trên accent |
| `--accent-soft` `#f0d4b0` | Auto, điểm nhấn nhẹ |
| `--text-primary/secondary/muted` | Hệ chữ |

Accent chỉ cho hành động chính (mode, send, focus). Không sơn cam cả UI.

## Appearance

`silence.appearance.v2`: theme, palette, accent, density, wallpaper, blur, reduceMotion. Panel `AppearancePanel.tsx`. Customize history → mở panel này.

## Scrollbar (Cursor-like)

Token: `--scroll-size` 6px; `--scroll-thumb-idle` (mờ) / `--scroll-thumb` / `--scroll-thumb-hover`. Thumb `border-radius: 999px`. Electron Windows: tắt `OverlayScrollbar` trong `main` để bo tròn có hiệu lực. Áp dụng `.chat-pane`, `.history-list`, panel dưới.

## Icon

`lucide-react`. Titlebar window buttons: stroke đậm, hover scale + glow copper.
