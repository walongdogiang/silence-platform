import {
  ArrowUp,
  AudioLines,
  Bug,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  GitCompare,
  ImagePlus,
  Infinity as InfinityIcon,
  List,
  MessageCircle,
  Mic,
  Minus,
  Paperclip,
  Plus,
  Search,
  Square,
  TriangleAlert,
  Users,
  X,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { modelName, modelTitle, pickerRows } from "../theme/modelsPrefs";
import { MODE_LABEL, looksLikeEditRequest, type SessionMode } from "../modes";
import type { ContextUsage, ModelInfo } from "../types";
import { contextLevel, contextPct, contextTip, fmtTok, usageRows as contextRows } from "../contextUsage";
import { IMAGE_TYPES, dragHasImage, imageFilesFrom, imagesFromFiles } from "../pastedImages";
import { ImageLightbox, type LightboxState } from "./ImageLightbox";
import { shortEmail } from "../cliInfo";
import {
  EFFORT_LABEL,
  effortOptions,
  placeSubmenu,
  recommendedEffort,
  sourceOf,
  type Effort,
  type ModelSource,
} from "../effort";

export type { SessionMode };

const MODES = [
  { id: "Plan", title: "Plan", mode: "plan", desc: "Chỉ đọc, lập kế hoạch để bạn duyệt rồi mới sửa", Icon: List },
  { id: "Agent", title: "Agent", mode: "agent", desc: "Đọc, sửa file, chạy lệnh (hỏi quyền, có diff)", Icon: InfinityIcon },
  { id: "Debug", title: "Debug", mode: "debug", desc: "Tái hiện, tìm nguyên nhân, sửa nhỏ nhất, chạy lại; gửi kèm log Output", Icon: Bug },
  { id: "MultiTask", title: "MultiTask", mode: "multitask", desc: "Tách việc độc lập, giao cho sub-agent, tổng hợp kết quả", Icon: Users },
  { id: "Review", title: "Review", mode: "review", desc: "Chỉ đọc, review thay đổi chưa commit, báo lỗi theo mức độ", Icon: GitCompare },
  { id: "Ask", title: "Ask", mode: "ask", desc: "Chỉ đọc, hỏi đáp về code, không sửa", Icon: MessageCircle },
] as const;

/** "Claude Opus 5.5" → "Opus 5.5" for the compact trigger; other names unchanged. */
export function shortModelName(name: string) {
  return name.replace(/^Claude\s+/i, "");
}

const modeLabel = (mode: SessionMode) => MODES.find((m) => m.mode === mode)?.id ?? "Agent";

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
  return { body: bits.join(" · "), kicker: m.provider_label || "Model", name: modelTitle(m) };
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
  /** Ảnh dán (data URL). Không truyền `onImages` thì không nhận dán ảnh. */
  images?: string[];
  onImages?: (next: string[]) => void;
  onSend: () => void;
  /** Gửi tin hiện tại bằng mode khác (gợi ý khi đang ở mode chỉ đọc mà gõ yêu cầu sửa). */
  onSendAs?: (mode: SessionMode) => void;
  onChip: (chip: string) => void;
  mode: SessionMode;
  model: string;
  models: ModelInfo[];
  onModel: (id: string) => void;
  /** Mức suy nghĩ (`session.set_effort`). Không truyền `onEffort` thì ẩn mục Effort. */
  effort?: Effort;
  onEffort?: (e: Effort) => void;
  /** Model source shown in the list (provider id). Không truyền `onSource` thì ẩn mục Source. */
  source?: string;
  sources?: ModelSource[];
  onSource?: (id: string) => void;
  /** Account per source kind (e.g. `{ claude_cli: "a@b.c" }`), shown short in the Source menu. */
  sourceAccounts?: Record<string, string>;
  /** Open Settings → Model sources (to add a key for an unavailable source). */
  onSetupSources?: () => void;
  busy: boolean;
  /** Dừng lượt đang chạy (`session.abort`); nút Stop thay nút gửi khi `busy`. */
  onStop?: () => void;
  disabled: boolean;
  files?: string[];
  /** `session.context` của session hiện tại; null khi chưa có session. */
  context?: ContextUsage | null;
  onOpenFile?: (path: string) => void;
  onAddModels?: () => void;
  /** `opt_in` models still off: shown greyed with an Enable button instead of being pickable. */
  lockedIds?: string[];
  /** Enable button on a locked row: open Settings → Models at that model. */
  onEnableModel?: (id: string) => void;
}) {
  const [modeOpen, setModeOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelQ, setModelQ] = useState("");
  /** Open submenu of the model menu (Source or Effort); one at a time. */
  const [sub, setSub] = useState<null | "effort" | "source">(null);
  const [subPos, setSubPos] = useState<ReturnType<typeof placeSubmenu> | null>(null);
  const effortRowRef = useRef<HTMLButtonElement>(null);
  const sourceRowRef = useRef<HTMLButtonElement>(null);
  const subMenuRef = useRef<HTMLDivElement>(null);

  // Submenus: `position: fixed` (escapes the chat pane's overflow clip), placed on the side of
  // the model menu that has room, re-placed on resize.
  useLayoutEffect(() => {
    if (!sub) {
      setSubPos(null);
      return;
    }
    const place = () => {
      const row = (sub === "effort" ? effortRowRef : sourceRowRef).current;
      const panel = subMenuRef.current;
      const menu = row?.closest(".model-menu");
      if (!row || !panel || !menu) return;
      setSubPos(
        placeSubmenu(
          menu.getBoundingClientRect(),
          row.getBoundingClientRect(),
          { w: panel.offsetWidth, h: panel.offsetHeight },
          { w: window.innerWidth, h: window.innerHeight },
        ),
      );
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [sub]);
  const [hoverModel, setHoverModel] = useState<string | null>(null);
  const [tipY, setTipY] = useState(0);
  const [filesOpen, setFilesOpen] = useState(false);
  const [showUsage, setShowUsage] = useState(false);
  const [picked, setPicked] = useState<string>(modeLabel(props.mode));
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxState>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  // Ảnh mới nhất: các lần thêm ảnh bất đồng bộ chồng nhau vẫn cộng dồn đúng.
  const imagesRef = useRef<string[]>(props.images ?? []);
  imagesRef.current = props.images ?? [];
  const modeRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const modelSearchRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLDivElement>(null);
  const current = MODES.find((m) => m.id === picked) ?? MODES[1];
  const selected = props.model === "auto" ? null : props.models.find((x) => x.id === props.model);
  const selectedName = selected ? modelName(selected) : null;
  const sources = props.sources ?? [];
  const activeSource = sources.find((s) => s.id === props.source) ?? null;
  const modelPicker = useMemo(() => {
    const needle = modelQ.trim().toLowerCase();
    const hit = (text: string) => !needle || text.toLowerCase().includes(needle);
    // Only the active source's models; no source picker → every model (old behaviour).
    const inSource = props.source
      ? props.models.filter((m) => sourceOf(m, sources) === props.source)
      : props.models;
    const { rows: usable, dupes } = pickerRows(inSource, props.model);
    const rows = usable.filter((m) => hit(`${modelTitle(m)} ${m.id}`));
    // Auto never routes to the Claude CLI: no Auto row there.
    const autoOk = activeSource?.kind !== "claude_cli";
    return { showAuto: autoOk && hit("auto"), rows, dupes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelQ, props.models, props.model, props.source, props.sources]);
  const hoverTip = hoverModel && !sub ? modelTip(hoverModel, props.models) : null;
  const effort = props.effort ?? "auto";
  const effortLevels = effortOptions(props.model, props.models);
  const effortRec = recommendedEffort(props.model, props.models);
  // `auto` sends nothing, so the model runs at its default: show (and check) that level.
  const effortShown: Effort | null = effort === "auto" ? effortRec : effort;
  const showEffort = Boolean(props.onEffort) && effortLevels.length > 0;
  const showSource = Boolean(props.onSource) && sources.length > 1;

  useEffect(() => {
    setPicked(modeLabel(props.mode));
  }, [props.mode]);

  useEffect(() => {
    if (!modelOpen) {
      setModelQ("");
      setHoverModel(null);
      setSub(null);
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

  const images = props.images ?? [];
  const hasText = Boolean(props.prompt.trim());
  const hasInput = hasText || images.length > 0;
  // Chỉ model trong catalog khai báo `vision`; Auto tự chọn model đọc được ảnh.
  const noVision = images.length > 0 && Boolean(selected) && !selected?.vision;
  const canSend = !props.busy && !props.disabled && hasInput && !noVision;

  /** Thêm ảnh từ dán / kéo-thả / chọn file: thu nhỏ, kiểm giới hạn, cộng vào danh sách. */
  function addFiles(files: File[]) {
    if (!props.onImages || files.length === 0) return;
    void imagesFromFiles(files, imagesRef.current.length).then((r) => {
      setPasteError(r.error ?? null);
      if (r.images.length) props.onImages?.([...imagesRef.current, ...r.images]);
    });
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (!props.onImages) return;
    const files = imageFilesFrom(e.clipboardData);
    if (files.length === 0) return;
    // Có ảnh: không để trình duyệt dán tên file / chữ rác vào ô.
    e.preventDefault();
    addFiles(files);
  }

  function onDragOver(e: DragEvent<HTMLFormElement>) {
    if (!props.onImages || !dragHasImage(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (!dragging) setDragging(true);
  }

  function onDrop(e: DragEvent<HTMLFormElement>) {
    setDragging(false);
    if (!props.onImages) return;
    const files = imageFilesFrom(e.dataTransfer);
    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  }

  useEffect(() => {
    if (images.length === 0) setPasteError(null);
  }, [images.length]);
  const files = props.files ?? [];
  const listed = files.slice(0, 12);
  const ctx = props.context ?? null;
  const ctxPct = contextPct(ctx);
  const ctxLevel = contextLevel(ctxPct);
  const ctxWindow = ctx?.window ?? 0;
  const usageRows = contextRows(ctx);

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
      {props.onImages ? (
        <button
          type="button"
          role="menuitem"
          className="mode-item files-item"
          onClick={() => {
            setFilesOpen(false);
            pickRef.current?.click();
          }}
        >
          <ImagePlus size={14} />
          <span>Thêm ảnh…</span>
        </button>
      ) : null}
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
              {ctx ? `${ctx.measured ? "" : "~"}${fmtTok(ctx.used)} / ${fmtTok(ctxWindow)} Tokens` : "Chưa có session"}
            </span>
          </div>
          <i className="ctx-report-bar">
            {ctxWindow > 0
              ? usageRows
                  .filter((r) => r.n > 0)
                  .map((r) => (
                    <b key={r.label} style={{ width: `${(r.n / ctxWindow) * 100}%`, background: r.color }} />
                  ))
              : null}
          </i>
          <p className="ctx-report-note">
            {ctx?.measured ? "Số đo từ lượt gần nhất" : "Ước lượng"} · tự tóm tắt khi đạt 70%
          </p>
          <ul className="ctx-report-list">
            {usageRows.filter((r) => r.n > 0).map((r) => (
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
      className={`composer${dragging ? " dragging" : ""}`}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
      onSubmit={(e) => {
        e.preventDefault();
        if (!noVision) props.onSend();
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
      {props.onSendAs && (props.mode === "ask" || props.mode === "review") && !props.busy && !props.disabled && looksLikeEditRequest(props.prompt) ? (
        <div className="composer-hint" role="status">
          <span>
            Đang ở {MODE_LABEL[props.mode]} (chỉ đọc) nên sẽ không sửa file.
          </span>
          <button type="button" onClick={() => props.onSendAs?.("agent")}>
            Gửi bằng Agent
          </button>
        </div>
      ) : null}
      {images.length > 0 ? (
        <div className="composer-images">
          {images.map((src, i) => (
            <div key={`${i}-${src.length}`} className="composer-image">
              <button
                type="button"
                className="img-zoom"
                title="Phóng to"
                onClick={() => setLightbox({ images, index: i })}
              >
                <img src={src} alt={`Ảnh dán ${i + 1}`} />
              </button>
              <button
                type="button"
                className="composer-image-remove"
                title="Bỏ ảnh"
                aria-label={`Bỏ ảnh ${i + 1}`}
                onClick={() => props.onImages?.(images.filter((_, j) => j !== i))}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {noVision && selectedName ? (
        <div className="composer-hint" role="status">
          <span>{selectedName} không đọc được ảnh.</span>
          <button type="button" onClick={() => props.onModel("auto")}>
            Dùng Auto
          </button>
        </div>
      ) : pasteError ? (
        <div className="composer-hint" role="status">
          <span>{pasteError}</span>
        </div>
      ) : null}
      <input
        ref={pickRef}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        multiple
        hidden
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          // Cho chọn lại đúng file đó lần sau.
          e.target.value = "";
        }}
      />
      <textarea
        value={props.prompt}
        onChange={(e) => props.onPrompt(e.target.value)}
        onPaste={onPaste}
        placeholder="Plan, Build, / for skills, @ for context"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!noVision) props.onSend();
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
            {/* Short name (the vendor prefix is implied by the source) + the effort in use. */}
            <span className="model-trigger-name">
              {props.model === "auto" ? "Auto" : shortModelName(selectedName ?? props.model)}
            </span>
            {showEffort && effortShown ? (
              <span className="model-trigger-effort">{EFFORT_LABEL[effortShown]}</span>
            ) : null}
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
                  const off = m.available === false;
                  if (props.lockedIds?.includes(m.id) && !off) {
                    return (
                      <div
                        key={m.id}
                        role="menuitem"
                        aria-disabled="true"
                        className="mode-item model-row model-locked"
                        title="Uses many more tokens — enable it in Settings → Models"
                        onMouseEnter={() => setHoverModel(null)}
                      >
                        <span>{shortModelName(modelName(m))}</span>
                        <button
                          type="button"
                          className="model-enable"
                          onClick={() => {
                            props.onEnableModel?.(m.id);
                            setModelOpen(false);
                          }}
                        >
                          Enable
                        </button>
                      </div>
                    );
                  }
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="menuitem"
                      disabled={off}
                      title={off ? m.unavailable_reason : undefined}
                      className={`mode-item model-row${props.model === m.id ? " active" : ""}${off ? " off" : ""}`}
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
                        {shortModelName(modelName(m))}
                        {modelPicker.dupes.has(m.id) && m.provider_label ? (
                          <span className="model-speed"> · {m.provider_label}</span>
                        ) : null}
                      </span>
                      {props.model === m.id ? <Check size={14} className="mode-check" /> : <span />}
                    </button>
                  );
                })}
                {!modelPicker.showAuto && modelPicker.rows.length === 0 ? (
                  <p className="model-empty">Không có model khớp.</p>
                ) : null}
              </div>
              {showSource || showEffort ? <div className="model-sep" /> : null}
              {showSource ? (
                <button
                  type="button"
                  className={`mode-item model-row effort-row${sub === "source" ? " open" : ""}`}
                  aria-haspopup="menu"
                  aria-expanded={sub === "source"}
                  ref={sourceRowRef}
                  onMouseEnter={() => setHoverModel(null)}
                  onClick={() => setSub((s) => (s === "source" ? null : "source"))}
                >
                  <span>Source</span>
                  <span className="effort-value">{activeSource?.label ?? "—"}</span>
                  {sub === "source" && subPos?.side === "left" ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
                </button>
              ) : null}
              {showEffort ? (
                <button
                  type="button"
                  className={`mode-item model-row effort-row${sub === "effort" ? " open" : ""}`}
                  aria-haspopup="menu"
                  aria-expanded={sub === "effort"}
                  ref={effortRowRef}
                  onMouseEnter={() => setHoverModel(null)}
                  onClick={() => setSub((s) => (s === "effort" ? null : "effort"))}
                >
                  <span>Effort</span>
                  <span className="effort-value">{EFFORT_LABEL[effortShown ?? "auto"]}</span>
                  {sub === "effort" && subPos?.side === "left" ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
                </button>
              ) : null}
              {sub ? (
                <div
                  ref={subMenuRef}
                  className={`effort-menu${subPos ? ` side-${subPos.side}` : ""}`}
                  role="menu"
                  aria-label={sub === "effort" ? "Effort" : "Source"}
                  style={subPos ? { left: subPos.left, top: subPos.top } : { visibility: "hidden", left: 0, top: 0 }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      const row = sub === "effort" ? effortRowRef : sourceRowRef;
                      setSub(null);
                      row.current?.focus();
                    }
                  }}
                >
                  {sub === "source" ? (
                    <>
                      <p className="effort-hint">Choose where models come from. Only this source's models are listed.</p>
                      {sources.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          role="menuitemradio"
                          aria-checked={props.source === s.id}
                          className={`effort-item${props.source === s.id ? " active" : ""}${s.available ? "" : " off"}`}
                          title={s.available ? undefined : s.reason}
                          onClick={() => {
                            if (!s.available) {
                              // No key / CLI missing: send the user where to fix it.
                              props.onSetupSources?.();
                              setModelOpen(false);
                              return;
                            }
                            props.onSource?.(s.id);
                            setSub(null);
                          }}
                        >
                          <span className="effort-label" title={props.sourceAccounts?.[s.kind]}>
                            {s.label}
                            {s.available && props.sourceAccounts?.[s.kind] ? (
                              <span className="source-account">
                                {props.sourceAccounts[s.kind].includes("@")
                                  ? shortEmail(props.sourceAccounts[s.kind])
                                  : props.sourceAccounts[s.kind]}
                              </span>
                            ) : null}
                            {!s.available ? <span className="source-setup">Set up</span> : null}
                          </span>
                          {props.source === s.id ? <Check size={16} className="effort-check" /> : <span />}
                        </button>
                      ))}
                    </>
                  ) : (
                    <>
                      <p className="effort-hint">
                        Higher effort means more thorough responses, but takes longer and uses more tokens.
                      </p>
                      {effortLevels.map((e) => (
                        <button
                          key={e}
                          type="button"
                          role="menuitemradio"
                          aria-checked={effortShown === e}
                          className={`effort-item${effortShown === e ? " active" : ""}`}
                          onClick={() => {
                            props.onEffort?.(e);
                            setSub(null);
                            setModelOpen(false);
                          }}
                        >
                          <span className="effort-label">
                            {EFFORT_LABEL[e]}
                            {e === effortRec ? <span className="effort-badge">Recommended</span> : null}
                            {e === "max" ? (
                              <span className="effort-warn">
                                <TriangleAlert size={11} aria-hidden="true" />
                                Highest usage
                              </span>
                            ) : null}
                          </span>
                          {effortShown === e ? <Check size={16} className="effort-check" /> : <span />}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              ) : null}
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
            className={`composer-tool composer-tip ctx-${ctxLevel}${showUsage ? " on" : ""}`}
            data-tip={contextTip(ctx)}
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
          {props.busy && props.onStop ? null : hasInput ? null : (
            <button type="button" className="composer-tool" title="Voice (chưa gắn)" disabled>
              <Mic size={15} />
            </button>
          )}
          {props.busy && props.onStop ? (
            <button
              type="button"
              className="send send-stop"
              title="Dừng"
              aria-label="Dừng"
              onClick={props.onStop}
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : hasInput ? (
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
    {lightbox ? (
      <ImageLightbox images={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)} />
    ) : null}
    </div>
  );
}
