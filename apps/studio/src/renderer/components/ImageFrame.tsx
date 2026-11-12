import { Check, Copy, Download, PencilLine } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { copyImageToClipboard, downloadImage, downloadPng, fileNameFor, isSvgDataUrl } from "../imageActions";

/**
 * Ảnh trong chat có thanh thao tác khi hover / focus (như app ảnh): góc phải trên **Tải**
 * (SVG: menu PNG / SVG) và **Copy as image** (icon; thành công → icon ✓ rồi trở lại); góc trái dưới **Chỉnh sửa** (mở trình đánh dấu).
 * Bấm ảnh = phóng to như cũ. `compact`: ảnh nhỏ (dải ảnh) — nút chỉ có icon.
 */
/** "Copied" giữ bao lâu trước khi nút trở lại "Copy as image". */
export const COPIED_MS = 1800;

export function ImageFrame(props: {
  src: string;
  alt: string;
  /** Đường dẫn workspace: dùng đặt tên file khi tải. */
  path?: string;
  /** Gợi ý tên file khi không có `path` / `data-filename` (vd. `<title>` của SVG). */
  name?: string;
  title?: string;
  className?: string;
  imgStyle?: CSSProperties;
  compact?: boolean;
  onOpen?: () => void;
  onEdit?: () => void;
  onImgError?: () => void;
}) {
  const { src } = props;
  const svg = isSvgDataUrl(src);
  const [menu, setMenu] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  function flash(text: string) {
    setNote(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(null), 1600);
  }

  async function copy() {
    try {
      await copyImageToClipboard(src);
      // Nút tự đổi icon Copy → ✓ (chuyển mượt), giữ rồi trở lại.
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      setCopied(false);
      flash("Không copy được");
    }
  }

  async function png() {
    setMenu(false);
    try {
      await downloadPng(src, fileNameFor(src, { path: props.path, name: props.name, ext: "png" }));
    } catch {
      flash("Không xuất được PNG");
    }
  }

  return (
    <span
      className={`img-frame${props.compact ? " compact" : ""}${menu || copied ? " menu-open" : ""}${props.className ? ` ${props.className}` : ""}`}
      onMouseLeave={() => setMenu(false)}
    >
      <button type="button" className="img-frame-open" title={props.title ?? "Bấm để phóng to"} onClick={props.onOpen}>
        <img src={src} alt={props.alt} style={props.imgStyle} onError={props.onImgError} />
      </button>
      <span className="img-frame-tools">
        {note ? (
          <span className="img-frame-note" role="status">
            {note}
          </span>
        ) : null}
        <span className="img-frame-dl">
          <button
            type="button"
            className="img-frame-btn"
            title={svg ? "Tải ảnh (PNG / SVG)" : "Tải ảnh"}
            aria-label="Tải ảnh"
            aria-haspopup={svg ? "menu" : undefined}
            aria-expanded={svg ? menu : undefined}
            onClick={() => (svg ? setMenu((v) => !v) : downloadImage(src, fileNameFor(src, { path: props.path, name: props.name })))}
          >
            <Download size={15} />
          </button>
          {svg && menu ? (
            <span className="img-frame-menu" role="menu">
              <button type="button" role="menuitem" title="PNG, nét gấp đôi" onClick={() => void png()}>
                <Download size={15} />
                Download as PNG
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  downloadImage(src, fileNameFor(src, { path: props.path, name: props.name, ext: "svg" }));
                }}
              >
                <Download size={15} />
                Download as SVG
              </button>
            </span>
          ) : null}
        </span>
        <button
          type="button"
          className={`img-frame-btn img-frame-copy${copied ? " copied" : ""}`}
          title={copied ? "Copied" : "Copy as image"}
          aria-label="Copy as image"
          onClick={() => void copy()}
        >
          <span className="img-frame-swap" aria-hidden="true">
            <span className="swap-a">
              <Copy size={15} />
            </span>
            <span className="swap-b">
              <Check size={15} />
            </span>
          </span>
        </button>
        <span className="sr-only" role="status">
          {copied ? "Copied" : ""}
        </span>
      </span>
      {props.onEdit ? (
        <button
          type="button"
          className="img-frame-edit"
          title="Chỉnh sửa hình ảnh: đánh dấu rồi nhờ agent sửa"
          aria-label="Chỉnh sửa hình ảnh"
          onClick={props.onEdit}
        >
          <PencilLine size={14} />
          {props.compact ? null : <span>Chỉnh sửa</span>}
        </button>
      ) : null}
    </span>
  );
}
