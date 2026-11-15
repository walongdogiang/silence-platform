import { Archive, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useT } from "../i18n";

/**
 * Xác nhận xoá một đoạn chat (menu ⋯ → Xoá). Nút mặc định là Huỷ (an toàn); Esc / bấm nền = Huỷ.
 * Gợi ý "Lưu trữ" làm lối thoát đảo ngược được khi chat chưa lưu trữ.
 */
export function DeleteChatDialog(props: {
  title: string;
  /** Số tin nhắn của user trong chat, để người dùng biết sắp mất bao nhiêu. */
  turns: number;
  onCancel: () => void;
  onDelete: () => void;
  /** Có thì hiện nút "Lưu trữ thay vì xoá". */
  onArchive?: () => void;
}) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { onCancel } = props;

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      // Giữ Tab trong hộp thoại.
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
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div className="unsaved-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        ref={boxRef}
        className="unsaved-dialog delete-chat-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-chat-title"
        aria-describedby="delete-chat-body"
      >
        <h3 id="delete-chat-title">
          <Trash2 size={16} aria-hidden />
          {t("history.deleteTitle")}
        </h3>
        <p id="delete-chat-body">
          <q className="delete-chat-name">{props.title}</q>{" "}
          {t(
            props.turns === 0 ? "history.deleteBodyEmpty" : props.turns === 1 ? "history.deleteBodyOne" : "history.deleteBody",
            { count: props.turns },
          )}
        </p>
        <div className="unsaved-actions">
          {props.onArchive && (
            <button type="button" className="btn-light delete-chat-archive" onClick={props.onArchive}>
              <Archive size={14} aria-hidden />
              {t("history.deleteArchiveInstead")}
            </button>
          )}
          <button type="button" className="btn-light" ref={cancelRef} onClick={onCancel}>
            {t("common.cancel")}
          </button>
          <button type="button" className="btn-light danger delete-chat-confirm" onClick={props.onDelete}>
            {t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
