import {
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Code2,
  Copy,
  FolderOpen,
  GitCompare,
  Info,
  ListChecks,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  countExplored,
  isPlanningVerb,
  mergeReadSteps,
  narrateFromLine,
  narrateToPast,
  parseNarrateLegacy,
  stepText,
  verbText,
  detailText,
  type NarrateStep,
} from "../chatMeta";
import type { ChatLine, Diff, Perm } from "../models";
import { escalationText, useT, type MsgKey, type T } from "../i18n";
import { MODE_LABEL, type SessionMode } from "../modes";
import { formatDuration, pulseLabel, pulseTip, runPhase, type RunMeter } from "../runStatus";
import { scopeLabels, tierBadge, type PermScope } from "../permissionUi";
import { DiffCard } from "./DiffCard";
import { ErrorCard } from "./ErrorCard";
import { MarkdownMessage } from "./MarkdownMessage";
import { ImageLightbox, type LightboxState } from "./ImageLightbox";
import { ImageEditor } from "./ImageEditor";
import { ImageFrame } from "./ImageFrame";
import type { EditTarget } from "../imageActions";
import { ImageRefStrip } from "./WorkspaceImage";
import { SoftScroll } from "./SoftScroll";
import { transcriptOpen, type TranscriptView } from "../prefs";

const MODES = [
  { id: "Plan", title: "Plan", desc: "hub.planDesc", Icon: ListChecks },
  { id: "Code", title: "Code", desc: "hub.codeDesc", Icon: Code2 },
  { id: "Review", title: "Review", desc: "hub.reviewDesc", Icon: GitCompare },
] as const;

const PROMPTS: MsgKey[] = ["hub.prompt1", "hub.prompt2", "hub.prompt3"];

type Turn = {
  user: string;
  /** Ảnh dán kèm (data URL, chỉ trong phiên) hoặc số ảnh khi mở lại từ lịch sử. */
  userImages?: string[];
  userImageCount?: number;
  worked?: { ms: number; at: number };
  thought?: { ms?: number; brief: string; body?: string };
  narrations: NarrateStep[];
  checkpoint?: { id: string; at: number; label: string; files: { path: string; before: string; after: string }[] };
  traces: ChatLine[];
  ai?: { text: string; at?: number };
  errors: Extract<ChatLine, { kind: "error" }>[];
  suggest?: Extract<ChatLine, { kind: "mode_suggest" }>;
  live?: boolean;
  /** Index dòng cuối (inclusive) trong `lines` thuộc turn này — dùng Fork Chat */
  endLine: number;
};

function lineToStep(l: Extract<ChatLine, { kind: "narrate" }>): NarrateStep {
  if (l.verb) return narrateFromLine(l);
  return parseNarrateLegacy(l.text ?? "");
}

function groupTurns(lines: ChatLine[], busy: boolean): Turn[] {
  const turns: Turn[] = [];
  let cur: Turn | null = null;

  function ensure(lineIdx: number): Turn {
    if (!cur) {
      cur = { user: "", traces: [], narrations: [], errors: [], endLine: lineIdx };
      turns.push(cur);
    }
    cur.endLine = lineIdx;
    return cur;
  }

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.kind === "user") {
      cur = {
        user: l.text,
        userImages: l.images ?? [],
        userImageCount: l.imageCount ?? 0,
        traces: [],
        narrations: [],
        errors: [],
        endLine: i,
      };
      turns.push(cur);
    } else if (l.kind === "worked") {
      const t = ensure(i);
      t.worked = { ms: l.ms, at: l.at };
      if (t.ai && !t.ai.at) t.ai.at = l.at;
    } else if (l.kind === "thought") {
      const t = ensure(i);
      const prev = t.thought?.body ?? "";
      t.thought = {
        ms: l.ms ?? t.thought?.ms,
        brief: l.brief || t.thought?.brief || "",
        body: l.body != null ? l.body : prev || undefined,
      };
    } else if (l.kind === "narrate") {
      ensure(i).narrations.push(lineToStep(l));
    } else if (l.kind === "checkpoint") {
      ensure(i).checkpoint = { id: l.id, at: l.at, label: l.label, files: l.files };
    } else if (l.kind === "token") {
      const t = ensure(i);
      if (t.ai) t.ai.text += l.text;
      else t.ai = { text: l.text, at: t.worked?.at };
    } else if (l.kind === "error") {
      ensure(i).errors.push(l);
    } else if (l.kind === "mode_suggest") {
      ensure(i).suggest = l;
    } else {
      ensure(i).traces.push(l);
    }
  }

  const out = turns.filter((t) => t.user || t.userImages?.length || t.userImageCount || t.ai || t.traces.length || t.worked || t.narrations.length || t.thought || t.errors.length);
  for (const t of out) {
    if (t.ai && !t.ai.at && t.worked?.at) t.ai.at = t.worked.at;
  }
  if (busy && out.length > 0) {
    const last = out[out.length - 1];
    if (!last.worked) last.live = true;
  }
  return out;
}

