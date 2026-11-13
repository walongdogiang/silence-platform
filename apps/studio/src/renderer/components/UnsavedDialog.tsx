import { useEffect, useRef } from "react";
import { useT } from "../i18n";

/**
 * Asked when leaving Settings → Model with unsaved changes. Esc or the backdrop = Stay.
 */
export function UnsavedDialog(props: { onChoose: (choice: "save" | "discard" | "stay") => void }) {
  const t = useT();
  const saveRef = useRef<HTMLButtonElement>(null);
  const { onChoose } = props;

  useEffect(() => {
    saveRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onChoose("stay");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onChoose]);

  return (
    <div className="unsaved-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onChoose("stay")}>
      <div
        className="unsaved-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        aria-describedby="unsaved-body"
      >
        <h3 id="unsaved-title">{t("net.leaveTitle")}</h3>
        <p id="unsaved-body">{t("net.leaveBody")}</p>
        <div className="unsaved-actions">
          <button type="button" className="btn-light" onClick={() => onChoose("stay")}>
            {t("net.leaveStay")}
          </button>
          <button type="button" className="btn-light danger" onClick={() => onChoose("discard")}>
            {t("net.leaveDiscard")}
          </button>
          <button type="button" className="btn-solid" ref={saveRef} onClick={() => onChoose("save")}>
            {t("net.leaveSave")}
          </button>
        </div>
      </div>
    </div>
  );
}
