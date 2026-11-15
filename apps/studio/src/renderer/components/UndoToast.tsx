import { Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";

/** Thời gian toast "Đã xoá · Hoàn tác" còn hiện (ms). */
export const UNDO_MS = 8000;
const TICK_MS = 100;

/**
 * Toast sau khi xoá một chat: Hoàn tác trong `UNDO_MS`, có đếm ngược (số giây + thanh tiến trình).
 * Rê chuột / focus vào toast thì dừng đếm. Ctrl+Z (khi không gõ trong ô nhập) cũng hoàn tác.
 * Nằm giữa trên cùng cửa sổ để không đè composer / menu chế độ ở đáy.
 */
export function UndoToast(props: { title: string; onUndo: () => void; onDismiss: () => void }) {
  const t = useT();
  const [left, setLeft] = useState(UNDO_MS);
  const paused = useRef(false);
  const cb = useRef(props);
  cb.current = props;

  useEffect(() => {
    const id = window.setInterval(() => {
      if (paused.current) return;
      setLeft((ms) => Math.max(0, ms - TICK_MS));
    }, TICK_MS);
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      cb.current.onUndo();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // Hết giờ: đóng (ngoài setState để không gọi cha trong lúc cập nhật).
  useEffect(() => {
    if (left <= 0) cb.current.onDismiss();
  }, [left]);

  const secs = Math.ceil(left / 1000);
  const hold = (on: boolean) => () => {
    paused.current = on;
  };

  return (
    <div
      className="app-toast undo-toast"
      role="status"
      aria-live="polite"
      onMouseEnter={hold(true)}
      onMouseLeave={hold(false)}
      onFocus={hold(true)}
      onBlur={hold(false)}
    >
      <Trash2 size={14} strokeWidth={2} className="app-toast-ico undo-toast-ico" aria-hidden />
      <span className="undo-toast-text">{t("history.deletedToast", { title: props.title })}</span>
      <button type="button" className="undo-toast-btn" onClick={props.onUndo}>
        {t("history.undo")}
        <span className="undo-toast-secs" aria-label={t("history.undoSecs", { n: secs })}>
          {secs}s
        </span>
      </button>
      <button type="button" className="undo-toast-close" aria-label={t("common.close")} onClick={props.onDismiss}>
        <X size={13} aria-hidden />
      </button>
      <i className="undo-toast-bar" aria-hidden style={{ transform: `scaleX(${left / UNDO_MS})` }} />
    </div>
  );
}
