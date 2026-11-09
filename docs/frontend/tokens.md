---
description: Token màu và appearance của Studio — palette dark mặc định, panel Appearance, scrollbar, icon, màu link và syntax.
type: spec
code:
  - apps/studio/src/renderer/theme/tokens.css
  - apps/studio/src/renderer/theme/appearance.ts
  - apps/studio/src/renderer/components/AppearancePanel.tsx
---
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

## Link và syntax

| Token | Vai trò |
| --- | --- |
| `--link` / `--link-hover` | Link http(s) và đường dẫn file trong câu trả lời |
| `--diff-add` `--diff-del` `--diff-*-bg` `--diff-*-chg` | Màu diff (vạch, nền dòng, phần chữ đổi) kiểu GitHub/Claude, dùng cho bảng diff và Monaco; tách khỏi `--success`/`--error` của UI |
| `--syn-keyword` `--syn-string` `--syn-comment` `--syn-number` `--syn-type` `--syn-tag` `--syn-attr` `--syn-regexp` `--syn-punct` | Màu syntax trong code block và diff (`.tk-*`) |

Cả hai nhóm có bản dark (`:root`) và light (`[data-theme="light"]`) trong `theme/tokens.css`. Number và tag dùng tông copper cho hợp palette.
