import {
  Check,
  CheckCircle2,
  ChevronDown,
  FileText,
  History,
  Quote,
  RefreshCw,
  TextSelect,
  Circle,
  Code2,
  Copy,
  FolderOpen,
  Info,
  ListChecks,
  Pause,
  Pin,
  RotateCcw,
  Sparkles,
  Square,
  Volume2,
  GraduationCap,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
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
import type { PermScope } from "../permissionUi";
import type { PermAnswer } from "../types";
import { PermissionCard } from "./PermissionCard";
import { VerifyCard, type VerifyLine } from "./VerifyCard";
import { DiffCard } from "./DiffCard";
import { ErrorCard } from "./ErrorCard";
import { MarkdownMessage } from "./MarkdownMessage";
import { ImageLightbox, type LightboxState } from "./ImageLightbox";
import { ImageEditor } from "./ImageEditor";
import { ImageFrame } from "./ImageFrame";
import { UserMessage } from "./UserMessage";
import { MessageTime } from "./MessageTime";
import { ForkIcon } from "./ForkIcon";
import { ChapterNav, chapterTitle, chaptersFrom } from "./ChapterNav";
import { canReadAloud, pauseSpeech, resumeSpeech, speak, stopSpeech, useSpeechStatus } from "../readAloud";
import type { EditTarget } from "../imageActions";
import { ImageRefStrip } from "./WorkspaceImage";
import { SoftScroll } from "./SoftScroll";
import { RunIndicator } from "./RunIndicator";
import { transcriptOpen, type TranscriptView } from "../prefs";
import { stripMarkdown } from "../messageMenu";
import { MessageMenu, type MenuAt, type MessageMenuItem } from "./MessageMenu";

const MODES = [
  { id: "Plan", title: "Plan", desc: "hub.planDesc", Icon: ListChecks },
  { id: "Code", title: "Code", desc: "hub.codeDesc", Icon: Code2 },
] as const;

const PROMPTS: MsgKey[] = ["hub.prompt1", "hub.prompt2", "hub.prompt3"];

type Turn = {
  user: string;
  /** Ảnh dán kèm (data URL, chỉ trong phiên) hoặc số ảnh khi mở lại từ lịch sử. */
  userImages?: string[];
  userImageCount?: number;
  /** Lúc gửi tin user (ms); tin cũ không có. */
  userAt?: number;
  /** Tên chương nếu lượt này được ghim (lưu trên dòng user). */
  chapter?: string;
  worked?: { ms: number; at: number };
  thought?: { ms?: number; brief: string; body?: string };
  narrations: NarrateStep[];
  checkpoint?: { id: string; at: number; label: string; files: { path: string; before: string; after: string }[] };
  traces: ChatLine[];
  ai?: { text: string; at?: number };
  errors: Extract<ChatLine, { kind: "error" }>[];
  suggest?: Extract<ChatLine, { kind: "mode_suggest" }>;
  /** Check rounds after the turn (roadmap 1.8), oldest first. */
  verify?: VerifyLine[];
  live?: boolean;
  /** Index dòng cuối (inclusive) trong `lines` thuộc turn này — dùng Fork Chat */
  endLine: number;
  /** Index của dòng `user` mở turn này; -1 khi turn không có tin user (Rewind / Fork from here). */
  startLine: number;
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
      cur = { user: "", traces: [], narrations: [], errors: [], endLine: lineIdx, startLine: -1 };
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
        userAt: l.at,
        chapter: l.chapter,
        traces: [],
        narrations: [],
        errors: [],
        endLine: i,
        startLine: i,
      };
      turns.push(cur);
    } else if (l.kind === "worked") {
      const t = ensure(i);
      t.worked = { ms: l.ms, at: l.at };
      if (t.ai && !t.ai.at) t.ai.at = l.at;
      // Tin user cũ chưa lưu `at`: lượt bắt đầu đúng lúc gửi nên giờ gửi = lúc xong − thời gian chạy.
      if (t.startLine >= 0 && t.userAt == null && l.at > 0 && Number.isFinite(l.ms)) t.userAt = l.at - l.ms;
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
    } else if (l.kind === "verify") {
      const t = ensure(i);
      t.verify = [...(t.verify ?? []), l];
    } else if (l.kind === "token") {
      const t = ensure(i);
      // The agent's answer to a failed check round starts a new paragraph of the same turn.
      const afterVerify = lines[i - 1]?.kind === "verify";
      if (t.ai) t.ai.text += afterVerify && t.ai.text ? `\n\n${l.text}` : l.text;
      else t.ai = { text: l.text, at: t.worked?.at };
    } else if (l.kind === "error") {
      ensure(i).errors.push(l);
    } else if (l.kind === "mode_suggest") {
      ensure(i).suggest = l;
    } else {
      ensure(i).traces.push(l);
    }
  }

  // `worked` alone is not content: an orphan meta line (old history, a stray `done`) must not render
  // "Worked for —" over an empty chat.
  const out = turns.filter((t) => t.user || t.userImages?.length || t.userImageCount || t.ai || t.narrations.length || t.thought || t.errors.length);
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
  /* Gộp Read liên tiếp cùng file → `Read App.tsx (1–40, 615–629)` (docs/frontend/status.md). */
  if (!turn.live) {
    return mergeReadSteps(activityNarrations(turn.narrations)).map((s) => ({ step: narrateToPast(s), active: false }));
  }
  /* Live (status.md → Run indicator): Planning là một bước như mọi bước, nhưng chỉ khi nó là việc đang làm —
   * có bước thật thì nó biến mất, không đứng lại in đậm. Thinking/Thought có block riêng nên không vào danh sách;
   * đang Thinking thì không bước nào "đang chạy". */
  const ns = turn.narrations.filter((s) => !/^Thought$/i.test(s.verb));
  const thinking = /^Thinking$/i.test(ns[ns.length - 1]?.verb ?? "");
  const raw = mergeReadSteps(
    ns.filter((s, i) => !/^Thinking$/i.test(s.verb) && (!isPlanningVerb(s.verb) || i === ns.length - 1)),
  );
  return raw.map((s, i) => {
    const active = !thinking && i === raw.length - 1;
    return active ? { step: s, active } : { step: narrateToPast(s), active: false };
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
/** Bước chạy từ 3s trở lên mới hiện thời gian: Read/Search nhanh không nháy "0s 1s 2s"; lệnh chậm lộ ra ngay. */
const STEP_ELAPSED_MIN_MS = 3000;

function StepElapsed(props: { at?: number; now: number }) {
  if (typeof props.at !== "number") return null;
  const ms = props.now - props.at;
  if (ms < STEP_ELAPSED_MIN_MS) return null;
  return <span className="msg-step-time">{formatDuration(ms)}</span>;
}

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

const COPY_FEEDBACK_MS = 2200;

function AiFooter(props: {
  text: string;
  /** Lúc trả lời xong (ms); hiện sau các nút. */
  at?: number;
  canFork?: boolean;
  forkDisabled?: boolean;
  onFork?: () => void;
  onCopied?: () => void;
  /** Ghim lượt này làm chương (mục lục chương). Không có = lượt không ghim được (không có tin user). */
  pinned?: boolean;
  onPin?: () => void;
  /** Khoá cho Đọc to; không có = không đọc (đang stream). */
  speechId?: string;
  /** "Record a lesson" about this turn (TS core, roadmap 1.9). */
  onLesson?: () => void;
}) {
  const t = useT();
  const speaking = useSpeechStatus(props.speechId ?? "") !== "idle" && Boolean(props.speechId);
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
    // Đang đọc to thì giữ hàng hiện (không phải rê chuột mới thấy nút Tạm dừng).
    <div className={`msg-ai-foot${speaking ? " is-active" : ""}`}>
      <button
        type="button"
        className={`msg-ai-action msg-ai-copy${copied ? " is-copied" : ""}`}
        title={copied ? t("common.copied") : t("chat.copyMessage")}
        data-tip-side="above"
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
          data-tip-desc={t(props.forkDisabled ? "msgMenu.busyDesc" : "msgMenu.forkAiDesc")}
          data-tip-side="above"
          aria-label={t("chat.fork")}
          aria-disabled={props.forkDisabled || undefined}
          onClick={props.forkDisabled ? undefined : () => props.onFork?.()}
        >
          <ForkIcon size={14} strokeWidth={1.75} />
        </button>
      ) : null}
      {props.onPin ? (
        <button
          type="button"
          className={`msg-ai-action${props.pinned ? " is-on" : ""}`}
          title={t(props.pinned ? "chapter.unpin" : "chapter.pin")}
          data-tip-desc={t(props.pinned ? "chapter.unpinDesc" : "chapter.pinDesc")}
          data-tip-side="above"
          aria-label={t(props.pinned ? "chapter.unpin" : "chapter.pin")}
          aria-pressed={Boolean(props.pinned)}
          onClick={props.onPin}
        >
          <Pin size={14} strokeWidth={1.75} />
        </button>
      ) : null}
      {props.speechId && canReadAloud() ? <ReadAloudButtons id={props.speechId} text={props.text} /> : null}
      {props.onLesson ? (
        <button
          type="button"
          className="msg-ai-action"
          title={t("lesson.button")}
          data-tip-desc={t("lesson.buttonDesc")}
          data-tip-side="above"
          aria-label={t("lesson.button")}
          onClick={props.onLesson}
        >
          <GraduationCap size={14} strokeWidth={1.75} />
        </button>
      ) : null}
      {props.at ? <MessageTime at={props.at} /> : null}
    </div>
  );
}

