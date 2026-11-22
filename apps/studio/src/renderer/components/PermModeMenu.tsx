import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Hand, MessageCircle, PencilLine, ShieldAlert, ShieldCheck } from "lucide-react";
import { useT } from "../i18n";
import { PERM_MODES, permModeAvailable, type UiPermMode } from "../permissionUi";

const ICON: Record<UiPermMode, typeof ShieldCheck> = {
  ask: MessageCircle,
  manual: Hand,
  accept_edits: PencilLine,
  auto: ShieldCheck,
  bypass: ShieldAlert,
};

/**
 * Permission mode picker next to the chat input (like Claude Code). While Bypass is on the trigger
 * stays red, so it is visible on every turn. Unavailable modes are listed but disabled with the reason.
 */
export function PermModeMenu(props: {
  mode: UiPermMode;
  onMode: (m: UiPermMode) => void;
  coreOn: boolean;
  bypassEnabled: boolean;
  /** Open Settings → Permissions (to turn Bypass on). */
  onOpenSettings?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = PERM_MODES.find((m) => m.id === props.mode) ?? PERM_MODES[3]!;
  const Icon = ICON[current.id];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="mode-dd" ref={ref}>
      <button
        type="button"
        className={`mode-trigger perm-trigger perm-trigger-${current.id}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t("permmenu.label")}: ${t(current.label)}`}
        data-tip={t(current.desc)}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon size={14} />
        <span>{t(current.label)}</span>
        <ChevronDown size={12} className={open ? "mode-chev open" : "mode-chev"} />
      </button>
      {open ? (
        <div className="mode-menu perm-menu" role="menu" aria-label={t("permmenu.label")}>
          {PERM_MODES.map((m) => {
            const ok = permModeAvailable(m.id, props.coreOn, props.bypassEnabled);
            const why = ok ? t(m.desc) : m.id === "bypass" && props.coreOn ? t("permmenu.bypassOff") : t("permmenu.needsCore");
            const ItemIcon = ICON[m.id];
            return (
              <button
                key={m.id}
                type="button"
                role="menuitemradio"
                aria-checked={props.mode === m.id}
                aria-disabled={!ok}
                className={`mode-item${props.mode === m.id ? " active" : ""}${ok ? "" : " disabled"}${m.id === "bypass" ? " perm-item-bypass" : ""}`}
                title={why}
                onClick={() => {
                  if (!ok) {
                    if (m.id === "bypass" && props.coreOn) props.onOpenSettings?.();
                    return;
                  }
                  props.onMode(m.id);
                  setOpen(false);
                }}
              >
                <ItemIcon size={14} />
                <span>{t(m.label)}</span>
                {props.mode === m.id ? <Check size={13} className="mode-check" /> : <span />}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
