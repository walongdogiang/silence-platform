import {
  ArrowUp,
  AudioLines,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  GitCompare,
  Infinity as InfinityIcon,
  List,
  MessageCircle,
  Mic,
  Minus,
  Paperclip,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { modelParts, modelTitle, speedLabel } from "../theme/modelsPrefs";
import type { ModelInfo } from "../types";

export type SessionMode = "agent" | "plan" | "ask" | "debug" | "review" | "multitask";

const MODES = [
  { id: "Plan", title: "Plan", mode: "plan", desc: "Chỉ đọc, lập kế hoạch để bạn duyệt rồi mới sửa", Icon: List },
  { id: "Agent", title: "Agent", mode: "agent", desc: "Đọc, sửa file, chạy lệnh (hỏi quyền, có diff)", Icon: InfinityIcon },
  { id: "Debug", title: "Debug", mode: "debug", desc: "Tái hiện, tìm nguyên nhân, sửa nhỏ nhất, chạy lại; gửi kèm log Output", Icon: Bug },
  { id: "MultiTask", title: "MultiTask", mode: "multitask", desc: "Tách việc độc lập, giao cho sub-agent, tổng hợp kết quả", Icon: Users },
  { id: "Review", title: "Review", mode: "review", desc: "Chỉ đọc, review thay đổi chưa commit, báo lỗi theo mức độ", Icon: GitCompare },
  { id: "Ask", title: "Ask", mode: "ask", desc: "Chỉ đọc, hỏi đáp về code, không sửa", Icon: MessageCircle },
] as const;

const modeLabel = (mode: SessionMode) => MODES.find((m) => m.mode === mode)?.id ?? "Agent";

const CTX_MAX = 256_000;

function modelTip(id: string, models: ModelInfo[]) {
  if (id === "auto") {
    return {
      body: "Balanced quality and speed, recommended for most tasks.",
      kicker: "Model",
      name: "Auto",
    };
  }
  const m = models.find((x) => x.id === id);
  if (!m) return null;
  const bits = [`${fmtTok(m.context_window)} context`];
  if (m.tools) bits.push("tools");
  if (m.vision) bits.push("vision");
  return { body: bits.join(" · "), kicker: speedLabel(m.tier) || "Model", name: modelTitle(m) };
}

function fmtTok(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function UsageRing(props: { pct: number; size?: number }) {
  const size = props.size ?? 15;
  const r = 5.5;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, Math.max(0, props.pct / 100));
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeWidth="1.55" opacity="0.22" />
      {frac > 0 ? (
        <circle
          cx="8"
          cy="8"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.55"
          strokeLinecap={frac >= 0.995 ? "butt" : "round"}
          strokeDasharray={`${frac * c} ${c}`}
          transform="rotate(-90 8 8)"
        />
      ) : null}
    </svg>
  );
}

