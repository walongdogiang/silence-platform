import { ChevronLeft, ChevronRight, Copy, Download, PencilLine, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { copyImageToClipboard } from "../pastedImages";
import { downloadImage, downloadPng, fileNameFor, isSvgDataUrl } from "../imageActions";
import { useT } from "../i18n";

/** Ảnh đang phóng to: danh sách ảnh của cùng một tin + vị trí đang xem. */
export type LightboxState = { images: string[]; index: number } | null;

/**
 * Xem ảnh phóng to: Esc / click nền / × để đóng, ←/→ đổi ảnh, click ảnh đổi
 * "vừa khung" ↔ "kích thước thật". Copy ảnh (PNG vào clipboard), Lưu ảnh (hộp thoại lưu);
 * ảnh SVG có hai nút Lưu: PNG 2x theo `viewBox` và SVG gốc.
 */
export function ImageLightbox(props: {
  images: string[];
  index: number;
  onClose: () => void;
  /** Mở trình chỉnh sửa cho ảnh đang xem. */
  onEdit?: (src: string) => void;
}) {
  const t = useT();
  const [index, setIndex] = useState(props.index);
  const [actual, setActual] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const count = props.images.length;
  const src = props.images[Math.min(index, count - 1)];
  const { onClose } = props;

  useEffect(() => {
    // Trả focus về phần tử đã mở lightbox khi đóng.
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    setActual(false);
    setStatus(null);
  }, [index]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Không để Escape đóng luôn menu/panel phía sau.
        e.stopPropagation();
        onClose();
      } else if (e.key === "ArrowLeft" && count > 1) {
        setIndex((i) => (i - 1 + count) % count);
      } else if (e.key === "ArrowRight" && count > 1) {
        setIndex((i) => (i + 1) % count);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [count, onClose]);

  if (!src) return null;
  const isSvg = isSvgDataUrl(src);

  async function copy() {
    try {
      await copyImageToClipboard(src);
      setStatus(t("img.copied"));
    } catch {
      setStatus(t("img.copyFailed"));
    }
  }

  function save() {
    downloadImage(src, fileNameFor(src, { n: index + 1 }));
  }

  async function savePng() {
    try {
      await downloadPng(src, fileNameFor(src, { n: index + 1, ext: "png" }));
    } catch {
      setStatus(t("img.pngFailed"));
    }
  }

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={t("img.viewer")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="lightbox-bar" onMouseDown={(e) => e.stopPropagation()}>
        {count > 1 ? (
          <span className="lightbox-count">
            {index + 1} / {count}
          </span>
        ) : null}
        {status ? (
          <span className="lightbox-status" role="status">
            {status}
          </span>
        ) : null}
        <span className="lightbox-spacer" />
        {props.onEdit ? (
          <button type="button" className="lightbox-btn" onClick={() => props.onEdit?.(src)} title={t("img.editTip")}>
            <PencilLine size={15} />
            <span>{t("img.edit")}</span>
          </button>
        ) : null}
        <button type="button" className="lightbox-btn" onClick={() => void copy()} title={t("img.copy")}>
          <Copy size={15} />
          <span>{t("common.copy")}</span>
        </button>
        {isSvg ? (
          <>
            <button type="button" className="lightbox-btn" onClick={() => void savePng()} title={t("img.savePng")}>
              <Download size={15} />
              <span>PNG</span>
            </button>
            <button type="button" className="lightbox-btn" onClick={save} title={t("img.saveSvg")}>
              <Download size={15} />
              <span>SVG</span>
            </button>
          </>
        ) : (
          <button type="button" className="lightbox-btn" onClick={save} title={t("img.save")}>
            <Download size={15} />
            <span>{t("common.save")}</span>
          </button>
        )}
        <button ref={closeRef} type="button" className="lightbox-btn" onClick={onClose} title={t("img.closeEsc")} aria-label={t("common.close")}>
          <X size={16} />
        </button>
      </div>
      <div
        className={`lightbox-stage${actual ? " actual" : ""}`}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <img
          src={src}
          alt={t("img.alt", { n: index + 1 })}
          title={actual ? t("img.fit") : t("img.actual")}
          onClick={() => setActual((v) => !v)}
        />
      </div>
      {count > 1 ? (
        <>
          <button
            type="button"
            className="lightbox-nav prev"
            aria-label={t("img.prev")}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setIndex((i) => (i - 1 + count) % count)}
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            className="lightbox-nav next"
            aria-label={t("img.next")}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setIndex((i) => (i + 1) % count)}
          >
            <ChevronRight size={20} />
          </button>
        </>
      ) : null}
    </div>
  );
}
