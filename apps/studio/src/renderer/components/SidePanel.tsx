import { AlertTriangle, ExternalLink, Maximize2, Minimize2, Plus, Square, X } from "lucide-react";
import { useRef, useState, type ReactNode, type Ref } from "react";
import { useT, type MsgKey } from "../i18n";
import { SoftScroll } from "./SoftScroll";
import { isLocalUrl, procState, sortProcs, type ProcRow } from "../procs";
import { shortUrl, type BrowserView } from "../browserView";
import { clampPaneWidth } from "../paneLayout";

export type PanelTab = "terminal" | "output" | "problems" | "debug" | "ports" | "preview" | "browser";

const TABS: { id: PanelTab; label: MsgKey; live?: boolean }[] = [
  { id: "terminal", label: "panel.terminal", live: true },
  { id: "output", label: "panel.output", live: true },
  { id: "ports", label: "panel.ports", live: true },
  { id: "preview", label: "panel.preview", live: true },
  { id: "browser", label: "panel.browser", live: true },
  { id: "problems", label: "panel.problems" },
  { id: "debug", label: "panel.debug" },
];

/** Pane column: outermost right column of the shell (Terminal, Output, Ports, Preview, …). */
export function SidePanel(props: {
  open: boolean;
  tab: PanelTab;
  onTab: (t: PanelTab) => void;
  onClose: () => void;
  maximized: boolean;
  onToggleMax: () => void;
  /** New width in px while the user drags the left edge. */
  onResize: (width: number) => void;
  termRef: Ref<HTMLDivElement>;
  output: string[];
  /** Background processes of the open chat (`proc` events / `proc.list`). */
  procs?: ProcRow[];
  onStopProc?: (id: string) => void;
  onOpenUrl?: (url: string) => void;
  /** What the agent's headless browser shows (`browser` events). */
  browser?: BrowserView | null;
  /** Preview tab body; stays mounted so the page survives tab switches. */
  preview: ReactNode;
}) {
  const tr = useT();
  const [dragging, setDragging] = useState(false);
  const pointer = useRef<number | null>(null);
  return (
    <section className={`side-panel${props.open ? "" : " hidden"}`} aria-label={tr("panel.label")}>
      {!props.maximized ? (
        <div
          className={`side-resize${dragging ? " on" : ""}`}
          role="separator"
          aria-orientation="vertical"
          title={tr("panel.resize")}
          onPointerDown={(e) => {
            e.preventDefault();
            pointer.current = e.pointerId;
            e.currentTarget.setPointerCapture(e.pointerId);
            // The native Preview page would swallow the pointer once it passes over it: hide it while dragging.
            document.body.dataset.paneDrag = "1";
            setDragging(true);
          }}
          onPointerMove={(e) => {
            if (pointer.current !== e.pointerId) return;
            props.onResize(clampPaneWidth(window.innerWidth - e.clientX, window.innerWidth));
          }}
          onPointerUp={(e) => {
            if (pointer.current !== e.pointerId) return;
            pointer.current = null;
            delete document.body.dataset.paneDrag;
            setDragging(false);
          }}
          onPointerCancel={() => {
            pointer.current = null;
            delete document.body.dataset.paneDrag;
            setDragging(false);
          }}
        />
      ) : null}
      <div className="side-tabs">
        <div className="side-tablist" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={props.tab === t.id}
              className={props.tab === t.id ? "active" : ""}
              title={t.live ? tr(t.label) : `${tr(t.label)} (${tr("common.notWired")})`}
              onClick={() => props.onTab(t.id)}
            >
              {tr(t.label)}
            </button>
          ))}
        </div>
        {props.tab === "terminal" ? (
          <button type="button" className="side-tab-icon" title={tr("panel.newTerminal")} disabled>
            <Plus size={14} />
          </button>
        ) : null}
        <button
          type="button"
          className="side-tab-icon"
          title={props.maximized ? tr("panel.restore") : tr("panel.maximize")}
          aria-pressed={props.maximized}
          onClick={props.onToggleMax}
        >
          {props.maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button type="button" className="side-tab-icon" title={tr("panel.close")} onClick={props.onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="side-body">
        <div className={props.tab === "terminal" ? "term-fill" : "term-fill hidden"} ref={props.termRef} />
        {props.preview}
        {props.tab === "output" ? (
          <SoftScroll className="side-output-scroll" deps={[props.output.length, props.output[props.output.length - 1]]}>
            <pre className="side-output">
              {props.output.length === 0 ? tr("panel.noOutput") : props.output.join("\n")}
            </pre>
          </SoftScroll>
        ) : null}
        {props.tab === "browser" ? <BrowserPane view={props.browser ?? null} onOpen={props.onOpenUrl} /> : null}
        {props.tab === "ports" ? <PortsList procs={props.procs ?? []} onStop={props.onStopProc} onOpen={props.onOpenUrl} /> : null}
        {props.tab === "problems" || props.tab === "debug" ? (
          <p className="hint">{tr("panel.notWired", { tab: tr(TABS.find((t) => t.id === props.tab)?.label ?? "panel.problems") })}</p>
        ) : null}
      </div>
    </section>
  );
}

