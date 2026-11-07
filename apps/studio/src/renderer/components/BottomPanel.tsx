import { Plus, X } from "lucide-react";
import type { Ref } from "react";
import { SoftScroll } from "./SoftScroll";

export type PanelTab = "terminal" | "output" | "problems" | "debug" | "ports";

const TABS: { id: PanelTab; label: string; live?: boolean }[] = [
  { id: "problems", label: "Problems" },
  { id: "output", label: "Output", live: true },
  { id: "debug", label: "Debug Console" },
  { id: "terminal", label: "Terminal", live: true },
  { id: "ports", label: "Ports" },
];

export function BottomPanel(props: {
  open: boolean;
  tab: PanelTab;
  onTab: (t: PanelTab) => void;
  onClose: () => void;
  termRef: Ref<HTMLDivElement>;
  output: string[];
}) {
  return (
    <section className={`bottom-panel${props.open ? "" : " hidden"}`} aria-label="Panel">
      <div className="bottom-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={props.tab === t.id ? "active" : ""}
            title={t.live ? t.label : `${t.label} (chưa gắn)`}
            onClick={() => props.onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <span className="bottom-tabs-spacer" />
        {props.tab === "terminal" ? (
          <button type="button" className="bottom-tab-icon" title="New Terminal (chưa gắn)" disabled>
            <Plus size={14} />
          </button>
        ) : null}
        <button type="button" className="bottom-tab-icon" title="Đóng panel" onClick={props.onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="bottom-body">
        <div className={props.tab === "terminal" ? "term-fill" : "term-fill hidden"} ref={props.termRef} />
        {props.tab === "output" ? (
          <SoftScroll className="bottom-output-scroll" deps={[props.output.length, props.output[props.output.length - 1]]}>
            <pre className="bottom-output">
              {props.output.length === 0 ? "Chưa có output." : props.output.join("\n")}
            </pre>
          </SoftScroll>
        ) : null}
        {props.tab === "problems" || props.tab === "debug" || props.tab === "ports" ? (
          <p className="hint">{TABS.find((t) => t.id === props.tab)?.label} chưa gắn backend.</p>
        ) : null}
      </div>
    </section>
  );
}
