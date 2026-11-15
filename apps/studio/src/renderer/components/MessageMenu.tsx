import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export type MessageMenuItem =
  | "divider"
  | {
      id: string;
      label: string;
      /** Second muted line (what the action does), as in Rewind / Fork. */
      desc?: string;
      icon: ReactNode;
      /** Single letter that runs the item while the menu is open. */
      kbd?: string;
      danger?: boolean;
      disabled?: boolean;
      run: () => void;
    };

/** Where the menu opens: the pointer (right-click) or under an element (keyboard). */
export type MenuAt = { x: number; y: number };

/**
 * Right-click menu of a chat message. Fixed at the pointer so SoftScroll never clips it; flips
 * left / up near the window edges. Esc closes, ↑↓ move, the item's letter runs it.
 * Same look as the history ⋯ menu (`.history-menu`).
 */
export function MessageMenu(props: { at: MenuAt; items: MessageMenuItem[]; label: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Nơi mở menu (tin nhắn / bong bóng): Esc trả focus về đó để người dùng bàn phím không mất chỗ.
  const opener = useRef<HTMLElement | null>(document.activeElement as HTMLElement | null);
  const [pos, setPos] = useState<CSSProperties>({
    position: "fixed",
    left: props.at.x,
    top: props.at.y,
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(props.at.x, window.innerWidth - w - 8));
    const top = props.at.y + h <= window.innerHeight - 8 ? props.at.y : Math.max(8, props.at.y - h);
    setPos({ position: "fixed", left, top });
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [props.at]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) props.onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        const back = opener.current;
        props.onClose();
        if (back && document.contains(back)) back.focus();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const btns = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        if (!btns.length) return;
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? btns.length - 1
              : e.key === "ArrowDown"
                ? (i + 1) % btns.length
                : (i - 1 + btns.length) % btns.length;
        btns[next]?.focus();
        return;
      }
      const key = e.key.toUpperCase();
      const hit = props.items.find((x) => x !== "divider" && x.kbd === key && !x.disabled);
      if (hit && hit !== "divider") {
        e.preventDefault();
        hit.run();
      }
    }
    const close = () => props.onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [props]);

  return (
    <div
      ref={ref}
      className="history-menu msg-menu"
      role="menu"
      aria-label={props.label}
      style={pos}
      onContextMenu={(e) => e.preventDefault()}
    >
      {props.items.map((x, i) =>
        x === "divider" ? (
          <hr key={`d${i}`} className="history-menu-sep" />
        ) : (
          <button
            key={x.id}
            type="button"
            role="menuitem"
            className={`history-menu-item${x.danger ? " danger" : ""}${x.desc ? " has-desc" : ""}`}
            disabled={x.disabled}
            onClick={x.run}
            // Rê chuột = chọn: không còn hai dòng sáng cùng lúc (hover + focus từ bàn phím).
            onMouseMove={(e) => {
              if (document.activeElement !== e.currentTarget) e.currentTarget.focus({ preventScroll: true });
            }}
          >
            {x.icon}
            <span className="msg-menu-text">
              <span>{x.label}</span>
              {x.desc ? <small className="msg-menu-desc">{x.desc}</small> : null}
            </span>
            {x.kbd ? <kbd>{x.kbd}</kbd> : <i />}
          </button>
        ),
      )}
    </div>
  );
}
