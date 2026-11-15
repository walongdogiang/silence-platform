import { ExternalLink, Plus, Square, X } from "lucide-react";
import type { Ref } from "react";
import { useT, type MsgKey } from "../i18n";
import { SoftScroll } from "./SoftScroll";
import { isLocalUrl, procState, sortProcs, type ProcRow } from "../procs";

export type PanelTab = "terminal" | "output" | "problems" | "debug" | "ports";

const TABS: { id: PanelTab; label: MsgKey; live?: boolean }[] = [
  { id: "problems", label: "panel.problems" },
  { id: "output", label: "panel.output", live: true },
  { id: "debug", label: "panel.debug" },
  { id: "terminal", label: "panel.terminal", live: true },
  { id: "ports", label: "panel.ports", live: true },
];

export function BottomPanel(props: {
  open: boolean;
  tab: PanelTab;
  onTab: (t: PanelTab) => void;
  onClose: () => void;
  termRef: Ref<HTMLDivElement>;
  output: string[];
  /** Background processes of the open chat (`proc` events / `proc.list`). */
  procs?: ProcRow[];
  onStopProc?: (id: string) => void;
  onOpenUrl?: (url: string) => void;
}) {
  const tr = useT();
  return (
    <section className={`bottom-panel${props.open ? "" : " hidden"}`} aria-label={tr("panel.label")}>
      <div className="bottom-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={props.tab === t.id ? "active" : ""}
            title={t.live ? tr(t.label) : `${tr(t.label)} (${tr("common.notWired")})`}
            onClick={() => props.onTab(t.id)}
          >
            {tr(t.label)}
          </button>
        ))}
        <span className="bottom-tabs-spacer" />
        {props.tab === "terminal" ? (
          <button type="button" className="bottom-tab-icon" title={tr("panel.newTerminal")} disabled>
            <Plus size={14} />
          </button>
        ) : null}
        <button type="button" className="bottom-tab-icon" title={tr("panel.close")} onClick={props.onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="bottom-body">
        <div className={props.tab === "terminal" ? "term-fill" : "term-fill hidden"} ref={props.termRef} />
        {props.tab === "output" ? (
          <SoftScroll className="bottom-output-scroll" deps={[props.output.length, props.output[props.output.length - 1]]}>
            <pre className="bottom-output">
              {props.output.length === 0 ? tr("panel.noOutput") : props.output.join("\n")}
            </pre>
          </SoftScroll>
        ) : null}
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
    <SoftScroll className="bottom-output-scroll" deps={[props.procs]}>
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
                    title={tr("ports.open", { url: u })}
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
