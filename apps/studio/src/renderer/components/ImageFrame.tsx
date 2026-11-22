import { Check, Copy, Download, MoreHorizontal, PencilLine } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { copyImageToClipboard, downloadImage, downloadPng, fileNameFor, isSvgDataUrl } from "../imageActions";
import { useT } from "../i18n";

/**
 * Ảnh trong chat có **một** cụm thao tác khi hover / focus (như app ảnh), góc phải trên:
 * **Chỉnh sửa** (mở trình đánh dấu) · **Copy as image** (thành công → icon ✓ rồi trở lại) ·
 * **Tải** (SVG: menu PNG / SVG) · **⋯** (thao tác phụ do chỗ gọi truyền vào, vd. mã SVG).
 * Không có nút nào đè lên phần còn lại của ảnh. Bấm ảnh = phóng to.
 * `compact`: ảnh nhỏ (dải ảnh) — nút nhỏ hơn.
 */
/** "Copied" giữ bao lâu trước khi nút trở lại "Copy as image". */
export const COPIED_MS = 1800;

/** Mục trong menu ⋯. `done`: chữ báo ngắn sau khi chạy xong (vd. "Đã copy mã"). */
export type ImageMoreItem = {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void | Promise<void>;
  done?: string;
  failed?: string;
};

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
  more?: ImageMoreItem[];
}) {
  const t = useT();
  const { src } = props;
  const svg = isSvgDataUrl(src);
  const [menu, setMenu] = useState<"dl" | "more" | null>(null);
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
      flash(t("img.copyFailedShort"));
    }
  }

  async function png() {
    setMenu(null);
    try {
      await downloadPng(src, fileNameFor(src, { path: props.path, name: props.name, ext: "png" }));
    } catch {
      flash(t("img.pngFailed"));
    }
  }

  async function runMore(item: ImageMoreItem) {
    setMenu(null);
    try {
      await item.onSelect();
      if (item.done) flash(item.done);
    } catch {
      if (item.failed) flash(item.failed);
    }
  }

  const more = props.more?.length ? props.more : null;
  const toggle = (m: "dl" | "more") => setMenu((v) => (v === m ? null : m));

  return (
    <span
      className={`img-frame${props.compact ? " compact" : ""}${menu || copied || note ? " menu-open" : ""}${props.className ? ` ${props.className}` : ""}`}
      onMouseLeave={() => setMenu(null)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && menu) {
          e.stopPropagation();
          setMenu(null);
        }
      }}
    >
      <button type="button" className="img-frame-open" title={props.title ?? t("img.clickToZoom")} onClick={props.onOpen}>
        <img src={src} alt={props.alt} style={props.imgStyle} onError={props.onImgError} />
      </button>
      {note ? (
        <span className="img-frame-note" role="status">
          {note}
        </span>
      ) : null}
      <span className="img-frame-tools" role="toolbar" aria-label={t("img.actions")}>
        {props.onEdit ? (
          <button
            type="button"
            className="img-frame-btn img-frame-edit"
            title={t("img.editImageTip")}
            aria-label={t("img.editImage")}
            onClick={props.onEdit}
          >
            <PencilLine size={15} />
          </button>
        ) : null}
        <button
          type="button"
          className={`img-frame-btn img-frame-copy${copied ? " copied" : ""}`}
          title={copied ? t("common.copied") : t("img.copyAs")}
          aria-label={t("img.copyAs")}
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
        <span className="img-frame-pop">
          <button
            type="button"
            className="img-frame-btn"
            title={svg ? t("img.downloadSvgTip") : t("img.download")}
            aria-label={t("img.download")}
            aria-haspopup={svg ? "menu" : undefined}
            aria-expanded={svg ? menu === "dl" : undefined}
            onClick={() => (svg ? toggle("dl") : downloadImage(src, fileNameFor(src, { path: props.path, name: props.name })))}
          >
            <Download size={15} />
          </button>
          {svg && menu === "dl" ? (
            <span className="img-frame-menu" role="menu">
              <button type="button" role="menuitem" title={t("img.png2x")} onClick={() => void png()}>
                <Download size={15} />
                {t("img.downloadPng")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  downloadImage(src, fileNameFor(src, { path: props.path, name: props.name, ext: "svg" }));
                }}
              >
                <Download size={15} />
                {t("img.downloadSvg")}
              </button>
            </span>
          ) : null}
        </span>
        {more ? (
          <span className="img-frame-pop">
            <button
              type="button"
              className="img-frame-btn"
              title={t("img.more")}
              aria-label={t("img.more")}
              aria-haspopup="menu"
              aria-expanded={menu === "more"}
              onClick={() => toggle("more")}
            >
              <MoreHorizontal size={15} />
            </button>
            {menu === "more" ? (
              <span className="img-frame-menu" role="menu">
                {more.map((item) => (
                  <button key={item.key} type="button" role="menuitem" onClick={() => void runMore(item)}>
                    {item.icon}
                    {item.label}
                  </button>
                ))}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
      <span className="sr-only" role="status">
        {copied ? t("common.copied") : ""}
      </span>
    </span>
  );
}