function formatWorked(ms: number | undefined, t: T): string {
  if (ms == null) return t("meta.worked", { time: "—" });
  return t("meta.worked", { time: formatDuration(Math.max(1000, ms + 500)) });
}

function countText(n: number, one: MsgKey, many: MsgKey, t: T): string {
  return t(n === 1 ? one : many, { n });
}

function activityNarrations(narrations: NarrateStep[]): NarrateStep[] {
  return narrations.filter(
    (s) => !isPlanningVerb(s.verb) && !/^Thinking$/i.test(s.verb) && !/^Thought$/i.test(s.verb),
  );
}

function exploreLabel(traces: ChatLine[], narrations: NarrateStep[], t: T): { label: string; stub: boolean; show: boolean } {
  const activity = activityNarrations(narrations);
  let files = 0;
  let searches = 0;
  for (const l of traces) {
    if (l.kind !== "tool") continue;
    const n = l.name.toLowerCase();
    if (/grep|search|find|rg|glob/.test(n)) searches += 1;
    else if (/read|file|cat|open|list|tree|fs\./.test(n)) files += 1;
    else files += 1;
  }
  if (!files && !searches) {
    const c = countExplored(activity);
    files = c.files;
    searches = c.searches;
  }
  const hasActivity = activity.length > 0 || files > 0 || searches > 0;
  const stub = t("meta.explored", { parts: "—" });
  if (!hasActivity) return { label: stub, stub: true, show: false };
  if (!files && !searches) return { label: stub, stub: true, show: true };
  const parts: string[] = [];
  if (files) parts.push(countText(files, "meta.files1", "meta.files", t));
  if (searches) parts.push(countText(searches, "meta.searches1", "meta.searches", t));
  return { label: t("meta.explored", { parts: parts.join(", ") }), stub: false, show: true };
}

/** Thought label and whether the model is still thinking. */
function thoughtLabel(turn: Turn, t: T): { label: string; live: boolean } {
  const thinkingLive = turn.live && turn.narrations.some((s) => /^Thinking$/i.test(s.verb));
  if (thinkingLive || (turn.live && Boolean(turn.thought?.body) && !turn.worked)) {
    return { label: t("verb.Thinking"), live: true };
  }
  if (turn.thought?.ms != null && turn.thought.ms > 0) {
    const sec = Math.max(1, Math.round(turn.thought.ms / 1000));
    return { label: t("meta.thoughtFor", { n: sec }), live: false };
  }
  if (turn.thought?.body) return { label: t("meta.thoughtBriefly"), live: false };
  return { label: "", live: false };
}

