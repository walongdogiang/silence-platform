import { Plus, X } from "lucide-react";
import type { Ref } from "react";
import { useT, type MsgKey } from "../i18n";
import { SoftScroll } from "./SoftScroll";

export type PanelTab = "terminal" | "output" | "problems" | "debug" | "ports";

const TABS: { id: PanelTab; label: MsgKey; live?: boolean }[] = [
  { id: "problems", label: "panel.problems" },
  { id: "output", label: "panel.output", live: true },
  { id: "debug", label: "panel.debug" },
  { id: "terminal", label: "panel.terminal", live: true },
  { id: "ports", label: "panel.ports" },
];

export function BottomPanel(props: {
  open: boolean;
  tab: PanelTab;
  onTab: (t: PanelTab) => void;
  onClose: () => void;
  termRef: Ref<HTMLDivElement>;
  output: string[];
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
        {props.tab === "problems" || props.tab === "debug" || props.tab === "ports" ? (
          <p className="hint">{tr("panel.notWired", { tab: tr(TABS.find((t) => t.id === props.tab)?.label ?? "panel.problems") })}</p>
        ) : null}
      </div>
    </section>
  );
}
