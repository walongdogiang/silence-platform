import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "../i18n";
import { parseTip, placeTip, type Placement, type TipParts } from "../tooltip";

/** Delay before the first tip shows; once one has shown, neighbours show at once (warm). */
const SHOW_DELAY = 450;
const WARM_FOR = 400;

type Shown = { el: HTMLElement; text: string; parts: TipParts };

/** Accessibility attribute we set on an element when we took its `title`. */
const ownedA11y = new WeakMap<Element, "aria-label" | "aria-description">();

/**
 * Move `title` into `data-tip` so the native OS tooltip never shows, and keep the
 * accessible name/description the `title` used to give. React may set or remove `title`
 * later; the MutationObserver in `TooltipLayer` calls this again for each change.
 */
function adoptTitle(el: Element) {
  const text = el.getAttribute("title");
  if (text == null) return;
  el.removeAttribute("title");
  if (!text.trim()) {
    el.removeAttribute("data-tip");
    return;
  }
  el.setAttribute("data-tip", text);
  const owned = ownedA11y.get(el);
  if (!owned && (el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby"))) return;
  const iconOnly = !(el.textContent ?? "").trim();
  const attr = owned ?? (iconOnly ? "aria-label" : "aria-description");
  el.setAttribute(attr, text);
  ownedA11y.set(el, attr);
}

function dropTip(el: Element) {
  el.removeAttribute("data-tip");
  const owned = ownedA11y.get(el);
  if (owned) {
    el.removeAttribute(owned);
    ownedA11y.delete(el);
  }
}

function adoptTree(root: Element) {
  if (root.hasAttribute("title")) adoptTitle(root);
  root.querySelectorAll("[title]").forEach(adoptTitle);
}

/**
 * App-wide tooltip. Every `title` (and `data-tip`) in the renderer shows this styled tip
 * instead of the native one: themed, anchored to the element, shown on keyboard focus too,
 * Esc closes. A trailing "(Ctrl+J)" in the text renders as a muted shortcut and a
 * trailing "(not wired yet)" as a muted note — see `parseTip`. Mount once inside the
 * language provider.
 */
export function TooltipLayer() {
  const t = useT();
  const notes = [t("common.notWired")];
  const notesRef = useRef(notes);
  notesRef.current = notes;

  const [shown, setShown] = useState<Shown | null>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const shownRef = useRef<Shown | null>(null);
  shownRef.current = shown;

  // Convert native titles as soon as they appear or change.
  useEffect(() => {
    adoptTree(document.body);
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === "attributes") {
          const el = r.target as Element;
          if (r.attributeName !== "title") continue; // data-tip set directly: read on show/refresh below
          if (el.hasAttribute("title")) adoptTitle(el);
          else if (r.oldValue != null) dropTip(el); // React removed the title
        } else {
          r.addedNodes.forEach((n) => {
            if (n.nodeType === Node.ELEMENT_NODE) adoptTree(n as Element);
          });
        }
      }
      mo.takeRecords(); // our own removeAttribute("title") calls
      const cur = shownRef.current;
      if (cur) {
        const text = cur.el.getAttribute("data-tip");
        if (!text || !cur.el.isConnected) setShown(null);
        else if (tipKey(cur.el, text) !== cur.text)
          setShown({ el: cur.el, text: tipKey(cur.el, text), parts: partsOf(cur.el, text, notesRef.current) });
      }
    });
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["title", "data-tip", "data-tip-desc"],
      attributeOldValue: true,
    });
    return () => mo.disconnect();
  }, []);

  // Hover / focus tracking.
  useEffect(() => {
    let timer = 0;
    let pending: HTMLElement | null = null;
    let lastHide = 0;
    const anchorOf = (n: EventTarget | null) =>
      n instanceof Element ? (n.closest("[data-tip]") as HTMLElement | null) : null;

    const show = (el: HTMLElement) => {
      const text = el.getAttribute("data-tip");
      if (!text) return;
      setShown({ el, text: tipKey(el, text), parts: partsOf(el, text, notesRef.current) });
    };
    const schedule = (el: HTMLElement) => {
      if (shownRef.current?.el === el || pending === el) return;
      window.clearTimeout(timer);
      pending = null;
      const warm = shownRef.current != null || performance.now() - lastHide < WARM_FOR;
      if (warm) show(el);
      else {
        pending = el;
        timer = window.setTimeout(() => {
          pending = null;
          if (el.isConnected) show(el);
        }, SHOW_DELAY);
      }
    };
    const hide = () => {
      window.clearTimeout(timer);
      pending = null;
      if (shownRef.current) lastHide = performance.now();
      setShown(null);
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = anchorOf(e.target);
      if (el) schedule(el);
      else hide();
    };
    const onOut = (e: PointerEvent) => {
      const from = anchorOf(e.target);
      if (!from) return;
      const to = e.relatedTarget instanceof Node ? e.relatedTarget : null;
      if (to && from.contains(to)) return;
      if (!anchorOf(to)) hide();
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = anchorOf(e.target);
      if (el && (e.target as Element).matches(":focus-visible")) schedule(el);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && shownRef.current) hide();
    };

    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", hide, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("wheel", hide, { capture: true, passive: true });
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    window.addEventListener("resize", hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", hide, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("wheel", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
      window.removeEventListener("resize", hide);
    };
  }, []);

  // Measure, then place next to the anchor.
  useLayoutEffect(() => {
    if (!shown || !tipRef.current) {
      setPlace(null);
      return;
    }
    const r = shown.el.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    setPlace(
      placeTip(
        { left: r.left, top: r.top, width: r.width, height: r.height },
        { width: tip.width, height: tip.height },
        { width: window.innerWidth, height: window.innerHeight },
        6,
        8,
        shown.el.getAttribute("data-tip-side") === "above" ? "above" : "below",
      ),
    );
  }, [shown]);

  if (!shown) return null;
  const { parts } = shown;
  return createPortal(
    <div
      ref={tipRef}
      className={`app-tip${parts.desc ? " rich" : ""}${place ? ` on ${place.side}` : ""}`}
      aria-hidden="true"
      style={place ? { left: place.x, top: place.y } : { left: 0, top: 0 }}
    >
      <span className="app-tip-label">{parts.label}</span>
      {parts.note ? <span className="app-tip-note">{parts.note}</span> : null}
      {parts.keys ? <span className="app-tip-keys">{parts.keys.join("+")}</span> : null}
      {parts.desc ? <span className="app-tip-desc">{parts.desc}</span> : null}
    </div>,
    document.body,
  );
}

/** Label + optional `data-tip-desc` line. */
function partsOf(el: Element, text: string, notes: string[]): TipParts {
  const desc = el.getAttribute("data-tip-desc")?.trim();
  const parts = parseTip(text, notes);
  return desc ? { ...parts, desc } : parts;
}

/** Re-render the tip when either the label or the description changes. */
const tipKey = (el: Element, text: string) => `${text}\n${el.getAttribute("data-tip-desc") ?? ""}`;
