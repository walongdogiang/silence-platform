import { ArrowLeft, ArrowRight, FlaskConical, MessageSquare, Minus, PanelBottom, Settings, Square, X, BarChart3 } from "lucide-react";
import { useEffect, useState } from "react";
import logo from "../assets/logo.png";
import { useT, type MsgKey } from "../i18n";

type MenuId = "file" | "edit" | "selection" | "view" | "go" | "run" | "terminal" | "help";

const MENU_LABELS: { id: MenuId; label: MsgKey }[] = [
  { id: "file", label: "menu.file" },
  { id: "edit", label: "menu.edit" },
  { id: "selection", label: "menu.selection" },
  { id: "view", label: "menu.view" },
  { id: "go", label: "menu.go" },
  { id: "run", label: "menu.run" },
  { id: "terminal", label: "menu.terminal" },
  { id: "help", label: "menu.help" },
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
  /** Evals page (dev checkout only: undefined hides the button and the menu item). */
  evals?: { open: boolean; running: boolean; progress: string; onToggle: () => void };
  /** Metrics page (roadmap 1.10); absent when the TS core is not running. */
  metrics?: { open: boolean; onToggle: () => void };
  onOpenWorkspace: () => void;
  onQuit: () => void;
}) {
  const t = useT();
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
        { label: t("common.openWorkspace"), run: props.onOpenWorkspace },
        { label: t("menu.quit"), run: props.onQuit },
      ];
    }
    if (id === "view") {
      return [
        { label: "Chat Workspace", run: props.onToggleChatWorkspace },
        { label: props.historyHidden ? t("shell.showAgents") : t("shell.hideAgents"), run: props.onToggleHistory, off: !chat },
        { label: t("shell.togglePanel"), run: props.onTogglePanel },
        ...(props.evals ? [{ label: t("evals.menu"), run: props.evals.onToggle }] : []),
      ];
    }
    if (id === "terminal") {
      return [
        { label: t("menu.terminal"), run: props.onOpenTerminal },
        { label: t("shell.togglePanel"), run: props.onTogglePanel },
      ];
    }
    return [{ label: t("common.notWiredCap"), off: true }];
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
                {t(m.label)}
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
            title={t("shell.back")}
            disabled={!props.canBack}
            onClick={props.onBack}
          >
            <ArrowLeft size={16} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="chrome-icon"
            title={t("shell.forward")}
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
          title={t("shell.togglePanelKey")}
          onClick={props.onTogglePanel}
        >
          <PanelBottom size={15} />
        </button>
        <button
          type="button"
          className={`chrome-icon ${chat ? "on" : ""}`}
          aria-pressed={chat}
          title={chat ? t("shell.hideChat") : t("shell.showChat")}
          onClick={props.onToggleChatWorkspace}
        >
          <MessageSquare size={15} />
        </button>
        {props.evals ? (
          <button
            type="button"
            className={`chrome-icon chrome-evals ${props.evals.open ? "on" : ""} ${props.evals.running ? "running" : ""}`}
            aria-pressed={props.evals.open}
            title={props.evals.running ? props.evals.progress : t("evals.openKey")}
            onClick={props.evals.onToggle}
          >
            <FlaskConical size={15} />
            {props.evals.running ? <span className="chrome-evals-chip">{props.evals.progress}</span> : null}
          </button>
        ) : null}
        {props.metrics ? (
          <button
            type="button"
            className={`chrome-icon ${props.metrics.open ? "on" : ""}`}
            aria-pressed={props.metrics.open}
            title={t("metrics.title")}
            onClick={props.metrics.onToggle}
          >
            <BarChart3 size={15} />
          </button>
        ) : null}
        <button type="button" className="chrome-icon" title={t("shell.settings")} onClick={props.onSettings}>
          <Settings size={15} />
        </button>
        <div className="win-btns">
          <button type="button" onClick={() => void window.silence?.window.minimize()} aria-label={t("shell.minimize")}>
            <Minus size={16} strokeWidth={2.4} aria-hidden />
          </button>
          <button type="button" onClick={() => void window.silence?.window.maximize()} aria-label={t("shell.maximize")}>
            <Square size={11} strokeWidth={1.75} aria-hidden />
          </button>
          <button type="button" className="x" onClick={props.onQuit} aria-label={t("common.close")}>
            <X size={12} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