function displaySteps(turn: Turn): { step: NarrateStep; active: boolean }[] {
  /* Live: Planning/Thinking; Done: bỏ placeholder; Thought hiển thị block riêng */
  /* Gộp Read liên tiếp cùng file → `Read App.tsx (1–40, 615–629)` (docs/frontend/status.md). */
  const raw = mergeReadSteps(
    turn.live
      ? turn.narrations.filter((s) => !/^Thought$/i.test(s.verb))
      : turn.narrations.filter((s) => !isPlanningVerb(s.verb) && !/^Thinking$/i.test(s.verb) && !/^Thought$/i.test(s.verb)),
  );
  if (!turn.live) {
    return raw.map((s) => ({ step: narrateToPast(s), active: false }));
  }
  return raw.map((s, i) => {
    const active = i === raw.length - 1;
    if (active || isPlanningVerb(s.verb) || /^Thinking$/i.test(s.verb)) {
      return { step: s, active };
    }
    return { step: narrateToPast(s), active: false };
  });
}

function formatAbsolute(at: number, locale: string): string {
  try {
    return new Date(at).toLocaleString(locale, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return new Date(at).toISOString();
  }
}

function planSteps(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((l) => l.replace(/^\s*[-*\d.]+/, "").trim())
    .filter((l) => l.length > 8)
    .slice(0, 6);
}

/** Đồng hồ 1s chỉ chạy khi lượt đang live; xong lượt thì dừng tick. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

type RouteLine = Extract<ChatLine, { kind: "route" }>;

/** Why Auto escalated, from the Engine's reason ("… · escalated: tests failed after an edit"). */
function escalationWhy(reason: string | undefined, t: T): string {
  const m = /escalated: ([^·]+)/.exec(reason ?? "");
  return m ? escalationText(m[1], t) : "";
}

/** One route line in the turn's details: "Auto → Sonnet 5.5 · Strong · agent" or the legacy text. */
function routeLineText(l: RouteLine, t: T): string {
  if (!l.slot) return l.text;
  const why = l.escalated ? escalationWhy(l.reason, t) : "";
  const slot = ["frontier", "strong", "small"].includes(l.slot) ? t(`slot.${l.slot as "frontier" | "strong" | "small"}`) : l.slot;
  return `${t("chip.auto", { model: l.model ?? "?" })} · ${slot} · ${l.purpose ?? ""}${why ? ` · ${t("chip.escalated", { why })}` : ""}`;
}

/** Chip on the turn summary: the last main-turn Auto route ("Auto → Opus 5.5 · leo cấp: …"). */
function autoChip(routes: ChatLine[], t: T): { text: string; tip: string; escalated: boolean } | null {
  const main = routes.filter(
    (l): l is RouteLine =>
      l.kind === "route" && Boolean(l.slot) && !(l.purpose === "title" || l.purpose?.startsWith("subagent:")),
  );
  const last = main[main.length - 1];
  if (!last) return null;
  const why = last.escalated ? escalationWhy(last.reason, t) : "";
  const models = [...new Set(main.map((l) => l.model))].join(" → ");
  return {
    text: `${t("chip.auto", { model: last.model ?? "?" })}${why ? ` · ${t("chip.escalated", { why })}` : ""}`,
    tip: routes
      .filter((l): l is RouteLine => l.kind === "route")
      .map((l) => routeLineText(l, t))
      .concat(main.length > 1 ? [t("chip.inTurn", { models })] : [])
      .join("\n"),
    escalated: Boolean(why),
  };
}

function summaryLabel(turn: Turn, run: RunMeter | null, now: number, awaitingPermission: boolean, t: T): string {
  if (turn.live) return pulseLabel(run, now, awaitingPermission, t);
  return formatWorked(turn.worked?.ms, t);
}

/** Icon Fork Chat kiểu Cursor — thân dọc, tách hai nhánh chéo có mũi tên. */
function ForkChatIcon(props: { size?: number; strokeWidth?: number }) {
  const size = props.size ?? 13;
  const sw = props.strokeWidth ?? 1.75;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 22V11" />
      <path d="M12 11 4.5 5" />
      <path d="M12 11 19.5 5" />
      <path d="M4.5 5 4.5 2.25M4.5 5 1.75 5" />
      <path d="M19.5 5 19.5 2.25M19.5 5 22.25 5" />
    </svg>
  );
}

const COPY_FEEDBACK_MS = 2200;

