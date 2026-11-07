import { ArrowLeft, ArrowRight, MessageSquare, Minus, PanelBottom, Settings, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import logo from "../assets/logo.png";

type MenuId = "file" | "edit" | "selection" | "view" | "go" | "run" | "terminal" | "help";

const MENU_LABELS: { id: MenuId; label: string }[] = [
  { id: "file", label: "File" },
  { id: "edit", label: "Edit" },
  { id: "selection", label: "Selection" },
  { id: "view", label: "View" },
  { id: "go", label: "Go" },
  { id: "run", label: "Run" },
  { id: "terminal", label: "Terminal" },
  { id: "help", label: "Help" },
];

export function TitleBar(props: {
  wsName: string;
  chatHidden: boolean;
  panelOpen: boolean;
  historyHidden: boolean;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onTogglePanel: () => void;
  onOpenTerminal: () => void;
  onToggleChatWorkspace: () => void;
  onToggleHistory: () => void;
  onSettings: () => void;
  onOpenWorkspace: () => void;
  onQuit: () => void;
}) {
  const [open, setOpen] = useState<MenuId | null>(null);
  const chat = !props.chatHidden;

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  function items(id: MenuId): { label: string; run?: () => void; off?: boolean }[] {
    if (id === "file") {
      return [
        { label: "Mở workspace", run: props.onOpenWorkspace },
        { label: "Thoát", run: props.onQuit },
      ];
    }
    if (id === "view") {
      return [
        { label: "Chat Workspace", run: props.onToggleChatWorkspace },
        { label: props.historyHidden ? "Hiện thanh Agents" : "Ẩn thanh Agents", run: props.onToggleHistory, off: !chat },
        { label: "Toggle Panel", run: props.onTogglePanel },
      ];
    }
    if (id === "terminal") {
      return [
        { label: "Terminal", run: props.onOpenTerminal },
        { label: "Toggle Panel", run: props.onTogglePanel },
      ];
    }
    return [{ label: "Chưa gắn", off: true }];
  }

  return (
    <div className="app-chrome">
      <div className="chrome-left no-drag">
        <button type="button" className="mark" title="5ilence Studio" aria-label="5ilence Studio">
          <img src={logo} alt="" width={16} height={16} draggable={false} />
        </button>
        <div className="chrome-menu">
          {MENU_LABELS.map((m) => (
            <div key={m.id} className="chrome-menu-item" onMouseDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                className={open === m.id ? "on" : ""}
                onClick={() => setOpen((v) => (v === m.id ? null : m.id))}
              >
                {m.label}
              </button>
              {open === m.id && (
                <div className="chrome-drop">
                  {items(m.id).map((it) => (
                    <button
                      key={it.label}
                      type="button"
                      disabled={it.off}
                      onClick={() => {
                        it.run?.();
                        setOpen(null);
                      }}
                    >
                      {it.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="chrome-nav">
          <button
            type="button"
            className="chrome-icon"
            title="Back"
            disabled={!props.canBack}
            onClick={props.onBack}
          >
            <ArrowLeft size={16} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="chrome-icon"
            title="Forward"
            disabled={!props.canForward}
            onClick={props.onForward}
          >
            <ArrowRight size={16} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="chrome-title">{props.wsName}</div>

      <div className="chrome-right no-drag">
        <button
          type="button"
          className={`chrome-icon ${props.panelOpen ? "on" : ""}`}
          aria-pressed={props.panelOpen}
          title="Toggle Panel (Ctrl+J)"
          onClick={props.onTogglePanel}
        >
          <PanelBottom size={15} />
        </button>
        <button
          type="button"
          className={`chrome-icon ${chat ? "on" : ""}`}
          aria-pressed={chat}
          title={chat ? "Ẩn Chat Workspace" : "Hiện Chat Workspace"}
          onClick={props.onToggleChatWorkspace}
        >
          <MessageSquare size={15} />
        </button>
        <button type="button" className="chrome-icon" title="Settings" onClick={props.onSettings}>
          <Settings size={15} />
        </button>
        <div className="win-btns">
          <button type="button" onClick={() => void window.silence?.window.minimize()} aria-label="Thu nhỏ">
            <Minus size={16} strokeWidth={2.4} aria-hidden />
          </button>
          <button type="button" onClick={() => void window.silence?.window.maximize()} aria-label="Phóng to">
            <Square size={11} strokeWidth={1.75} aria-hidden />
          </button>
          <button type="button" className="x" onClick={props.onQuit} aria-label="Đóng">
            <X size={12} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