/**
 * Đọc to (như Claude): 🔊 Đọc to → ⏸ Tạm dừng → 🔊 Tiếp tục (nút sáng). Thêm ■ Dừng khi đang đọc /
 * tạm dừng (Claude không có) để tắt hẳn mà không phải đọc hết.
 */
function ReadAloudButtons(props: { id: string; text: string }) {
  const t = useT();
  const status = useSpeechStatus(props.id);
  const label = status === "speaking" ? t("speech.pause") : status === "paused" ? t("speech.resume") : t("speech.read");
  return (
    <>
      <button
        type="button"
        className={`msg-ai-action${status !== "idle" ? " is-on" : ""}`}
        title={label}
        data-tip-side="above"
        aria-label={label}
        onClick={() => {
          if (status === "speaking") pauseSpeech();
          else if (status === "paused") resumeSpeech();
          else speak(props.id, props.text);
        }}
      >
        {status === "speaking" ? <Pause size={14} strokeWidth={1.75} /> : <Volume2 size={14} strokeWidth={1.75} />}
      </button>
      {status !== "idle" ? (
        <button
          type="button"
          className="msg-ai-action"
          title={t("speech.stop")}
          data-tip-side="above"
          aria-label={t("speech.stop")}
          onClick={stopSpeech}
        >
          <Square size={12} strokeWidth={2} />
        </button>
      ) : null}
    </>
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
  const { label: tLabel, live: thinkingLive } = thoughtLabel(props.turn, t);
  const thoughtBody = props.turn.thought?.body?.trim() ?? "";
  const stepList = (
    <ul className="msg-step-list">
      {steps.map(({ step, active }, j) => (
        <li key={j} className={`msg-step${active ? " active" : ""}`}>
          {active ? <RunIndicator phase={phase} /> : null}
          <span className={`msg-step-body${active && phase === "working" ? " run-shimmer" : ""}`}>
            <span className="msg-step-verb">{verbText(step.verb, t)}</span>
            {step.detail ? <span className="msg-step-detail">{detailText(step.detail, t)}</span> : null}
            {step.sandboxed ? (
              <span className="msg-step-sbx" title={t("sandbox.badgeTip")}>
                {t("sandbox.badge")}
              </span>
            ) : null}
            {active ? <StepElapsed at={step.at} now={now} /> : null}
          </span>
        </li>
      ))}
    </ul>
  );
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
          {props.turn.live ? <RunIndicator phase={phase} /> : null}
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
          {tLabel ? (
            <details
              className={`msg-thought-block${thinkingLive ? " live" : ""}`}
              open={opened.thought || undefined}
            >
              <summary>
                <span className={`msg-thought-label${thinkingLive ? " active" : ""}`}>
                  {thinkingLive ? <RunIndicator phase={phase} /> : null}
                  <span className={thinkingLive && phase === "working" ? "run-shimmer" : undefined}>{tLabel}</span>
                </span>
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
              {steps.length > 0 ? stepList : null}
            </details>
          ) : null}

          {/* Chỉ có Planning (chưa có bước thật): bước đang chạy đứng riêng, chưa có nhãn "Explored". */}
          {!explored.show && props.turn.live && steps.length > 0 ? stepList : null}

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
  /** Tự chủ đang chạy như Cân bằng vì sandbox không Ready (dòng giải thích, `null` = không có gì). */
  sandboxNote?: string | null;
  onOpenPermissions?: () => void;
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
  /** Rust Engine card. */
  onAllow: (scope: PermScope) => void;
  onDeny: () => void;
  /** TS core card (`risk.level`): allow once / always, deny, deny + rule. */
  onAnswer?: (a: PermAnswer) => void;
  /** TS core card: deny and send a note from the composer. */
  onDenyNote?: () => void;
  onApplyDiff: () => void;
  onRejectDiff: () => void;
  onShowDiff: () => void;
  onRestoreCheckpoint?: (id: string) => void;
  onForkChat?: (endLineInclusive: number) => void;
  onOpenWorkspace?: () => void;
  onChip?: (chip: string) => void;
  onUsePrompt?: (text: string) => void;
  /** Thử lại lượt lỗi cuối; `text` là tin user của chính lượt đó (không có thì App dùng prompt gần nhất). */
  onRetry?: (text?: string) => void;
  /** Lỗi hạn mức/đăng nhập: mở chọn model/nguồn khác. */
  onSwitchModel?: () => void;
  /** Menu chuột phải → Attach message as context: chèn trích dẫn vào composer. */
  onAttachMessage?: (text: string) => void;
  /** Menu chuột phải → Rewind to here: cắt từ dòng user `userLine` (App hỏi xác nhận). */
  onRewind?: (userLine: number) => void;
  /** Menu chuột phải → Fork from here: chat mới giữ hội thoại trước dòng user `userLine`. */
  onForkFrom?: (userLine: number) => void;
  /** Menu chuột phải trên câu trả lời của lượt cuối → Retry: bỏ câu trả lời, gửi lại tin user. */
  onRetryTurn?: (userLine: number) => void;
  /** Ghim / bỏ ghim lượt mở bằng dòng user `userLine` làm chương (`title` null = bỏ ghim). */
  onPinChapter?: (userLine: number, title: string | null) => void;
  /** Open "Record a lesson" for a finished turn (needs the TS core). */
  onLesson?: (user: string, answer: string) => void;
  /** Settings → Chat → default view: which blocks of a turn start open. */
  transcript?: TranscriptView;
  /** "Gửi cho agent" từ trình chỉnh sửa ảnh: đính PNG đã đánh dấu + điền sẵn prompt. Trả lỗi nếu không đính được. */
  onAttachEdited?: (png: Blob, prompt: string) => Promise<string | null>;
}) {
  const t = useT();
  const steps = props.plan ? planSteps(props.plan) : [];
  const turns = useMemo(() => groupTurns(props.lines, Boolean(props.busy)), [props.lines, props.busy]);
  const logRef = useRef<HTMLDivElement>(null);
  const startLabel = t("chapter.start");
  const chapters = useMemo(() => chaptersFrom(turns, startLabel), [turns, startLabel]);
  // Đổi phiên / đóng khung chat: dừng đọc to (không để giọng đọc chạy tiếp của chat khác).
  useEffect(() => () => stopSpeech(), [props.sessionId]);
  const [copyToast, setCopyToast] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxState>(null);
  const openImages = useCallback((images: string[], index: number) => setLightbox({ images, index }), []);
  const [editor, setEditor] = useState<EditTarget | null>(null);
  const editImage = props.onAttachEdited ? setEditor : undefined;
  // endLine của các gợi ý đổi mode đã bị "Giữ …" (chỉ ẩn trong phiên UI này).
  const [dismissedSuggest, setDismissedSuggest] = useState<Set<number>>(new Set());
  const copyToastTimer = useRef<number | null>(null);
  const [menu, setMenu] = useState<{ at: MenuAt; turn: number; on: "user" | "ai"; selection: string } | null>(null);

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

  function copyText(text: string) {
    void navigator.clipboard
      ?.writeText(text)
      .then(showCopyToast)
      .catch(() => {});
  }

  /** Chuột phải (hoặc Shift+F10 / phím Menu) trên tin user hoặc câu trả lời AI. */
  function openMenu(e: ReactMouseEvent | ReactKeyboardEvent, turn: number, on: "user" | "ai") {
    const keyboard = e.type === "keydown";
    if (keyboard) {
      const ke = e as ReactKeyboardEvent;
      if (!(ke.key === "ContextMenu" || (ke.key === "F10" && ke.shiftKey))) return;
    }
    e.preventDefault();
    const box = e.currentTarget as HTMLElement;
    const sel = window.getSelection();
    const selection =
      sel && !sel.isCollapsed && sel.anchorNode && box.contains(sel.anchorNode) ? sel.toString().trim() : "";
    const r = box.getBoundingClientRect();
    const at = keyboard
      ? { x: r.left + 8, y: r.bottom + 4 }
      : { x: (e as ReactMouseEvent).clientX, y: (e as ReactMouseEvent).clientY };
    setMenu({ at, turn, on, selection });
  }

  function menuItems(turn: Turn, on: "user" | "ai", selection: string, last: boolean): MessageMenuItem[] {
    const done = (fn: () => void) => () => {
      setMenu(null);
      fn();
    };
    const source = on === "user" ? turn.user : (turn.ai?.text ?? "");
    const items: MessageMenuItem[] = [];
    if (selection)
      items.push(
        {
          id: "sel",
          label: t("msgMenu.copySelection"),
          icon: <TextSelect size={14} />,
          run: done(() => copyText(selection)),
        },
        "divider",
      );
    items.push(
      {
        id: "copy",
        label: t("msgMenu.copy"),
        icon: <Copy size={14} />,
        kbd: "C",
        disabled: !source.trim(),
        // Tin của user là chữ người dùng tự gõ: copy nguyên văn. Câu trả lời AI: bỏ Markdown.
        run: done(() => copyText(on === "user" ? source : stripMarkdown(source))),
      },
    );
    if (on === "ai")
      items.push({
        id: "md",
        label: t("msgMenu.copyMarkdown"),
        icon: <FileText size={14} />,
        kbd: "M",
        disabled: !source.trim(),
        run: done(() => copyText(source)),
      });
    if (props.onAttachMessage)
      items.push("divider", {
        id: "attach",
        label: t("msgMenu.attach"),
        icon: <Quote size={14} />,
        kbd: "A",
        disabled: !source.trim(),
        run: done(() => props.onAttachMessage?.(source)),
      });
    const hasUser = turn.startLine >= 0;
    const locked = Boolean(props.busy) || Boolean(turn.live);
    const tail: MessageMenuItem[] = [];
    if (on === "user" && last && hasUser && props.onRetryTurn && (turn.ai || turn.errors.length) && (turn.user.trim() || turn.userImages?.length))
      tail.push({
        id: "retry",
        label: t("msgMenu.retry"),
        // Ảnh chỉ còn số đếm (đã mất khỏi bộ nhớ ảnh) thì Retry gửi lại không có ảnh: nói trước.
        desc: t(
          locked
            ? "msgMenu.busyDesc"
            : !turn.userImages?.length && turn.userImageCount
              ? "msgMenu.retryNoImages"
              : "msgMenu.retryDesc",
        ),
        icon: <RefreshCw size={14} />,
        kbd: "T",
        disabled: locked,
        run: done(() => props.onRetryTurn?.(turn.startLine)),
      });
    if (on === "user" && hasUser && props.onRewind)
      tail.push({
        id: "rewind",
        label: t("msgMenu.rewind"),
        desc: t(locked ? "msgMenu.busyDesc" : "msgMenu.rewindDesc"),
        icon: <History size={14} />,
        kbd: "R",
        danger: true,
        disabled: locked,
        run: done(() => props.onRewind?.(turn.startLine)),
      });
    if (on === "user" && hasUser && props.onForkFrom)
      tail.push({
        id: "fork",
        label: t("msgMenu.fork"),
        desc: t(locked ? "msgMenu.busyDesc" : "msgMenu.forkDesc"),
        icon: <ForkIcon size={14} />,
        kbd: "F",
        disabled: locked,
        run: done(() => props.onForkFrom?.(turn.startLine)),
      });
    if (on === "ai" && props.onForkChat && !turn.live)
      tail.push({
        id: "fork",
        label: t("chat.fork"),
        desc: t("msgMenu.forkAiDesc"),
        icon: <ForkIcon size={14} />,
        kbd: "F",
        disabled: Boolean(props.busy),
        run: done(() => props.onForkChat?.(turn.endLine)),
      });
    if (tail.length) items.push("divider", ...tail);
    return items;
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
      {menu && turns[menu.turn] ? (
        <MessageMenu
          at={menu.at}
          label={t(menu.on === "user" ? "msgMenu.labelUser" : "msgMenu.labelAi")}
          items={menuItems(turns[menu.turn], menu.on, menu.selection, menu.turn === turns.length - 1)}
          onClose={() => setMenu(null)}
        />
      ) : null}
      {copyToast ? (
        <div className="app-toast" role="status" aria-live="polite">
          <Info size={14} strokeWidth={2} className="app-toast-ico" aria-hidden />
          <span>{t("chat.copiedToast")}</span>
        </div>
      ) : null}
      <ChapterNav chapters={chapters} viewport={logRef} />
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
            <div key={i} data-turn={i} className={`msg-turn${menu?.turn === i ? " menu-open" : ""}`}>
              {turn.user || turn.userImages?.length || turn.userImageCount ? (
                <UserMessage
                  text={turn.user}
                  at={turn.userAt}
                  live={turn.live}
                  busy={props.busy}
                  images={
                    turn.userImages?.length ? (
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
                    ) : null
                  }
                  onCopy={copyText}
                  onMenu={(e) => openMenu(e, i, "user")}
                  onRetry={
                    i === turns.length - 1 && turn.startLine >= 0 && props.onRetryTurn && (turn.ai || turn.errors.length)
                      ? () => props.onRetryTurn?.(turn.startLine)
                      : undefined
                  }
                  onRewind={turn.startLine >= 0 && props.onRewind ? () => props.onRewind?.(turn.startLine) : undefined}
                  onFork={turn.startLine >= 0 && props.onForkFrom ? () => props.onForkFrom?.(turn.startLine) : undefined}
                />
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
                <div className="msg-ai-wrap" onContextMenu={(e) => openMenu(e, i, "ai")}>
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
                    at={turn.live ? undefined : turn.ai.at}
                    canFork={Boolean(props.onForkChat) && !turn.live}
                    forkDisabled={Boolean(props.busy)}
                    onFork={() => props.onForkChat?.(turn.endLine)}
                    onCopied={showCopyToast}
                    pinned={Boolean(turn.chapter)}
                    onPin={
                      props.onPinChapter && turn.startLine >= 0 && !turn.live
                        ? () =>
                            props.onPinChapter?.(
                              turn.startLine,
                              turn.chapter ? null : chapterTitle(turn.user) || t("chapter.untitled"),
                            )
                        : undefined
                    }
                    speechId={turn.live ? undefined : `${props.sessionId}:${turn.endLine}`}
                    onLesson={props.onLesson && !turn.live ? () => props.onLesson?.(turn.user, turn.ai?.text ?? "") : undefined}
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
              {turn.verify?.length ? <VerifyCard rounds={turn.verify} /> : null}
              {turn.errors.map((e, j) => (
                <ErrorCard
                  key={`err-${j}`}
                  message={e.message}
                  info={e.info}
                  retryDisabled={Boolean(props.busy)}
                  onRetry={i === turns.length - 1 && props.onRetry ? () => props.onRetry?.(turn.user || undefined) : undefined}
                  onSwitchModel={i === turns.length - 1 ? props.onSwitchModel : undefined}
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

        {props.sandboxNote ? (
          <div className="banner warn sbx-banner" role="status">
            <span>{props.sandboxNote}</span>
            {props.onOpenPermissions ? (
              <button type="button" className="ghost" onClick={props.onOpenPermissions}>
                {t("sandbox.openSettings")}
              </button>
            ) : null}
          </div>
        ) : null}

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
      {props.perm ? (
        // Docked above the composer, outside the scrolling log (docs/frontend/chat.md "Card xin quyền").
        <div className="perm-dock">
          <PermissionCard
            perm={props.perm}
            busy={Boolean(props.permBusy)}
            error={Boolean(props.permError)}
            onAnswer={props.onAnswer ?? (() => undefined)}
            onDenyNote={props.onDenyNote}
            onAllow={props.onAllow}
            onDeny={props.onDeny}
          />
        </div>
      ) : null}
    </div>
  );
}
