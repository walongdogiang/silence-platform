import { MessageSquare, PanelRight, Plus, X } from "lucide-react";
import { useT } from "../i18n";
import type { ChatThread } from "../models";
import { shownTitle } from "./ChatHistoryPanel";

export function ChatTabBar(props: {
  tabs: ChatThread[];
  activeId: string;
  canNew: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  historyHidden?: boolean;
  onToggleHistory?: () => void;
}) {
  const tr = useT();
  return (
    <div className="chat-tabs" aria-label={tr("tabs.label")}>
      <div className="chat-tab-list" role="tablist">
        {props.tabs.map((t) => (
          <div
            key={t.id}
            className={`chat-tab ${t.id === props.activeId ? "active" : ""}`}
            role="tab"
            aria-selected={t.id === props.activeId}
          >
            <button
              type="button"
              className="chat-tab-open"
              title={shownTitle(t.title, tr)}
              onClick={() => props.onSelect(t.id)}
            >
              <MessageSquare size={14} strokeWidth={1.75} />
              <span>{shownTitle(t.title, tr)}</span>
            </button>
            <button
              type="button"
              className="chat-tab-close"
              title={tr("tabs.close")}
              aria-label={tr("tabs.closeNamed", { title: shownTitle(t.title, tr) })}
              onClick={(e) => {
                e.stopPropagation();
                props.onClose(t.id);
              }}
            >
              <X size={12} strokeWidth={2} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="chat-tab-new"
        disabled={!props.canNew}
        title={tr("history.newAgent")}
        onClick={props.onNew}
      >
        <Plus size={15} strokeWidth={1.75} />
      </button>
      {props.historyHidden && props.onToggleHistory ? (
        <button
          type="button"
          className="chat-tab-new"
          title={tr("shell.toggleAgents")}
          aria-label={tr("shell.showAgents")}
          onClick={props.onToggleHistory}
        >
          <PanelRight size={15} strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}
