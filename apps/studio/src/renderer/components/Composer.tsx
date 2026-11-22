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
  Mic,
  Minus,
  Paperclip,
  Plus,
  Search,
  Sparkles,
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
  type ReactNode,
} from "react";
import { modelName, modelTitle, pickerRows } from "../theme/modelsPrefs";
import { MODE_LABEL, looksLikeEditRequest, type SessionMode } from "../modes";
import type { ContextUsage, ModelInfo } from "../types";
import { contextLevel, contextPct, contextTip, fmtTok, usageRows as contextRows } from "../contextUsage";
import { IMAGE_TYPES, dragHasImage, imageFilesFrom, imagesFromFiles } from "../pastedImages";
import { ImageLightbox, type LightboxState } from "./ImageLightbox";
import { AutoQuickMenu, autoTip } from "./AutoSettings";
import { AUTO_SLOTS, autoSummaryShort, fmtUsd, type AutoConfig, type SlotSpend } from "../autoConfig";
import { useT, type T } from "../i18n";
import { shortEmail } from "../cliInfo";
import {
  effortOptions,
  placeSubmenu,
  recommendedEffort,
  sourceOf,
  type Effort,
  type ModelSource,
} from "../effort";

export type { SessionMode };

const MODES = [
  { id: "Plan", title: "Plan", mode: "plan", desc: "mode.planDesc", Icon: List },
  { id: "Agent", title: "Agent", mode: "agent", desc: "mode.agentDesc", Icon: InfinityIcon },
  { id: "Debug", title: "Debug", mode: "debug", desc: "mode.debugDesc", Icon: Bug },
  { id: "MultiTask", title: "MultiTask", mode: "multitask", desc: "mode.multitaskDesc", Icon: Users },
  { id: "Review", title: "Review", mode: "review", desc: "mode.reviewDesc", Icon: GitCompare },
] as const;

/** "Claude Opus 5.5" → "Opus 5.5" for the compact trigger; other names unchanged. */
export function shortModelName(name: string) {
  return name.replace(/^Claude\s+/i, "");
}

const modeLabel = (mode: SessionMode) => MODES.find((m) => m.mode === mode)?.id ?? "Agent";

