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
import { useEffect, useMemo, useRef, useState } from "react";
import {
  countExplored,
  isPlanningVerb,
  narrateToPast,
  parseNarrateLegacy,
  type NarrateStep,
} from "../chatMeta";
import type { ChatLine, Diff, Perm } from "../models";
import { MODE_LABEL, type SessionMode } from "../modes";
import { ErrorCard } from "./ErrorCard";
import { SoftScroll } from "./SoftScroll";

const MODES = [
  { id: "Plan", title: "Plan", desc: "Lập kế hoạch trước khi sửa file", Icon: ListChecks },
  { id: "Code", title: "Code", desc: "Agent implement khi đã rõ hướng", Icon: Code2 },
  { id: "Review", title: "Review", desc: "Xem thay đổi và diff", Icon: GitCompare },
] as const;

const PROMPTS = [
  "Giải thích cấu trúc project này",
  "Lập plan thêm test cho phần cốt lõi",
  "Review các file vừa mở",
];

type Turn = {
  user: string;
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

/** Nhãn ô "Nhớ": mirror của `permissions::entry_for` (Engine mới là nơi quyết định phạm vi thật). */
function permRememberLabel(input: unknown): string {
  const raw = (input as { path?: unknown } | null | undefined)?.path;
  if (typeof raw !== "string") return "Nhớ cho mọi lần gọi tool này trong workspace";
  const p = raw.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
  const segs = p.split("/");
  if (!p || p.startsWith("/") || p.includes(":") || segs.some((s) => s === ".." || s === "")) {
    return "Nhớ cho mọi lần gọi tool này trong workspace";
  }
  return segs.length === 1 ? "Nhớ cho file ở thư mục gốc" : `Nhớ cho ${segs.slice(0, -1).join("/")}/**`;
}

function lineToStep(l: Extract<ChatLine, { kind: "narrate" }>): NarrateStep {
  if (l.verb) return { verb: l.verb, detail: l.detail };
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
      cur = { user: l.text, traces: [], narrations: [], errors: [], endLine: i };
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

  const out = turns.filter((t) => t.user || t.ai || t.traces.length || t.worked || t.narrations.length || t.thought || t.errors.length);
  for (const t of out) {
    if (t.ai && !t.ai.at && t.worked?.at) t.ai.at = t.worked.at;
  }
  if (busy && out.length > 0) {
    const last = out[out.length - 1];
    if (!last.worked) last.live = true;
  }
  return out;
}

function formatWorked(ms: number | undefined): string {
  if (ms == null) return "Worked for —";
  const sec = Math.max(1, Math.round(ms / 1000));
  if (sec < 60) return `Worked for ${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem ? `Worked for ${min}m ${rem}s` : `Worked for ${min}m`;
  const hr = Math.floor(min / 60);
  const m = min % 60;
  return m ? `Worked for ${hr}h ${m}m` : `Worked for ${hr}h`;
}

function activityNarrations(narrations: NarrateStep[]): NarrateStep[] {
  return narrations.filter(
    (s) => !isPlanningVerb(s.verb) && !/^Thinking$/i.test(s.verb) && !/^Thought$/i.test(s.verb),
  );
}

function exploreLabel(traces: ChatLine[], narrations: NarrateStep[]): { label: string; stub: boolean; show: boolean } {
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
  if (!hasActivity) return { label: "Explored —", stub: true, show: false };
  if (!files && !searches) return { label: "Explored —", stub: true, show: true };
  const parts: string[] = [];
  if (files) parts.push(`${files} file${files === 1 ? "" : "s"}`);
  if (searches) parts.push(`${searches} search${searches === 1 ? "" : "es"}`);
  return { label: `Explored ${parts.join(", ")}`, stub: false, show: true };
}

function thoughtLabel(turn: Turn): string {
  const thinkingLive = turn.live && turn.narrations.some((s) => /^Thinking$/i.test(s.verb));
  if (thinkingLive || (turn.live && Boolean(turn.thought?.body) && !turn.worked)) return "Thinking";
  if (turn.thought?.ms != null && turn.thought.ms > 0) {
    const sec = Math.max(1, Math.round(turn.thought.ms / 1000));
    return `Thought ${sec}s`;
  }
  if (turn.thought?.body) return "Thought briefly";
  return "";
}

function displaySteps(turn: Turn): { step: NarrateStep; active: boolean }[] {
  /* Live: Planning/Thinking; Done: bỏ placeholder; Thought hiển thị block riêng */
  const raw = turn.live
    ? turn.narrations.filter((s) => !/^Thought$/i.test(s.verb))
    : turn.narrations.filter((s) => !isPlanningVerb(s.verb) && !/^Thinking$/i.test(s.verb) && !/^Thought$/i.test(s.verb));
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

function formatAbsolute(at: number): string {
  try {
    return new Date(at).toLocaleString(undefined, {
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

function summaryLabel(turn: Turn): string {
  if (turn.live) return "Working…";
  return formatWorked(turn.worked?.ms);
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
        title="Copy Message"
        aria-label={copied ? "Copied" : "Copy Message"}
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
          title="Fork Chat"
          aria-label="Fork Chat"
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
  onRestoreCheckpoint?: (id: string) => void;
}) {
  const explored = exploreLabel(props.turn.traces, props.turn.narrations);
  const steps = displaySteps(props.turn);
  const active = steps.find((s) => s.active);
  const tLabel = thoughtLabel(props.turn);
  const thinkingLive = /^Thinking$/i.test(tLabel);
  const liveBrief = active
    ? [active.step.verb, active.step.detail].filter(Boolean).join(" ")
    : props.turn.narrations.some((s) => isPlanningVerb(s.verb))
      ? "Planning next moves"
      : thinkingLive
        ? "Thinking"
        : "Working…";
  const thoughtBody = props.turn.thought?.body?.trim() ?? "";
  const routes = props.turn.traces.filter((l) => l.kind === "route");
  const tools = props.turn.traces.filter((l) => l.kind === "tool" || l.kind === "sys");
  const hasBody =
    props.turn.live ||
    Boolean(tLabel) ||
    Boolean(thoughtBody) ||
    explored.show ||
    Boolean(props.turn.checkpoint) ||
    routes.length > 0 ||
    tools.length > 0;

  return (
    <details className={`msg-agent-meta${props.turn.live ? " live" : ""}`} open={props.turn.live || undefined}>
      <summary>
        <span>{summaryLabel(props.turn)}</span>
        <ChevronDown size={14} className="msg-agent-meta-chev" />
      </summary>
      {hasBody ? (
        <div className="msg-agent-meta-body">
          {props.turn.live && !tLabel ? <p className="msg-status-brief">{liveBrief}</p> : null}

          {tLabel ? (
            <details
              className={`msg-thought-block${thinkingLive ? " live" : ""}`}
              open={Boolean(thoughtBody) || thinkingLive || undefined}
            >
              <summary>
                <span className={`msg-thought-label${thinkingLive ? " active" : ""}`}>{tLabel}</span>
                {thoughtBody || thinkingLive ? (
                  <ChevronDown size={13} className="msg-agent-meta-chev" />
                ) : null}
              </summary>
              {thoughtBody ? <pre className="msg-thought-body">{thoughtBody}</pre> : null}
              {!thoughtBody && thinkingLive ? (
                <p className="msg-meta-line stub">Waiting for reasoning stream…</p>
              ) : null}
            </details>
          ) : null}

          {explored.show ? (
            <details className="msg-explored" open={props.turn.live && steps.length > 0 ? true : undefined}>
              <summary>
                <span className={explored.stub ? "stub" : undefined}>{explored.label}</span>
                {steps.length > 0 ? <ChevronDown size={13} className="msg-agent-meta-chev" /> : null}
              </summary>
              {steps.length > 0 ? (
                <ul className="msg-step-list">
                  {steps.map(({ step, active }, j) => (
                    <li key={j} className={`msg-step${active ? " active" : ""}`}>
                      <span className="msg-step-verb">{step.verb}</span>
                      {step.detail ? <span className="msg-step-detail">{step.detail}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </details>
          ) : null}

          {routes.map((l, j) =>
            l.kind === "route" ? (
              <div key={`route-${j}`} className="msg-meta-route">
                {l.text}
              </div>
            ) : null,
          )}

          {props.turn.checkpoint ? (
            <div className="msg-checkpoint">
              <span className="msg-checkpoint-label" title={formatAbsolute(props.turn.checkpoint.at)}>
                {props.turn.checkpoint.label}
                {props.turn.checkpoint.files.length
                  ? ` · ${props.turn.checkpoint.files.length} file${props.turn.checkpoint.files.length === 1 ? "" : "s"}`
                  : ""}
              </span>
              {props.onRestoreCheckpoint ? (
                <button
                  type="button"
                  className="msg-checkpoint-btn"
                  title="Khôi phục hội thoại và file về checkpoint này"
                  onClick={() => props.onRestoreCheckpoint?.(props.turn.checkpoint!.id)}
                >
                  <RotateCcw size={12} strokeWidth={1.75} />
                  Restore
                </button>
              ) : null}
            </div>
          ) : null}

          {tools.length > 0 ? (
            <details className="msg-agent-meta-trace">
              <summary>Tool details</summary>
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
  busy?: boolean;
  onApprovePlan: () => void;
  onRevisePlan?: () => void;
  /** Mode hiện tại của composer: thẻ gợi ý chỉ hiện khi vẫn đang ở mode chỉ đọc. */
  mode?: SessionMode;
  /** Bấm "Chuyển sang Agent": đổi mode và gửi lại đúng prompt của lượt đó. */
  onSwitchAndRun?: (mode: SessionMode, prompt: string) => void;
  permBusy?: boolean;
  permError?: boolean;
  onAllow: (remember: boolean) => void;
  onDeny: () => void;
  onApplyDiff: () => void;
  onRejectDiff: () => void;
  onRestoreCheckpoint?: (id: string) => void;
  onForkChat?: (endLineInclusive: number) => void;
  onOpenWorkspace?: () => void;
  onChip?: (chip: string) => void;
  onUsePrompt?: (text: string) => void;
  onRetry?: () => void;
}) {
  const steps = props.plan ? planSteps(props.plan) : [];
  const turns = useMemo(() => groupTurns(props.lines, Boolean(props.busy)), [props.lines, props.busy]);
  const logRef = useRef<HTMLDivElement>(null);
  const [copyToast, setCopyToast] = useState(false);
  // endLine của các gợi ý đổi mode đã bị "Giữ …" (chỉ ẩn trong phiên UI này).
  const [dismissedSuggest, setDismissedSuggest] = useState<Set<number>>(new Set());
  const [remember, setRemember] = useState(false);
  const permRequestId = props.perm?.request_id;
  // Remembering widens trust, so it is opt-in: unchecked for every new permission request.
  useEffect(() => {
    setRemember(false);
  }, [permRequestId]);
  const rememberLabel = permRememberLabel(props.perm?.input);
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
      {copyToast ? (
        <div className="app-toast" role="status" aria-live="polite">
          <Info size={14} strokeWidth={2} className="app-toast-ico" aria-hidden />
          <span>Message copied to clipboard</span>
        </div>
      ) : null}
      <SoftScroll viewportRef={logRef} deps={[props.lines, props.plan, turns.length, props.busy]}>
      <div className="log">
        {props.lines.length === 0 && !props.plan && (
          <div className="empty-hub">
            <div className="empty-ico">{props.hasSession ? <Sparkles size={20} /> : <FolderOpen size={20} />}</div>
            {props.hasSession ? (
              <>
                <h3>Bạn muốn bắt đầu thế nào?</h3>
                <p>
                  Workspace <b>{props.wsName || "hiện tại"}</b> đã sẵn sàng. Chọn chế độ hoặc dùng gợi ý bên dưới.
                </p>
              </>
            ) : (
              <>
                <h3>Bắt đầu với workspace</h3>
                <p>Mở folder dự án để chat với agent. Plan trước khi sửa file.</p>
                {props.onOpenWorkspace && (
                  <button type="button" className="run-btn" onClick={props.onOpenWorkspace}>
                    Mở workspace
                  </button>
                )}
              </>
            )}

            <div className="hub-section">
              <span className="hub-label">Chế độ</span>
              <div className="hub-modes">
                {MODES.map(({ id, title, desc, Icon }) => (
                  <button key={id} type="button" className="hub-mode" onClick={() => onMode(id)}>
                    <Icon size={16} />
                    <strong>{title}</strong>
                    <span>{desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {props.hasSession && (
              <div className="hub-section">
                <span className="hub-label">Gợi ý</span>
                <div className="hub-prompts">
                  {PROMPTS.map((text) => (
                    <button key={text} type="button" className="hub-prompt" onClick={() => props.onUsePrompt?.(text)}>
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {turns.map((t, i) => {
          const showMeta = Boolean(
            t.worked || t.ai || t.traces.length || t.narrations.length || t.thought || t.live || t.checkpoint,
          );
          return (
            <div key={i} className="msg-turn">
              {t.user ? (
                <div className="msg-user">
                  <div className="msg-bubble">{t.user}</div>
                </div>
              ) : null}
              {showMeta ? (
                <AgentMeta turn={t} onRestoreCheckpoint={props.onRestoreCheckpoint} />
              ) : null}
              {t.ai ? (
                <div className="msg-ai-wrap">
                  <div className="msg-ai">{t.ai.text}</div>
                  <AiFooter
                    text={t.ai.text}
                    canFork={Boolean(props.onForkChat) && !t.live}
                    forkDisabled={Boolean(props.busy)}
                    onFork={() => props.onForkChat?.(t.endLine)}
                    onCopied={showCopyToast}
                  />
                </div>
              ) : null}
              {t.suggest &&
              props.onSwitchAndRun &&
              i === turns.length - 1 &&
              !props.busy &&
              props.mode !== t.suggest.mode &&
              !dismissedSuggest.has(t.endLine) ? (
                <div className="mode-suggest" role="group" aria-label="Gợi ý chuyển mode">
                  <p>{t.suggest.reason || `Chuyển sang ${MODE_LABEL[t.suggest.mode]} để áp dụng thay đổi này?`}</p>
                  <div className="row">
                    <button
                      type="button"
                      className="primary"
                      onClick={() => props.onSwitchAndRun?.(t.suggest!.mode, t.suggest!.prompt)}
                    >
                      Chuyển sang {MODE_LABEL[t.suggest.mode]} và thực hiện
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setDismissedSuggest((s) => new Set(s).add(t.endLine))}
                    >
                      Giữ {props.mode ? MODE_LABEL[props.mode] : "mode hiện tại"}
                    </button>
                  </div>
                </div>
              ) : null}
              {t.errors.map((e, j) => (
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
              <b>Execution Plan</b>
              <span>chờ duyệt</span>
            </div>
            <div className="progress">
              <i style={{ width: "8%" }} />
            </div>
            <ol>
              {(steps.length ? steps : ["Xem plan markdown bên dưới"]).map((s, i) => (
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
                <CheckCircle2 size={14} /> Duyệt plan
              </button>
              {props.onRevisePlan ? (
                <button type="button" className="ghost" onClick={props.onRevisePlan}>
                  Góp ý / sửa
                </button>
              ) : null}
            </div>
          </div>
        )}

        {props.perm && (
          <div className="banner warn">
            <h4>Cho phép {props.perm.name}?</h4>
            <pre>{JSON.stringify(props.perm.input, null, 2)}</pre>
            <label className="perm-remember">
              <input
                type="checkbox"
                checked={remember}
                disabled={props.permBusy}
                onChange={(e) => setRemember(e.target.checked)}
              />
              {rememberLabel}
            </label>
            {props.permError && (
              <p className="perm-error" role="alert">
                <strong>Không gửi được quyết định quyền.</strong> Cho phép hoặc Từ chối lại; nếu vẫn
                lỗi, mở lại workspace.
              </p>
            )}
            <div className="row">
              <button
                type="button"
                className="primary"
                disabled={props.permBusy}
                onClick={() => props.onAllow(remember)}
              >
                Cho phép
              </button>
              <button type="button" className="ghost" disabled={props.permBusy} onClick={props.onDeny}>
                Từ chối
              </button>
            </div>
          </div>
        )}

        {props.diff && (
          <div className="banner">
            <h4>Diff {props.diff.path}</h4>
            <div className="row">
              <button type="button" className="primary" onClick={props.onApplyDiff}>
                Apply
              </button>
              <button type="button" className="ghost" onClick={props.onRejectDiff}>
                Reject
              </button>
            </div>
          </div>
        )}
      </div>
      </SoftScroll>
    </div>
  );
}