function AiFooter(props: {
  text: string;
  canFork?: boolean;
  forkDisabled?: boolean;
  onFork?: () => void;
  onCopied?: () => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.text);
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      setCopied(true);
      props.onCopied?.();
      timerRef.current = window.setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, COPY_FEEDBACK_MS);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="msg-ai-foot">
      <button
        type="button"
        className={`msg-ai-action msg-ai-copy${copied ? " is-copied" : ""}`}
        title={t("chat.copyMessage")}
        aria-label={copied ? t("common.copied") : t("chat.copyMessage")}
        onClick={() => void copy()}
      >
        <span className="msg-ai-ico msg-ai-ico-copy" aria-hidden>
          <Copy size={13} strokeWidth={1.75} />
        </span>
        <span className="msg-ai-ico msg-ai-ico-check" aria-hidden>
          <Check size={13} strokeWidth={2.25} />
        </span>
      </button>
      {props.canFork ? (
        <button
          type="button"
          className="msg-ai-action"
          title={t("chat.fork")}
          aria-label={t("chat.fork")}
          disabled={props.forkDisabled}
          onClick={() => props.onFork?.()}
        >
          <ForkChatIcon size={13} strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}

function AgentMeta(props: {
  turn: Turn;
  view: TranscriptView;
  run?: RunMeter | null;
  awaitingPermission?: boolean;
  onRestoreCheckpoint?: (id: string) => void;
}) {
  const t = useT();
  const run = props.turn.live ? (props.run ?? null) : null;
  const awaiting = Boolean(props.turn.live && props.awaitingPermission);
  const now = useNow(Boolean(props.turn.live));
  const phase = runPhase(run, awaiting);
  const explored = exploreLabel(props.turn.traces, props.turn.narrations, t);
  const steps = displaySteps(props.turn);
  const active = steps.find((s) => s.active);
  const { label: tLabel, live: thinkingLive } = thoughtLabel(props.turn, t);
  const liveBrief = active
    ? stepText(active.step, t)
    : props.turn.narrations.some((s) => isPlanningVerb(s.verb))
      ? t("verb.Planning next moves")
      : thinkingLive
        ? t("verb.Thinking")
        : t("run.workingDots");
  const thoughtBody = props.turn.thought?.body?.trim() ?? "";
  const routes = props.turn.traces.filter((l) => l.kind === "route");
  const chip = autoChip(routes, t);
  const tools = props.turn.traces.filter((l) => l.kind === "tool" || l.kind === "sys");
  const hasBody =
    props.turn.live ||
    Boolean(tLabel) ||
    Boolean(thoughtBody) ||
    explored.show ||
    Boolean(props.turn.checkpoint) ||
    routes.length > 0 ||
    tools.length > 0;

  const opened = transcriptOpen(props.view, {
    live: Boolean(props.turn.live),
    thoughtHasBody: Boolean(thoughtBody),
    thinkingLive,
    hasSteps: steps.length > 0,
    hasThought: Boolean(tLabel),
  });

  return (
    <details className={`msg-agent-meta${props.turn.live ? " live" : ""}`} open={(hasBody && opened.meta) || undefined}>
      <summary>
        <span
          className={props.turn.live ? `msg-pulse ${phase}` : undefined}
          title={props.turn.live ? pulseTip(run, t) || undefined : undefined}
          aria-live={props.turn.live ? "off" : undefined}
        >
          {summaryLabel(props.turn, run, now, awaiting, t)}
        </span>
        {chip ? (
          <span className={`route-chip${chip.escalated ? " escalated" : ""}`} title={chip.tip}>
            {chip.text}
          </span>
        ) : null}
        <ChevronDown size={14} className="msg-agent-meta-chev" />
      </summary>
      {hasBody ? (
        <div className="msg-agent-meta-body">
          {props.turn.live && !tLabel ? <p className="msg-status-brief">{liveBrief}</p> : null}

          {tLabel ? (
            <details
              className={`msg-thought-block${thinkingLive ? " live" : ""}`}
              open={opened.thought || undefined}
            >
              <summary>
                <span className={`msg-thought-label${thinkingLive ? " active" : ""}`}>{tLabel}</span>
                {thoughtBody || thinkingLive ? (
                  <ChevronDown size={13} className="msg-agent-meta-chev" />
                ) : null}
              </summary>
              {thoughtBody ? <pre className="msg-thought-body">{thoughtBody}</pre> : null}
              {!thoughtBody && thinkingLive ? (
                <p className="msg-meta-line stub">{t("meta.waitingReasoning")}</p>
              ) : null}
            </details>
          ) : null}

          {explored.show ? (
            <details className="msg-explored" open={opened.explored || undefined}>
              <summary>
                <span className={explored.stub ? "stub" : undefined}>{explored.label}</span>
                {steps.length > 0 ? <ChevronDown size={13} className="msg-agent-meta-chev" /> : null}
              </summary>
              {steps.length > 0 ? (
                <ul className="msg-step-list">
                  {steps.map(({ step, active }, j) => (
                    <li key={j} className={`msg-step${active ? " active" : ""}`}>
                      <span className="msg-step-verb">{verbText(step.verb, t)}</span>
                      {step.detail ? <span className="msg-step-detail">{detailText(step.detail, t)}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </details>
          ) : null}

          {routes.map((l, j) =>
            l.kind === "route" ? (
              <div
                key={`route-${j}`}
                className={`msg-meta-route${l.escalated ? " escalated" : ""}`}
                title={l.reason || undefined}
              >
                {routeLineText(l, t)}
              </div>
            ) : null,
          )}

          {props.turn.checkpoint ? (
            <div className="msg-checkpoint">
              <span className="msg-checkpoint-label" title={formatAbsolute(props.turn.checkpoint.at, t("locale"))}>
                {props.turn.checkpoint.label === "Checkpoint" ? t("meta.checkpoint") : props.turn.checkpoint.label}
                {props.turn.checkpoint.files.length
                  ? ` · ${countText(props.turn.checkpoint.files.length, "meta.files1", "meta.files", t)}`
                  : ""}
              </span>
              {props.onRestoreCheckpoint ? (
                <button
                  type="button"
                  className="msg-checkpoint-btn"
                  title={t("meta.restoreTip")}
                  onClick={() => props.onRestoreCheckpoint?.(props.turn.checkpoint!.id)}
                >
                  <RotateCcw size={12} strokeWidth={1.75} />
                  {t("meta.restore")}
                </button>
              ) : null}
            </div>
          ) : null}

          {tools.length > 0 ? (
            <details className="msg-agent-meta-trace" open={opened.tools || undefined}>
              <summary>{t("meta.toolDetails")}</summary>
              {tools.map((l, j) => (
                <pre key={j}>
                  {l.kind === "tool" ? `${l.name}\n${l.output.slice(0, 1400)}` : "text" in l ? l.text : ""}
                </pre>
              ))}
            </details>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

export function ChatPane(props: {
  lines: ChatLine[];
  plan: string | null;
  perm: Perm | null;
  diff: Diff | null;
  sessionId: string;
  hasSession: boolean;
  wsName: string;
  /** Đường dẫn workspace: xem trước ảnh workspace agent nhắc tới (`fs.read_image`). */
  workspace?: string;
  busy?: boolean;
  /** Run pulse của lượt live (elapsed, token, Stop) — `runStatus.ts`. */
  run?: RunMeter | null;
  onApprovePlan: () => void;
  onRevisePlan?: () => void;
  /** Mở file trong workspace khi bấm chip `path:line` trong câu trả lời. */
  onOpenFile?: (path: string) => void;
  /** Mode hiện tại của composer: thẻ gợi ý chỉ hiện khi vẫn đang ở mode chỉ đọc. */
  mode?: SessionMode;
  /** Bấm "Chuyển sang Agent": đổi mode và gửi lại đúng prompt của lượt đó. */
  onSwitchAndRun?: (mode: SessionMode, prompt: string) => void;
  permBusy?: boolean;
  permError?: boolean;
  onAllow: (scope: PermScope) => void;
  onDeny: () => void;
  onApplyDiff: () => void;
  onRejectDiff: () => void;
  onShowDiff: () => void;
  onRestoreCheckpoint?: (id: string) => void;
  onForkChat?: (endLineInclusive: number) => void;
  onOpenWorkspace?: () => void;
  onChip?: (chip: string) => void;
  onUsePrompt?: (text: string) => void;
  onRetry?: () => void;
  /** Settings → Chat → default view: which blocks of a turn start open. */
  transcript?: TranscriptView;
  /** "Gửi cho agent" từ trình chỉnh sửa ảnh: đính PNG đã đánh dấu + điền sẵn prompt. Trả lỗi nếu không đính được. */
  onAttachEdited?: (png: Blob, prompt: string) => Promise<string | null>;
}) {
  const t = useT();
  const steps = props.plan ? planSteps(props.plan) : [];
  const turns = useMemo(() => groupTurns(props.lines, Boolean(props.busy)), [props.lines, props.busy]);
  const logRef = useRef<HTMLDivElement>(null);
  const [copyToast, setCopyToast] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxState>(null);
  const openImages = useCallback((images: string[], index: number) => setLightbox({ images, index }), []);
  const [editor, setEditor] = useState<EditTarget | null>(null);
  const editImage = props.onAttachEdited ? setEditor : undefined;
  // endLine của các gợi ý đổi mode đã bị "Giữ …" (chỉ ẩn trong phiên UI này).
  const [dismissedSuggest, setDismissedSuggest] = useState<Set<number>>(new Set());
  // Nhớ quyền mở rộng độ tin cậy nên luôn là nút riêng (không tick sẵn); Engine quyết định có cho nhớ không.
  const scopes = scopeLabels(props.perm, t);
  const permCommand = (props.perm?.input as { command?: unknown } | null | undefined)?.command;
  const copyToastTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyToastTimer.current != null) window.clearTimeout(copyToastTimer.current);
    };
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (!el || (props.lines.length === 0 && !props.plan)) return;
    el.scrollTop = el.scrollHeight;
  }, [props.lines, props.plan, props.busy]);

  function showCopyToast() {
    if (copyToastTimer.current != null) window.clearTimeout(copyToastTimer.current);
    setCopyToast(true);
    copyToastTimer.current = window.setTimeout(() => {
      setCopyToast(false);
      copyToastTimer.current = null;
    }, COPY_FEEDBACK_MS);
  }

  function onMode(id: string) {
    if (!props.hasSession) {
      props.onOpenWorkspace?.();
      return;
    }
    props.onChip?.(id);
  }

  return (
    <div className="chat-pane">
      {lightbox ? (
        <ImageLightbox
          images={lightbox.images}
          index={lightbox.index}
          onClose={() => setLightbox(null)}
          onEdit={
            editImage
              ? (src) => {
                  setLightbox(null);
                  setEditor({ src });
                }
              : undefined
          }
        />
      ) : null}
      {editor && props.onAttachEdited ? (
        <ImageEditor target={editor} onClose={() => setEditor(null)} onSend={props.onAttachEdited} />
      ) : null}
      {copyToast ? (
        <div className="app-toast" role="status" aria-live="polite">
          <Info size={14} strokeWidth={2} className="app-toast-ico" aria-hidden />
          <span>{t("chat.copiedToast")}</span>
        </div>
      ) : null}
      <SoftScroll viewportRef={logRef} deps={[props.lines, props.plan, turns.length, props.busy]}>
      <div className="log">
        {props.lines.length === 0 && !props.plan && (
          <div className="empty-hub">
            <div className="empty-ico">{props.hasSession ? <Sparkles size={20} /> : <FolderOpen size={20} />}</div>
            {props.hasSession ? (
              <>
                <h3>{t("hub.title")}</h3>
                <p>
                  {t("hub.readyBefore")}
                  <b>{props.wsName || t("hub.current")}</b>
                  {t("hub.readyAfter")}
                </p>
              </>
            ) : (
              <>
                <h3>{t("hub.noWsTitle")}</h3>
                <p>{t("hub.noWsBody")}</p>
                {props.onOpenWorkspace && (
                  <button type="button" className="run-btn" onClick={props.onOpenWorkspace}>
                    {t("common.openWorkspace")}
                  </button>
                )}
              </>
            )}

            <div className="hub-section">
              <span className="hub-label">{t("hub.modes")}</span>
              <div className="hub-modes">
                {MODES.map(({ id, title, desc, Icon }) => (
                  <button key={id} type="button" className="hub-mode" onClick={() => onMode(id)}>
                    <Icon size={16} />
                    <strong>{title}</strong>
                    <span>{t(desc)}</span>
                  </button>
                ))}
              </div>
            </div>

            {props.hasSession && (
              <div className="hub-section">
                <span className="hub-label">{t("hub.prompts")}</span>
                <div className="hub-prompts">
                  {PROMPTS.map((key) => (
                    <button key={key} type="button" className="hub-prompt" onClick={() => props.onUsePrompt?.(t(key))}>
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {turns.map((turn, i) => {
          const showMeta = Boolean(
            turn.worked || turn.ai || turn.traces.length || turn.narrations.length || turn.thought || turn.live || turn.checkpoint,
          );
          return (
            <div key={i} className="msg-turn">
              {turn.user || turn.userImages?.length || turn.userImageCount ? (
                <div className="msg-user">
                  <div className="msg-bubble">
                    {turn.userImages?.length ? (
                      <div className="msg-images">
                        {turn.userImages.map((src, j) => (
                          <ImageFrame
                            key={j}
                            src={src}
                            alt={t("img.alt", { n: j + 1 })}
                            title={t("img.zoom")}
                            onOpen={() => setLightbox({ images: turn.userImages ?? [], index: j })}
                            onEdit={props.onAttachEdited ? () => setEditor({ src }) : undefined}
                          />
                        ))}
                      </div>
                    ) : turn.userImageCount ? (
                      <span className="msg-images-note">{t("chat.imagesNotSaved", { n: turn.userImageCount })}</span>
                    ) : null}
                    {turn.user}
                  </div>
                </div>
              ) : null}
              {showMeta ? (
                <AgentMeta
                  turn={turn}
                  view={props.transcript ?? "compact"}
                  run={props.run}
                  awaitingPermission={Boolean(props.perm)}
                  onRestoreCheckpoint={props.onRestoreCheckpoint}
                />
              ) : null}
              {turn.ai ? (
                <div className="msg-ai-wrap">
                  <MarkdownMessage
                    text={turn.ai.text}
                    onOpenFile={props.onOpenFile}
                    workspace={props.workspace}
                    onOpenImage={openImages}
                    streaming={Boolean(turn.live)}
                    onEditImage={turn.live ? undefined : editImage}
                  />
                  {turn.live ? null : (
                    <ImageRefStrip workspace={props.workspace} text={turn.ai.text} onOpen={openImages} onEdit={editImage} />
                  )}
                  <AiFooter
                    text={turn.ai.text}
                    canFork={Boolean(props.onForkChat) && !turn.live}
                    forkDisabled={Boolean(props.busy)}
                    onFork={() => props.onForkChat?.(turn.endLine)}
                    onCopied={showCopyToast}
                  />
                </div>
              ) : null}
              {turn.suggest &&
              props.onSwitchAndRun &&
              i === turns.length - 1 &&
              !props.busy &&
              props.mode !== turn.suggest.mode &&
              !dismissedSuggest.has(turn.endLine) ? (
                <div className="mode-suggest" role="group" aria-label={t("suggest.label")}>
                  <p>{turn.suggest.reason || t("suggest.question", { mode: MODE_LABEL[turn.suggest.mode] })}</p>
                  <div className="row">
                    <button
                      type="button"
                      className="primary"
                      onClick={() => props.onSwitchAndRun?.(turn.suggest!.mode, turn.suggest!.prompt)}
                    >
                      {t("suggest.switch", { mode: MODE_LABEL[turn.suggest.mode] })}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setDismissedSuggest((s) => new Set(s).add(turn.endLine))}
                    >
                      {props.mode ? t("suggest.keep", { mode: MODE_LABEL[props.mode] }) : t("suggest.keepCurrent")}
                    </button>
                  </div>
                </div>
              ) : null}
              {turn.errors.map((e, j) => (
                <ErrorCard
                  key={`err-${j}`}
                  message={e.message}
                  info={e.info}
                  retryDisabled={Boolean(props.busy)}
                  onRetry={i === turns.length - 1 ? props.onRetry : undefined}
                />
              ))}
            </div>
          );
        })}

        {props.plan && (
          <div className="plan-card">
            <div className="plan-head">
              <ListChecks size={16} />
              <b>{t("plan.title")}</b>
              <span>{t("plan.pending")}</span>
            </div>
            <div className="progress">
              <i style={{ width: "8%" }} />
            </div>
            <ol>
              {(steps.length ? steps : [t("plan.seeBelow")]).map((s, i) => (
                <li key={i}>
                  <span className="plan-n">{i + 1}.</span>
                  <Circle size={14} />
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            <pre className="plan-md">{props.plan}</pre>
            <div className="row">
              <button type="button" className="primary" onClick={props.onApprovePlan}>
                <CheckCircle2 size={14} /> {t("plan.approve")}
              </button>
              {props.onRevisePlan ? (
                <button type="button" className="ghost" onClick={props.onRevisePlan}>
                  {t("plan.revise")}
                </button>
              ) : null}
            </div>
          </div>
        )}

        {props.perm && (
          <div className="banner warn perm-card" role="alertdialog" aria-label={t("perm.cardLabel")}>
            <h4>
              <span className={`perm-tier ${tierBadge(props.perm.risk?.tier, t).cls}`}>
                {tierBadge(props.perm.risk?.tier, t).label}
              </span>
              {props.perm.risk?.reasons[0]?.title
                ? t("perm.askWithReason", { reason: props.perm.risk.reasons[0].title, tool: props.perm.name })
                : t("perm.ask", { tool: props.perm.name })}
            </h4>
            {/* Lệnh thật luôn hiện nguyên văn: duyệt dựa trên lệnh, không dựa trên mô tả. */}
            <pre>{typeof permCommand === "string" ? permCommand : JSON.stringify(props.perm.input, null, 2)}</pre>
            {props.perm.risk?.reasons.length ? (
              <ul className="perm-reasons">
                {props.perm.risk.reasons.map((r) => (
                  <li key={r.code} title={r.code}>
                    <strong>{r.title}.</strong> {r.detail}
                  </li>
                ))}
              </ul>
            ) : null}
            {props.permError && (
              <p className="perm-error" role="alert">
                <strong>{t("perm.sendFailed")}</strong> {t("perm.sendFailedHint")}
              </p>
            )}
            <div className="row perm-actions">
              <button
                type="button"
                className="primary"
                disabled={props.permBusy}
                onClick={() => props.onAllow("once")}
              >
                {t("perm.allowOnce")}
              </button>
              {scopes ? (
                <>
                  <button
                    type="button"
                    className="ghost"
                    disabled={props.permBusy}
                    title={t("perm.sessionTip")}
                    onClick={() => props.onAllow("session")}
                  >
                    {scopes.session}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={props.permBusy}
                    title={t("perm.workspaceTip")}
                    onClick={() => props.onAllow("workspace")}
                  >
                    {scopes.workspace}
                  </button>
                </>
              ) : null}
              <button type="button" className="ghost" disabled={props.permBusy} onClick={props.onDeny}>
                {t("perm.deny")}
              </button>
            </div>
          </div>
        )}

        {props.diff && (
          <DiffCard
            diff={props.diff}
            onApply={props.onApplyDiff}
            onReject={props.onRejectDiff}
            onShow={props.onShowDiff}
            onOpenImage={openImages}
          />
        )}
      </div>
      </SoftScroll>
    </div>
  );
}
