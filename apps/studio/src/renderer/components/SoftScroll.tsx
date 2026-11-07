import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") ref(value);
  else (ref as { current: T | null }).current = value;
}

/** Thanh cuộn overlay kiểu Cursor — pill mỏng, bo tròn thật (không phụ thuộc ::-webkit-scrollbar Windows). */
export function SoftScroll(props: {
  children: ReactNode;
  className?: string;
  viewportRef?: Ref<HTMLDivElement>;
  deps?: unknown[];
}) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [thumb, setThumb] = useState({ h: 0, top: 0, needed: false });
  const drag = useRef<{ y: number; top: number } | null>(null);

  const sync = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const needed = scrollHeight > clientHeight + 2;
    if (!needed) {
      setThumb((t) => (t.needed ? { h: 0, top: 0, needed: false } : t));
      return;
    }
    const track = clientHeight;
    const h = Math.max(28, Math.round((clientHeight / scrollHeight) * track));
    const maxTop = Math.max(0, track - h);
    const top =
      scrollHeight === clientHeight
        ? 0
        : Math.round((scrollTop / (scrollHeight - clientHeight)) * maxTop);
    setThumb({ h, top, needed: true });
  }, []);

  useEffect(() => {
    sync();
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => sync());
    ro.observe(el);
    const child = el.firstElementChild;
    if (child) ro.observe(child);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps from parent content
  }, [sync, ...(props.deps ?? [])]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const el = viewportRef.current;
      const d = drag.current;
      if (!el || !d) return;
      const { scrollHeight, clientHeight } = el;
      const h = Math.max(28, Math.round((clientHeight / scrollHeight) * clientHeight));
      const maxTop = Math.max(0, clientHeight - h);
      const nextTop = Math.min(maxTop, Math.max(0, d.top + (e.clientY - d.y)));
      const maxScroll = scrollHeight - clientHeight;
      el.scrollTop = maxTop === 0 ? 0 : (nextTop / maxTop) * maxScroll;
    }
    function onUp() {
      drag.current = null;
      document.body.classList.remove("soft-scroll-dragging");
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div className={`soft-scroll${props.className ? ` ${props.className}` : ""}`}>
      <div
        className="soft-scroll-viewport"
        ref={(node) => {
          viewportRef.current = node;
          assignRef(props.viewportRef, node);
        }}
        onScroll={sync}
      >
        {props.children}
      </div>
      {thumb.needed ? (
        <div className="soft-scroll-rail" aria-hidden>
          <div
            className="soft-scroll-thumb"
            style={{ height: thumb.h, transform: `translateY(${thumb.top}px)` }}
            onMouseDown={(e) => {
              e.preventDefault();
              drag.current = { y: e.clientY, top: thumb.top };
              document.body.classList.add("soft-scroll-dragging");
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