export function Composer(props: {
  prompt: string;
  onPrompt: (v: string) => void;
  onSend: () => void;
  onChip: (chip: string) => void;
  mode: SessionMode;
  model: string;
  models: ModelInfo[];
  onModel: (id: string) => void;
  busy: boolean;
  disabled: boolean;
  files?: string[];
  tokens?: number;
  onOpenFile?: (path: string) => void;
  onAddModels?: () => void;
}) {
  const [modeOpen, setModeOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelQ, setModelQ] = useState("");
  const [hoverModel, setHoverModel] = useState<string | null>(null);
  const [tipY, setTipY] = useState(0);
  const [filesOpen, setFilesOpen] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [picked, setPicked] = useState<string>(modeLabel(props.mode));
  const modeRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLDivElement>(null);
  const current = MODES.find((m) => m.id === picked) ?? MODES[1];
  const selected = props.model === "auto" ? null : props.models.find((x) => x.id === props.model);
  const selectedParts = selected ? modelParts(selected) : null;
  const modelPicker = useMemo(() => {
    const needle = modelQ.trim().toLowerCase();
    const hit = (text: string) => !needle || text.toLowerCase().includes(needle);
    const rows = props.models.filter((m) => hit(`${modelTitle(m)} ${m.id} ${m.tier}`));
    return { showAuto: hit("auto"), rows };
  }, [modelQ, props.models]);
  const hoverTip = hoverModel ? modelTip(hoverModel, props.models) : null;

  useEffect(() => {
    setPicked(modeLabel(props.mode));
  }, [props.mode]);

  useEffect(() => {
    if (!modelOpen) {
      setModelQ("");
      setHoverModel(null);
      return;
    }
    const id = window.setTimeout(() => modelSearchRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [modelOpen]);

  useEffect(() => {
    if (!modeOpen && !modelOpen && !filesOpen) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (!modeRef.current?.contains(t)) setModeOpen(false);
      if (!modelRef.current?.contains(t)) setModelOpen(false);
      if (!filesRef.current?.contains(t)) setFilesOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setModeOpen(false);
        setModelOpen(false);
        setFilesOpen(false);
        setShowUsage(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [modeOpen, modelOpen, filesOpen]);

  function pick(id: (typeof MODES)[number]["id"]) {
    setPicked(id);
    setModeOpen(false);
    props.onChip(id);
  }

  const hasText = Boolean(props.prompt.trim());
  const canSend = !props.busy && !props.disabled && hasText;
  const files = props.files ?? [];
  const listed = files.slice(0, 12);
  const tokens = props.tokens ?? 0;
  const ctxPct = Math.min(100, Math.round((tokens / CTX_MAX) * 100));
  const usageRows = [
    { label: "System prompt", color: "#9aa0a6", n: 0 },
    { label: "Tool definitions", color: "#a78bfa", n: 0 },
    { label: "Rules", color: "#4ccb91", n: 0 },
    { label: "Skills", color: "#e5a05b", n: 0 },
    { label: "MCP & dynamic tools", color: "#c084fc", n: 0 },
    { label: "Subagent definitions", color: "#f0abfc", n: 0 },
    { label: "Summarized conversation", color: "#e87979", n: 0 },
    { label: "Conversation", color: "#a67c7c", n: tokens },
  ];

  function toggleFiles() {
    setFilesOpen((v) => !v);
    setModeOpen(false);
    setModelOpen(false);
  }

  const filesMenu = filesOpen ? (
    <div className={`mode-menu files-menu${files.length ? "" : " files-menu-up"}`} role="menu">
      {listed.map((p) => (
        <button
          key={p}
          type="button"
          role="menuitem"
          className="mode-item files-item"
          onClick={() => {
            props.onOpenFile?.(p);
            setFilesOpen(false);
          }}
        >
          <FileText size={14} />
          <span>{p.replace(/\\/g, "/").split("/").pop()}</span>
        </button>
      ))}
      {files.length > listed.length ? (
        <p className="files-empty">+{files.length - listed.length} tệp nữa</p>
      ) : null}
      {listed.length === 0 ? <p className="files-empty">Chưa có tệp trong ngữ cảnh.</p> : null}
      <button
        type="button"
        role="menuitem"
        className="mode-item files-usage-btn"
        onClick={() => {
          setShowUsage(true);
          setFilesOpen(false);
        }}
      >
        Show context usage
      </button>
    </div>
  ) : null;

  return (
    <div className="composer-stack">
      {showUsage ? (
        <div className="ctx-report">
          <div className="ctx-report-head">
            <b>Context Usage</b>
            <span>View Report</span>
            <button type="button" className="ctx-report-close" title="Đóng" onClick={() => setShowUsage(false)}>
              <Minus size={14} />
            </button>
          </div>
          <div className="ctx-report-meta">
            <span>{ctxPct}% Full</span>
            <span>
              ~{fmtTok(tokens)} / {fmtTok(CTX_MAX)} Tokens
            </span>
          </div>
          <i className="ctx-report-bar">
            {usageRows
              .filter((r) => r.n > 0)
              .map((r) => (
                <b key={r.label} style={{ width: `${(r.n / CTX_MAX) * 100}%`, background: r.color }} />
              ))}
          </i>
          <ul className="ctx-report-list">
            {usageRows.map((r) => (
              <li key={r.label}>
                <i style={{ background: r.color }} />
                <span>{r.label}</span>
                <em>{fmtTok(r.n)}</em>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSend();
      }}
    >
      {files.length > 0 ? (
        <div className="composer-ctx">
          <div className="mode-dd composer-files-dd" ref={filesRef}>
            <button type="button" className="composer-files" aria-expanded={filesOpen} onClick={toggleFiles}>
              <ChevronRight size={14} className={filesOpen ? "files-chev open" : "files-chev"} />
              <span>
                {files.length} File{files.length === 1 ? "" : "s"}
              </span>
            </button>
            {files.length > 0 ? filesMenu : null}
          </div>
          <button
            type="button"
            className="composer-review"
            title="Review thay đổi chưa commit (chỉ đọc)"
            onClick={() => props.onChip("ReviewChanges")}
          >
            Review
          </button>
        </div>
      ) : null}
      <textarea
        value={props.prompt}
        onChange={(e) => props.onPrompt(e.target.value)}
        placeholder="Plan, Build, / for skills, @ for context"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            props.onSend();
          }
        }}
      />
      <div className="composer-row">
        <div className="mode-dd" ref={modeRef}>
          <button
            type="button"
            className="mode-trigger"
            aria-haspopup="menu"
            aria-expanded={modeOpen}
            onClick={() => {
              setModeOpen((v) => !v);
              setModelOpen(false);
            }}
          >
            <current.Icon size={14} />
            <span>{current.title}</span>
            <ChevronDown size={12} className={modeOpen ? "mode-chev open" : "mode-chev"} />
          </button>
          {modeOpen ? (
            <div className="mode-menu" role="menu">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="menuitem"
                  className={`mode-item${picked === m.id ? " active" : ""}`}
                  title={m.desc}
                  onClick={() => pick(m.id)}
                >
                  <m.Icon size={14} />
                  <span>{m.title}</span>
                  {picked === m.id ? <Check size={13} className="mode-check" /> : <span />}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="mode-dd" ref={modelRef}>
          <button
            type="button"
            className="model-trigger"
            aria-haspopup="menu"
            aria-expanded={modelOpen}
            onClick={() => {
              setModelOpen((v) => !v);
              setModeOpen(false);
            }}
          >
            <span>
              {props.model === "auto" ? (
                "Auto"
              ) : selectedParts ? (
                <>
                  {selectedParts.name}
                  {selectedParts.speed ? <span className="model-speed"> {selectedParts.speed}</span> : null}
                </>
              ) : (
                props.model
              )}
            </span>
            <ChevronDown size={12} className={modelOpen ? "mode-chev open" : "mode-chev"} />
          </button>
          {modelOpen ? (
            <div
              className="mode-menu model-menu"
              role="menu"
              onMouseLeave={() => setHoverModel(null)}
            >
              {hoverTip ? (
                <aside className="model-tip" style={{ top: tipY }} role="tooltip">
                  <p>{hoverTip.body}</p>
                  <div>
                    <small>{hoverTip.kicker}</small>
                    <b>{hoverTip.name}</b>
                  </div>
                </aside>
              ) : null}
              <label className="model-search">
                <Search size={13} />
                <input
                  ref={modelSearchRef}
                  value={modelQ}
                  onChange={(e) => setModelQ(e.target.value)}
                  placeholder="Search models"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.preventDefault();
                    e.stopPropagation();
                  }}
                />
              </label>
              <div className="model-list">
                {modelPicker.showAuto ? (
                  <button
                    type="button"
                    role="menuitem"
                    className={`mode-item model-row${props.model === "auto" ? " active" : ""}`}
                    onMouseEnter={(e) => {
                      setHoverModel("auto");
                      const menu = (e.currentTarget as HTMLElement).closest(".model-menu");
                      if (menu) {
                        setTipY(e.currentTarget.getBoundingClientRect().top - menu.getBoundingClientRect().top);
                      }
                    }}
                    onClick={() => {
                      props.onModel("auto");
                      setModelOpen(false);
                    }}
                  >
                    <span>Auto</span>
                    {props.model === "auto" ? <Check size={14} className="mode-check" /> : <span />}
                  </button>
                ) : null}
                {modelPicker.rows.map((m) => {
                  const parts = modelParts(m);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="menuitem"
                      className={`mode-item model-row${props.model === m.id ? " active" : ""}`}
                      onMouseEnter={(e) => {
                        setHoverModel(m.id);
                        const menu = (e.currentTarget as HTMLElement).closest(".model-menu");
                        if (menu) {
                          setTipY(e.currentTarget.getBoundingClientRect().top - menu.getBoundingClientRect().top);
                        }
                      }}
                      onClick={() => {
                        props.onModel(m.id);
                        setModelOpen(false);
                      }}
                    >
                      <span>
                        {parts.name}
                        {parts.speed ? <span className="model-speed"> {parts.speed}</span> : null}
                      </span>
                      {props.model === m.id ? <Check size={14} className="mode-check" /> : <span />}
                    </button>
                  );
                })}
                {!modelPicker.showAuto && modelPicker.rows.length === 0 ? (
                  <p className="model-empty">Không có model khớp.</p>
                ) : null}
              </div>
              {props.onAddModels ? (
                <>
                  <div className="model-sep" />
                  <button
                    type="button"
                    className="mode-item model-row model-add-row"
                    onClick={() => {
                      props.onAddModels?.();
                      setModelOpen(false);
                    }}
                  >
                    <Plus size={14} />
                    <span>Add models</span>
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
        <span className="composer-spacer" />
        <div className="composer-tools">
          <button
            type="button"
            className={`composer-tool composer-tip${showUsage ? " on" : ""}`}
            data-tip={`Show context usage · ${fmtTok(tokens)} / 256K`}
            aria-label="Show context usage"
            aria-pressed={showUsage}
            onClick={() => {
              setShowUsage((v) => !v);
              setFilesOpen(false);
            }}
          >
            <UsageRing pct={ctxPct} />
          </button>
          <div className="mode-dd" ref={files.length ? undefined : filesRef}>
            <button type="button" className="composer-tool" title="Tệp" onClick={toggleFiles}>
              <Paperclip size={15} />
            </button>
            {files.length === 0 ? filesMenu : null}
          </div>
          {hasText ? null : (
            <button type="button" className="composer-tool" title="Voice (chưa gắn)" disabled>
              <Mic size={15} />
            </button>
          )}
          {hasText ? (
            <button className="send" disabled={!canSend} type="submit" title="Enter">
              <ArrowUp size={16} />
            </button>
          ) : (
            <button type="button" className="composer-tool send-idle" title="Voice (chưa gắn)" disabled>
              <AudioLines size={16} />
            </button>
          )}
        </div>
      </div>
    </form>
    </div>
  );
}
