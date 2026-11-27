import { ArrowLeft, ArrowRight, Code2, ExternalLink, RotateCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import {
  asPreviewState,
  EMPTY_PREVIEW,
  isPreviewable,
  normalizeInput,
  OVERLAY_SELECTOR,
  overlaps,
  readUrls,
  rememberUrl,
  URLS_KEY,
  type PreviewState,
} from "../previewState";

/**
 * Preview tab: toolbar + a placeholder. Main draws the page (a native WebContentsView) over the
 * placeholder's box; the view sits above all DOM, so it hides while a dialog/menu/toast overlaps it
 * and a dimmed screenshot stands in.
 */
export function PreviewPane(props: {
  /** Pane open, Preview tab selected, pane column on screen. */
  active: boolean;
  workspace: string;
  /** Open this URL (from a chat link, Ports, …); `n` changes on every request. */
  request: { url: string; n: number } | null;
}) {
  const t = useT();
  const api = window.silence?.preview;
  const [state, setState] = useState<PreviewState>(EMPTY_PREVIEW);
  const [input, setInput] = useState("");
  const [notLocal, setNotLocal] = useState("");
  const [shot, setShot] = useState<string | null>(null);
  const host = useRef<HTMLDivElement | null>(null);
  const editing = useRef(false);
  const occluded = useRef(false);
  const frame = useRef(0);
  const tried = useRef(false);
  /** Last bounds/visibility sent to main: chat streaming mutates the DOM every frame, so skip repeats. */
  const sent = useRef("");
  const live = useRef({ active: props.active, hasPage: false, error: "" });
  // A refused (non-loopback) address shows its message where the page was: hide the page for it.
  live.current = { active: props.active, hasPage: Boolean(state.url) && !notLocal, error: state.error };

  const open = useCallback(
    (raw: string) => {
      const url = normalizeInput(raw);
      if (!url || !api) return;
      if (!isPreviewable(url)) {
        setNotLocal(url);
        return;
      }
      setNotLocal("");
      setInput(url);
      void api.open(url);
    },
    [api],
  );

  // Page state from main (address, title, back/forward, error).
  useEffect(() => {
    if (!api) return;
    void api.state().then((s) => setState(asPreviewState(s)));
    return api.onState((s) => setState(asPreviewState(s)));
  }, [api]);

  useEffect(() => {
    if (!editing.current && state.url) setInput(state.url);
    if (state.url && !state.error && props.workspace) {
      const all = readUrls(localStorage.getItem(URLS_KEY));
      if (all[props.workspace] !== state.url) localStorage.setItem(URLS_KEY, JSON.stringify(rememberUrl(all, props.workspace, state.url)));
    }
  }, [state.url, state.error, props.workspace]);

  // First time the tab shows with no page: reopen the last URL of this workspace.
  useEffect(() => {
    if (!props.active || tried.current || state.url) return;
    tried.current = true;
    const last = readUrls(localStorage.getItem(URLS_KEY))[props.workspace];
    if (last) open(last);
    else setInput("");
  }, [props.active, props.workspace, state.url, open]);

  useEffect(() => {
    if (props.request) open(props.request.url);
  }, [props.request, open]);

  // Keep the native view on the placeholder; hide it under overlays or when the tab is not shown.
  const send = useCallback(
    (rect: { x: number; y: number; width: number; height: number } | null, show: boolean) => {
      if (!api) return;
      const key = rect ? `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)},${show}` : `-,${show}`;
      if (key === sent.current) return;
      sent.current = key;
      void api.layout(rect, show);
    },
    [api],
  );

  const sync = useCallback(async () => {
    if (!api) return;
    const el = host.current;
    const { active, hasPage, error } = live.current;
    const r = el?.getBoundingClientRect();
    const rect = r ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
    // Pane column being resized (SidePanel sets this): the page would grab the pointer.
    let covered = Boolean(document.body.dataset.paneDrag);
    if (r && active && !covered) {
      for (const o of document.querySelectorAll(OVERLAY_SELECTOR)) {
        const b = o.getBoundingClientRect();
        if (b.width > 0 && b.height > 0 && overlaps(b, r)) {
          covered = true;
          break;
        }
      }
    }
    const show = active && hasPage && !error && Boolean(rect && rect.width > 0 && rect.height > 0);
    if (covered && show && !occluded.current) {
      occluded.current = true;
      setShot(await api.capture());
      send(rect, false);
      return;
    }
    if (!covered && occluded.current) {
      occluded.current = false;
      setShot(null);
    }
    send(rect, show && !covered);
  }, [api, send]);

  const schedule = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => void sync());
  }, [sync]);

  useEffect(() => {
    schedule();
  }, [props.active, state.url, state.error, notLocal, schedule]);

  useEffect(() => {
    const el = host.current;
    if (!el || !api) return;
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    const drag = new MutationObserver(schedule);
    drag.observe(document.body, { attributes: true, attributeFilter: ["data-pane-drag"] });
    window.addEventListener("resize", schedule);
    return () => {
      ro.disconnect();
      mo.disconnect();
      drag.disconnect();
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame.current);
      sent.current = "";
      void api.layout(null, false);
    };
  }, [api, schedule]);

  if (!api) {
    return (
      <div className={`preview-pane${props.active ? "" : " hidden"}`}>
        <p className="hint">{t("preview.unavailable")}</p>
      </div>
    );
  }

  const outside = notLocal || state.url;
  return (
    <div className={`preview-pane${props.active ? "" : " hidden"}`}>
      <form
        className="preview-bar"
        onSubmit={(e) => {
          e.preventDefault();
          open(input);
        }}
      >
        <button type="button" className="side-tab-icon" title={t("preview.back")} disabled={!state.canGoBack} onClick={() => void api.nav("back")}>
          <ArrowLeft size={14} />
        </button>
        <button type="button" className="side-tab-icon" title={t("preview.forward")} disabled={!state.canGoForward} onClick={() => void api.nav("forward")}>
          <ArrowRight size={14} />
        </button>
        {state.loading ? (
          <button type="button" className="side-tab-icon" title={t("preview.stop")} onClick={() => void api.nav("stop")}>
            <X size={14} />
          </button>
        ) : (
          <button type="button" className="side-tab-icon" title={t("preview.reload")} disabled={!state.url} onClick={() => void api.nav("reload")}>
            <RotateCw size={14} />
          </button>
        )}
        <input
          className="preview-url"
          aria-label={t("preview.address")}
          placeholder={t("preview.placeholder")}
          spellCheck={false}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setNotLocal("");
          }}
          onFocus={(e) => {
            editing.current = true;
            e.target.select();
          }}
          onBlur={() => {
            editing.current = false;
          }}
        />
        <button
          type="button"
          className="side-tab-icon"
          title={t("preview.openExternal")}
          disabled={!outside}
          onClick={() => void window.silence.openExternal(notLocal || state.url)}
        >
          <ExternalLink size={14} />
        </button>
        <button type="button" className="side-tab-icon" title={t("preview.devtools")} disabled={!state.url} onClick={() => void api.nav("devtools")}>
          <Code2 size={14} />
        </button>
      </form>
      <div className="preview-host" ref={host}>
        {shot ? <img className="preview-shot" src={shot} alt="" draggable={false} /> : null}
        {notLocal ? (
          <div className="preview-msg error">
            <span>{t("preview.notLocal")}</span>
            <button type="button" onClick={() => void window.silence.openExternal(notLocal)}>
              {t("preview.openOutside")}
            </button>
          </div>
        ) : state.error ? (
          <div className="preview-msg error">
            <span>{t("preview.failed", { url: state.url || input, error: state.error })}</span>
            <button type="button" onClick={() => (state.url ? void api.nav("reload") : open(input))}>
              {t("preview.retry")}
            </button>
          </div>
        ) : !state.url ? (
          <div className="preview-msg">{t("preview.empty")}</div>
        ) : null}
      </div>
    </div>
  );
}
