import { MessageSquare, PanelRight, Plus, X } from "lucide-react";
import type { ChatThread } from "../models";

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
  return (
    <div className="chat-tabs" aria-label="Tab hội thoại">
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
              title={t.title}
              onClick={() => props.onSelect(t.id)}
            >
              <MessageSquare size={14} strokeWidth={1.75} />
              <span>{t.title}</span>
            </button>
            <button
              type="button"
              className="chat-tab-close"
              title="Đóng tab"
              aria-label={`Đóng ${t.title}`}
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
        title="New Agent"
        onClick={props.onNew}
      >
        <Plus size={15} strokeWidth={1.75} />
      </button>
      {props.historyHidden && props.onToggleHistory ? (
        <button
          type="button"
          className="chat-tab-new"
          title="Toggle Agents Side Bar (Ctrl+Alt+U)"
          aria-label="Hiện thanh Agents"
          onClick={props.onToggleHistory}
        >
          <PanelRight size={15} strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}
