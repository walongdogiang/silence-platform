# Composer

Bám Cursor chat input. File: `components/Composer.tsx`.

## Cấu trúc (trên → dưới)

1. **Context Usage panel** — chỉ khi bấm vòng gauge.
2. **Files + Review** — chỉ khi `files.length > 0` (tree workspace). Ẩn khi 0 Files.
3. **Textarea** — placeholder luôn: `Plan, Build, / for skills, @ for context`.
4. **Hàng dưới:** mode + Auto (trái) · tools (phải).

## Mode

Thứ tự menu: **Plan → Agent → Debug → MultiTask → Review → Ask**. Icon: List, Infinity, Bug, Users, GitCompare, MessageCircle.

Nút trigger: pill 22px, `border-radius: 999px`, nền `--accent`, chữ/icon `--on-accent` (đen trên copper). Auto **sát phải** mode, **không viền**.

Plan → `mode=plan`; Agent/Code → `mode=agent`. Debug / MultiTask / Ask: UI, chưa gắn runtime.

## Cụm phải

| Trạng thái | Icon |
| --- | --- |
| Ô trống | gauge context · kẹp giấy (tệp) · mic (chưa gắn) · waveform (chưa gắn) |
| Có chữ (`prompt.trim()`) | gauge · kẹp giấy · **mũi tên Enter** (ẩn mic + waveform) |

- **Vòng gauge** = Show context usage, **không** phải Image. Tiến độ `input_tokens / 256_000`: 0 = chỉ track mờ, 256k = kín. Tooltip CSS (không native Windows).
- Panel usage: hàng Conversation dùng token thật; các hàng System/Tools/Rules… = 0 cho đến khi runtime gửi breakdown.
- Enter xóa ô **ngay**. Nút gửi disable nếu chưa session/busy.

## Files menu

Mở xuống từ chip (khi có file) hoặc lên từ kẹp giấy (khi 0 file, chỉ usage). “Show context usage” một dòng, `min-width: 240px`.