function modelTip(id: string, models: ModelInfo[], autoLine: string, t: T) {
  if (id === "auto") {
    return { body: autoTip(autoLine, t), kicker: "Model", name: "Auto" };
  }
  const m = models.find((x) => x.id === id);
  if (!m) return null;
  const bits = [t("model.tipContext", { n: fmtTok(m.context_window) })];
  if (m.tools) bits.push(t("model.tipTools"));
  if (m.vision) bits.push(t("model.tipVision"));
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
  /** Permission mode picker shown right after the mode menu (Ask is a permission mode now). */
  permMenu?: ReactNode;
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
  /** Auto settings of the active source. Không truyền `onAutoConfig` thì ẩn mục Tuỳ chỉnh Auto. */
  autoConfig?: AutoConfig;
  onAutoConfig?: (next: AutoConfig) => void;
  /** Short name of the model Auto used last in this session ("Sonnet"), shown as "Auto · Sonnet". */
  autoModel?: string;
  /** Spend of the current session split by Auto slot (shown in the context report). */
  spend?: SlotSpend;
  /** "More settings…" in the Auto submenu: open Settings → Models → Auto. */
  onAutoMore?: () => void;
}) {
  const t = useT();
  const [modeOpen, setModeOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelQ, setModelQ] = useState("");
  /** Open submenu of the model menu (Source or Effort); one at a time. */
  const [sub, setSub] = useState<null | "effort" | "source" | "auto">(null);
  const [subPos, setSubPos] = useState<ReturnType<typeof placeSubmenu> | null>(null);
  const effortRowRef = useRef<HTMLButtonElement>(null);
  const sourceRowRef = useRef<HTMLButtonElement>(null);
  const autoRowRef = useRef<HTMLButtonElement>(null);
  const subMenuRef = useRef<HTMLDivElement>(null);

  // Submenus: `position: fixed` (escapes the chat pane's overflow clip), placed on the side of
  // the model menu that has room, re-placed on resize.
  useLayoutEffect(() => {
    if (!sub) {
      setSubPos(null);
      return;
    }
    const place = () => {
      const row = (sub === "effort" ? effortRowRef : sub === "auto" ? autoRowRef : sourceRowRef).current;
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
    // Auto is always the first row, on every source (the Claude CLI included).
    return { showAuto: hit("auto"), rows, dupes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelQ, props.models, props.model, props.source, props.sources]);
  const effort = props.effort ?? "auto";
  const effortLevels = effortOptions(props.model, props.models);
  const effortRec = recommendedEffort(props.model, props.models);
  // `auto` sends nothing, so the model runs at its default: show (and check) that level.
  const effortShown: Effort | null = effort === "auto" ? effortRec : effort;
  const showEffort = Boolean(props.onEffort) && effortLevels.length > 0;
  const showSource = Boolean(props.onSource) && sources.length > 1;
  const showAutoCfg = Boolean(props.onAutoConfig) && Boolean(props.source);
  const autoCfg = props.autoConfig ?? { preset: "balanced" as const };
  const unlocked = props.models.filter((m) => !props.lockedIds?.includes(m.id));
  const autoLine = props.source ? autoSummaryShort(autoCfg, props.source, unlocked) : "";
  const presetLabel = t(`preset.${autoCfg.preset}`);
  const hoverTip = hoverModel && !sub ? modelTip(hoverModel, props.models, autoLine, t) : null;

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
    void imagesFromFiles(files, imagesRef.current.length, t).then((r) => {
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
  const usageRows = contextRows(ctx, t);

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
        <p className="files-empty">{t("files.more", { n: files.length - listed.length })}</p>
      ) : null}
      {listed.length === 0 ? <p className="files-empty">{t("files.none")}</p> : null}
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
          <span>{t("files.addImage")}</span>
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
        {t("ctx.show")}
      </button>
    </div>
  ) : null;

  return (
    <div className="composer-stack">
      {showUsage ? (
        <div className="ctx-report">
          <div className="ctx-report-head">
            <b>{t("ctx.title")}</b>
            <span>{t("ctx.viewReport")}</span>
            <button type="button" className="ctx-report-close" title={t("common.close")} onClick={() => setShowUsage(false)}>
              <Minus size={14} />
            </button>
          </div>
          <div className="ctx-report-meta">
            <span>{t("ctx.full", { pct: ctxPct })}</span>
            <span>
              {ctx
                ? t("ctx.tokens", { used: `${ctx.measured ? "" : "~"}${fmtTok(ctx.used)}`, window: fmtTok(ctxWindow) })
                : t("ctx.noSession")}
            </span>
          </div>
          <i className="ctx-report-bar">
            {ctxWindow > 0
              ? usageRows
                  .filter((r) => r.n > 0)
                  .map((r) => (
                    <b key={r.id} style={{ width: `${(r.n / ctxWindow) * 100}%`, background: r.color }} />
                  ))
              : null}
          </i>
          <p className="ctx-report-note">
            {ctx?.measured ? t("ctx.measured") : t("ctx.estimate")}
            {t("ctx.compactNote")}
          </p>
          <ul className="ctx-report-list">
            {usageRows.filter((r) => r.n > 0).map((r) => (
              <li key={r.id}>
                <i style={{ background: r.color }} />
                <span>{r.label}</span>
                <em>{fmtTok(r.n)}</em>
              </li>
            ))}
          </ul>
          {props.spend && props.spend.usd > 0 ? (
            <div className="ctx-spend">
              <p className="ctx-report-note">
                {t("spend.chat", { usd: fmtUsd(props.spend.usd) })}
                {props.spend.baseline > props.spend.usd * 1.01
                  ? t("spend.saved", { usd: fmtUsd(props.spend.baseline - props.spend.usd) })
                  : ""}
              </p>
              <ul className="ctx-report-list">
                {AUTO_SLOTS.filter((sl) => props.spend!.bySlot[sl] > 0).map((sl) => (
                  <li key={sl}>
                    <i className={`slot-dot slot-${sl}`} />
                    <span>{t(`slot.${sl}`)}</span>
                    <em>{fmtUsd(props.spend!.bySlot[sl])}</em>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
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
              <span>{t(files.length === 1 ? "files.count1" : "files.count", { n: files.length })}</span>
            </button>
            {files.length > 0 ? filesMenu : null}
          </div>
          <button
            type="button"
            className="composer-review"
            title={t("composer.reviewTip")}
            onClick={() => props.onChip("ReviewChanges")}
          >
            Review
          </button>
        </div>
      ) : null}
      {props.onSendAs && (props.mode === "ask" || props.mode === "review") && !props.busy && !props.disabled && looksLikeEditRequest(props.prompt) ? (
        <div className="composer-hint" role="status">
          <span>{t("composer.readOnlyHint", { mode: MODE_LABEL[props.mode] })}</span>
          <button type="button" onClick={() => props.onSendAs?.("agent")}>
            {t("composer.sendAsAgent")}
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
                title={t("img.zoom")}
                onClick={() => setLightbox({ images, index: i })}
              >
                <img src={src} alt={t("composer.pastedAlt", { n: i + 1 })} />
              </button>
              <button
                type="button"
                className="composer-image-remove"
                title={t("composer.removeImage")}
                aria-label={t("composer.removeImageN", { n: i + 1 })}
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
          <span>{t("composer.noVision", { model: selectedName })}</span>
          <button type="button" onClick={() => props.onModel("auto")}>
            {t("composer.useAuto")}
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
        placeholder={t("composer.placeholder")}
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
                  title={t(m.desc)}
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
        {props.permMenu}
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
              {props.model === "auto"
                ? props.autoModel
                  ? `Auto · ${props.autoModel}`
                  : "Auto"
                : shortModelName(selectedName ?? props.model)}
            </span>
            {showEffort && effortShown ? (
              <span className="model-trigger-effort">{t(`effort.${effortShown}`)}</span>
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
                  placeholder={t("model.search")}
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
                    className={`mode-item model-row model-auto${props.model === "auto" ? " active" : ""}`}
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
                    <span className="model-auto-label">
                      <span className="model-auto-name">
                        <Sparkles size={13} className="model-auto-icon" aria-hidden="true" />
                        Auto
                      </span>
                    </span>
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
                        title={t("model.lockedTip")}
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
                          {t("model.enable")}
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
                  <p className="model-empty">{t("model.none")}</p>
                ) : null}
              </div>
              {showSource || showEffort || showAutoCfg ? <div className="model-sep" /> : null}
              {showAutoCfg ? (
                <button
                  type="button"
                  className={`mode-item model-row effort-row${sub === "auto" ? " open" : ""}`}
                  aria-haspopup="menu"
                  aria-expanded={sub === "auto"}
                  ref={autoRowRef}
                  onMouseEnter={() => setHoverModel(null)}
                  onClick={() => setSub((s) => (s === "auto" ? null : "auto"))}
                >
                  <span>{t("model.autoSettings")}</span>
                  <span className="effort-value">{presetLabel}</span>
                  {sub === "auto" && subPos?.side === "left" ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
                </button>
              ) : null}
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
                  <span>{t("model.source")}</span>
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
                  <span>{t("model.effort")}</span>
                  <span className="effort-value">{t(`effort.${effortShown ?? "auto"}`)}</span>
                  {sub === "effort" && subPos?.side === "left" ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
                </button>
              ) : null}
              {sub ? (
                <div
                  ref={subMenuRef}
                  className={`effort-menu${sub === "auto" ? " auto-menu" : ""}${subPos ? ` side-${subPos.side}` : ""}`}
                  role="menu"
                  aria-label={t(sub === "effort" ? "model.effort" : sub === "auto" ? "model.autoSettings" : "model.source")}
                  style={subPos ? { left: subPos.left, top: subPos.top } : { visibility: "hidden", left: 0, top: 0 }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      const row = sub === "effort" ? effortRowRef : sub === "auto" ? autoRowRef : sourceRowRef;
                      setSub(null);
                      row.current?.focus();
                    }
                  }}
                >
                  {sub === "auto" ? (
                    <AutoQuickMenu
                      config={autoCfg}
                      onChange={(next) => props.onAutoConfig?.(next)}
                      source={props.source ?? ""}
                      models={unlocked}
                      spentUsd={props.spend?.usd}
                      onMore={
                        props.onAutoMore
                          ? () => {
                              props.onAutoMore?.();
                              setModelOpen(false);
                            }
                          : undefined
                      }
                    />
                  ) : sub === "source" ? (
                    <>
                      <p className="effort-hint">{t("model.sourceHint")}</p>
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
                            {!s.available ? <span className="source-setup">{t("model.setUp")}</span> : null}
                          </span>
                          {props.source === s.id ? <Check size={16} className="effort-check" /> : <span />}
                        </button>
                      ))}
                    </>
                  ) : (
                    <>
                      <p className="effort-hint">
                        {t("model.effortHint")}
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
                            {t(`effort.${e}`)}
                            {e === effortRec ? <span className="effort-badge">{t("model.recommended")}</span> : null}
                            {e === "max" ? (
                              <span className="effort-warn">
                                <TriangleAlert size={11} aria-hidden="true" />
                                {t("model.highestUsage")}
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
                    <span>{t("model.add")}</span>
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
            className={`composer-tool ctx-${ctxLevel}${showUsage ? " on" : ""}`}
            data-tip={contextTip(ctx, t)}
            aria-label={t("ctx.show")}
            aria-pressed={showUsage}
            onClick={() => {
              setShowUsage((v) => !v);
              setFilesOpen(false);
            }}
          >
            <UsageRing pct={ctxPct} />
          </button>
          <div className="mode-dd" ref={files.length ? undefined : filesRef}>
            <button type="button" className="composer-tool" title={t("composer.files")} onClick={toggleFiles}>
              <Paperclip size={15} />
            </button>
            {files.length === 0 ? filesMenu : null}
          </div>
          {props.busy && props.onStop ? null : hasInput ? null : (
            <button type="button" className="composer-tool" title={t("composer.voice")} disabled>
              <Mic size={15} />
            </button>
          )}
          {props.busy && props.onStop ? (
            <button
              type="button"
              className="send send-stop"
              title={t("composer.stop")}
              aria-label={t("composer.stop")}
              onClick={props.onStop}
            >
              <Square size={13} fill="currentColor" />
            </button>
          ) : hasInput ? (
            <button className="send" disabled={!canSend} type="submit" title="Enter">
              <ArrowUp size={16} />
            </button>
          ) : (
            <button type="button" className="composer-tool send-idle" title={t("composer.voice")} disabled>
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