/** Ports tab: one row per background process — status, command, localhost URLs, Stop. */
function PortsList(props: { procs: ProcRow[]; onStop?: (id: string) => void; onOpen?: (url: string) => void }) {
  const tr = useT();
  if (props.procs.length === 0) return <p className="hint">{tr("ports.empty")}</p>;
  return (
    <SoftScroll className="side-output-scroll" deps={[props.procs]}>
      <ul className="ports-list">
        {sortProcs(props.procs).map((p) => {
          const state = procState(p.status);
          return (
            <li key={p.id} className={`ports-row ${state}`}>
              <span className={`ports-dot ${state}`} aria-hidden />
              <span className="ports-status" title={p.status}>
                {tr(`ports.status.${state}`)}
                {state === "exited" && p.status !== "exited" ? ` (${p.status.replace(/^exited /, "")})` : ""}
              </span>
              <code className="ports-cmd" title={p.command}>
                {p.command}
              </code>
              <span className="ports-urls">
                {p.urls.filter(isLocalUrl).map((u) => (
                  <button
                    key={u}
                    type="button"
                    className="ports-url"
                    title={tr("md.openPreview")}
                    onClick={() => props.onOpen?.(u)}
                  >
                    {u.replace(/^https?:\/\//, "")}
                    <ExternalLink size={12} aria-hidden />
                  </button>
                ))}
              </span>
              {state === "running" && props.onStop ? (
                <button type="button" className="ports-stop" title={tr("ports.stopTip")} onClick={() => props.onStop?.(p.id)}>
                  <Square size={11} aria-hidden /> {tr("ports.stop")}
                </button>
              ) : (
                <i />
              )}
            </li>
          );
        })}
      </ul>
    </SoftScroll>
  );
}

/** Browser tab: read-only mirror of the agent's headless browser — address, title, last frame, error counts. */
function BrowserPane(props: { view: BrowserView | null; onOpen?: (url: string) => void }) {
  const tr = useT();
  const v = props.view;
  if (!v) return <p className="hint">{tr("browser.empty")}</p>;
  return (
    <div className="browser-pane">
      <div className="browser-bar">
        <button
          type="button"
          className="browser-url"
          title={isLocalUrl(v.url) ? tr("md.openPreview") : v.url}
          disabled={!isLocalUrl(v.url)}
          onClick={() => props.onOpen?.(v.url)}
        >
          {shortUrl(v.url)}
          {isLocalUrl(v.url) ? <ExternalLink size={12} aria-hidden /> : null}
        </button>
        <span className="browser-title" title={v.title}>
          {v.title}
        </span>
        {v.errors > 0 ? (
          <span className="browser-badge error" title={tr("browser.errorsTip")}>
            <AlertTriangle size={12} aria-hidden /> {tr("browser.errors", { n: v.errors })}
          </span>
        ) : null}
        {v.failed > 0 ? (
          <span className="browser-badge" title={tr("browser.failedTip")}>
            {tr("browser.failed", { n: v.failed })}
          </span>
        ) : null}
      </div>
      <div className="browser-frame">
        {v.frame ? <img src={v.frame} alt={tr("browser.frameAlt", { url: shortUrl(v.url) })} draggable={false} /> : null}
      </div>
    </div>
  );
}
