import { useEffect, useRef, type ReactNode } from "react";
import { useT } from "../i18n";

export type ConfirmRequest = {
  title: string;
  body: string;
  /** Nhãn nút xác nhận (mặc định "OK"). */
  confirmLabel?: string;
  /** Hành động phá huỷ: nút xác nhận đỏ. Nút mặc định (focus) luôn là Huỷ. */
  danger?: boolean;
  icon?: ReactNode;
};

/**
 * Hộp thoại xác nhận dùng chung (thay window.confirm). Focus sẵn ở Huỷ; Esc / bấm nền = Huỷ;
 * Tab chỉ chạy trong hộp. Cùng kiểu với DeleteChatDialog.
 */
export function ConfirmDialog(props: ConfirmRequest & { onResult: (ok: boolean) => void }) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { onResult } = props;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onResult(false);
        return;
      }
      if (e.key === "Tab") {
        const btns = Array.from(boxRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
        if (!btns.length) return;
        const first = btns[0];
        const last = btns[btns.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      // Trả focus về chỗ cũ nếu nó còn trong trang (huỷ hoặc xong việc).
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [onResult]);

  return (
    <div className="unsaved-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onResult(false)}>
      <div
        ref={boxRef}
        className="unsaved-dialog delete-chat-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
      >
        <h3 id="confirm-title">
          {props.icon ? <span className={props.danger ? "confirm-ico danger" : "confirm-ico"}>{props.icon}</span> : null}
          {props.title}
        </h3>
        <p id="confirm-body">{props.body}</p>
        <div className="unsaved-actions">
          <button type="button" className="btn-light" ref={cancelRef} onClick={() => onResult(false)}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={props.danger ? "btn-light danger delete-chat-confirm" : "btn-solid"}
            onClick={() => onResult(true)}
          >
            {props.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
