import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { History } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import mountains from "./assets/wallpapers/mountains.png";
import { BottomPanel, type PanelTab } from "./components/BottomPanel";
import {
  ChatHistoryPanel,
  HISTORY_KEY,
  firstExchange,
  loadThreads,
  previewFrom,
  shownTitle,
  titleFrom,
  titleLocked,
} from "./components/ChatHistoryPanel";
import { ChatPane } from "./components/ChatPane";
import { ChatTabBar } from "./components/ChatTabBar";
import { ConfirmDialog, type ConfirmRequest } from "./components/ConfirmDialog";
import { Composer } from "./components/Composer";
import { ImageLightbox, type LightboxState } from "./components/ImageLightbox";
import { TooltipLayer } from "./components/TooltipLayer";
import { UndoToast } from "./components/UndoToast";
import { isImagePath, readWorkspaceImage } from "./workspaceImages";
import { routeText, type SessionMode } from "./modes";
import { LangContext, translator } from "./i18n";
import {
  addSpend,
  autoFor,
  autoModelLabel,
  engineConfig,
  EMPTY_SPEND,
  fmtUsd,
  isSideRoute,
  loadAuto,
  loadSpend,
  saveAuto,
  saveSpend,
  type AutoConfig,
  type SlotSpend,
} from "./autoConfig";
import { imagesFromFiles, supportsImages, threadsForStorage } from "./pastedImages";
import { hydrateImages, needsHydrate, pruneImages, putImages, referencedImageIds } from "./imageStore";
import { DiffPane } from "./components/DiffPane";
import { addCost, markStopping, startRun, type RunMeter } from "./runStatus";
import { autonomousFallbackNote, blockedStep, loadPermMode, savePermMode, type PermScope, type UiPermMode } from "./permissionUi";
import { SettingsDialog } from "./components/settings/SettingsDialog";
import { loadSettingsSection, type SettingsSection } from "./settingsIndex";
import { EvalsPage } from "./components/EvalsPage";
import { liveProgress, useEvalLive } from "./evalLive";
import {
  loadDefaultSource,
  loadPick,
  modelForSource,
  modelSources,
  normalizeEffort,
  resolveSource,
  savePick,
  type Effort,
} from "./effort";
import { TitleBar } from "./components/TitleBar";
import {
  briefFromNarrations,
  filesToRestore,
  briefFromThinkingBody,
  isPlanningVerb,
  narrateFromLine,
  narrateToPast,
  narrateToolLive,
  newCheckpointId,
  parseNarrateLegacy,
  planningStep,
  thinkingLiveStep,
  type NarrateStep,
} from "./chatMeta";
import { attachToPrompt, cutParams, rewindImages, rewindPrompt, userTurnsBefore } from "./messageMenu";
import { applyProc, isLocalUrl, type ProcRow } from "./procs";
import { applyBrowser, type BrowserView } from "./browserView";
import type { ChatLine, ChatThread, CheckpointFile, Diff, Perm, ShellView } from "./models";
import {
  applyAppearance,
  loadAppearance,
  saveAppearance,
  type Appearance,
} from "./theme/appearance";
import { loadModelPrefs, lockedModels, saveModelPrefs, visibleModels } from "./theme/modelsPrefs";
import type { CliInfo, ContextUsage, ModelInfo, SandboxStatus, SessionEvent } from "./types";
import { loadPrefs, savePrefs, type Prefs } from "./prefs";
import { pinnedSessionIds, pruneThreads } from "./retention";

/** xterm colours from the theme tokens, so the light theme gets a light terminal. */
function terminalTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: v("--workspace", "#191a1c"),
    foreground: v("--text-primary", "#f0efec"),
    cursor: v("--accent", "#e5a05b"),
    selectionBackground: v("--surface-hover", "#303134"),
  };
}

function loadShellView(): ShellView {
  const v = localStorage.getItem("silence.shell.view");
  return v === "hidden" || v === "explorer" ? "hidden" : "chat";
}

function loadOpenTabs(): string[] {
  if (!loadPrefs().restoreSession) return [];
  try {
    const raw = localStorage.getItem("silence.shell.openTabs");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function appendTurnMeta(
  lines: ChatLine[],
  startMs: number,
  turnFiles: CheckpointFile[],
): ChatLine[] {
  const at = Date.now();
  const ms = startMs > 0 ? Math.max(0, at - startMs) : 0;
  /* Luôn ghi worked khi finalize — tránh Worked for — */
  const worked: ChatLine = { kind: "worked", ms: Math.max(ms, 1), at };

  const turnSlice = lines.slice(
    (() => {
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].kind === "user") return i + 1;
      }
      return 0;
    })(),
  );
  const narrations: NarrateStep[] = turnSlice
    .filter((l): l is Extract<ChatLine, { kind: "narrate" }> => l.kind === "narrate")
    .map((l) => (l.verb ? { verb: l.verb, detail: l.detail } : parseNarrateLegacy(l.text ?? "")))
    .filter((s) => !isPlanningVerb(s.verb) && !/^Thinking$/i.test(s.verb) && !/^Thought$/i.test(s.verb));
  const pastNarrations = narrations.map(narrateToPast);
  const existingThought = [...turnSlice]
    .reverse()
    .find((l): l is Extract<ChatLine, { kind: "thought" }> => l.kind === "thought");
  const body = existingThought?.body?.trim() ?? "";
  const thoughtMs = existingThought?.ms;
  const brief =
    (body ? briefFromThinkingBody(body) : "") ||
    (existingThought?.brief &&
    existingThought.brief.trim() &&
    !/^Thought$/i.test(existingThought.brief.trim())
      ? existingThought.brief.trim()
      : "") ||
    briefFromNarrations(pastNarrations);
  const hasThought = Boolean(body) || (thoughtMs != null && thoughtMs >= 400);
  const thoughtLine: ChatLine | null = hasThought
    ? {
        kind: "thought",
        brief: brief || (thoughtMs != null ? `Thought ${Math.max(1, Math.round(thoughtMs / 1000))}s` : "Thought briefly"),
        body: body || undefined,
        ms: thoughtMs,
      }
    : null;

  const checkpoint: ChatLine = {
    kind: "checkpoint",
    id: newCheckpointId(),
    at,
    label: "Checkpoint",
    files: turnFiles.map((f) => ({ ...f })),
  };

  let userIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].kind === "user") {
      userIdx = i;
      break;
    }
  }
  /* Past hóa bước thật; drop Planning/Thinking/Thought narrate; Thought chỉ qua thoughtLine */
  const normalized = lines.flatMap((l, i): ChatLine[] => {
    if (userIdx >= 0 && i <= userIdx) return [l];
    if (l.kind === "thought" || l.kind === "worked" || l.kind === "checkpoint") return [];
    if (l.kind !== "narrate") return [l];
    const step = l.verb ? narrateFromLine(l) : parseNarrateLegacy(l.text ?? "");
    if (isPlanningVerb(step.verb) || /^Thinking$/i.test(step.verb) || /^Thought$/i.test(step.verb)) return [];
    return [{ kind: "narrate", ...narrateToPast(step) }];
  });
  const meta: ChatLine[] = thoughtLine ? [worked, thoughtLine, checkpoint] : [worked, checkpoint];
  if (userIdx < 0) return [...normalized, ...meta];
  return [...normalized.slice(0, userIdx + 1), ...meta, ...normalized.slice(userIdx + 1)];
}

function upsertThinkingNarrate(lines: ChatLine[]): ChatLine[] {
  const next = [...lines];
  const last = next[next.length - 1];
  const live = thinkingLiveStep();
  if (last?.kind === "narrate" && (isPlanningVerb(last.verb) || /^Thinking$/i.test(last.verb ?? ""))) {
    next[next.length - 1] = { kind: "narrate", verb: live.verb, detail: live.detail };
    return next;
  }
  if (last?.kind === "narrate" && /^Thought$/i.test(last.verb ?? "")) {
    return next;
  }
  next.push({ kind: "narrate", verb: live.verb, detail: live.detail });
  return next;
}

function appendThinkingText(lines: ChatLine[], text: string, startedAt: number): ChatLine[] {
  const next = upsertThinkingNarrate(lines);
  const ms = Math.max(0, Date.now() - startedAt);
  for (let i = next.length - 1; i >= 0; i--) {
    const l = next[i];
    if (l.kind === "thought") {
      next[i] = {
        kind: "thought",
        brief: briefFromThinkingBody((l.body ?? "") + text) || l.brief,
        body: (l.body ?? "") + text,
        ms,
      };
      return next;
    }
    if (l.kind === "user") break;
  }
  next.push({
    kind: "thought",
    brief: briefFromThinkingBody(text) || "Thinking",
    body: text,
    ms,
  });
  return next;
}

function sealThoughtMs(lines: ChatLine[], startedAt: number): ChatLine[] {
  if (!startedAt) return lines;
  const ms = Math.max(0, Date.now() - startedAt);
  const next = [...lines];
  for (let i = next.length - 1; i >= 0; i--) {
    const l = next[i];
    if (l.kind === "thought") {
      next[i] = { ...l, ms: l.ms && l.ms > ms ? l.ms : ms };
      return next;
    }
    if (l.kind === "user") break;
  }
  if (ms >= 400) {
    next.push({ kind: "thought", brief: "Thought", ms });
  }
  return next;
}

export function App() {
  const [appearance, setAppearance] = useState<Appearance>(() => loadAppearance());
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());
  /** Latest prefs for the Engine event listener (registered once). */
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  /** Latest UI language for `session.prompt` (the send path can outlive a render). */
  const langRef = useRef(appearance.lang);
  langRef.current = appearance.lang;
  /** UI strings in the chosen language (App sits above `LangContext`, so no `useT` here). */
  const t = translator(appearance.lang);
  const [shellView, setShellView] = useState<ShellView>(() => loadShellView());
  /** Settings dialog: open on `section`; `n` changes on every request so it can re-target. */
  const [settings, setSettings] = useState<{ section: SettingsSection; n: number } | null>(null);
  async function refreshSandbox() {
    if (!window.silence) return;
    try {
      setSandbox((await window.silence.rpc("sandbox.status", { refresh: true })) as SandboxStatus);
    } catch {
      // Engine cũ (protocol < 0.1.15) chưa có RPC này: coi như chưa biết, Tự chủ không chọn được.
      setSandbox(null);
    }
  }
  /** Cài / sửa sandbox: Windows hiện một hộp UAC; RPC trả về khi xong hoặc khi bị từ chối. */
  async function setupSandbox() {
    setSandbox((await window.silence.rpc("sandbox.setup", {})) as SandboxStatus);
  }
  const openSettings = (section: SettingsSection = loadSettingsSection()) => setSettings({ section, n: Date.now() });
  /** Evals full page (TitleBar button, View → Evals, Ctrl+Shift+E, Settings → Giới thiệu). Dev only:
   *  shown when the Engine sees an `evals/` folder. */
  const [showEvals, setShowEvals] = useState(false);
  const [evalsAvailable, setEvalsAvailable] = useState(false);
  // Run state lives here, not in the page: closing the page or reloading keeps the progress.
  const evals = useEvalLive((live) => {
    const np = prefsRef.current;
    if (!np.notifyDone && !np.flashTaskbar) return;
    const c = live.summary?.counts;
    const result = c
      ? t("evals.total", { pass: c.pass, fail: c.fail, error: c.error, skip: c.skip, usd: fmtUsd(live.summary!.total_cost_usd) })
      : t("evals.failed", { message: live.failed ?? "" });
    void window.silence
      .notifyDone?.(t("evals.notifyTitle", { suite: live.suite, result }), { notify: np.notifyDone, flash: np.flashTaskbar })
      .catch(() => undefined);
  });
  const openEvals = () => {
    setShowEvals(true);
    setShellView("chat");
  };
  const toggleEvals = () => (showEvals && shellView === "chat" ? setShowEvals(false) : openEvals());
  /** Model row to scroll to + highlight when Settings → Models opens from the picker's Enable. */
  const [focusModel, setFocusModel] = useState<{ id: string; n: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem("silence.shell.panel") === "1");
  const [panelTab, setPanelTab] = useState<PanelTab>("terminal");
  const [outputLog, setOutputLog] = useState<string[]>([]);
  /** Background processes of the open chat's session (Ports tab). */
  const [procs, setProcs] = useState<ProcRow[]>([]);
  /** What the agent's headless browser shows (Browser tab); null = none open. */
  const [browserView, setBrowserView] = useState<BrowserView | null>(null);
  const [historyHidden, setHistoryHidden] = useState(() => localStorage.getItem("silence.shell.history") === "1");

  const [workspace, setWorkspace] = useState(() => localStorage.getItem("silence.shell.workspace") ?? "");
  const [sessionId, setSessionId] = useState("");
  const [model, setModel] = useState(() => loadPick().model);
  const [effort, setEffort] = useState<Effort>(() => loadPick().effort);
  /** Model source the picker shows (provider id); also the provider Auto prefers. */
  // Starts on the default from Settings → Model sources (the Claude CLI when unset); the
  // composer's Source row switches for this run only.
  const [source, setSource] = useState(() => loadDefaultSource());
  const [models, setModels] = useState<ModelInfo[]>([]);
  /** Auto settings per source (`silence.auto.v1`), pushed to the Engine with `auto.set_config`. */
  const [autoCfgs, setAutoCfgs] = useState<Record<string, AutoConfig>>(() => loadAuto());
  /** Model Auto used last in a main turn ("Sonnet"), shown on the picker as "Auto · Sonnet". */
  const [autoModel, setAutoModel] = useState("");
  /** Spend per chat thread split by Auto slot (`cost` events); survives Engine restarts. */
  const [spendByThread, setSpendByThread] = useState<Record<string, SlotSpend>>(() => loadSpend());
  const activeThreadRef = useRef("");
  /** The turn stopped at the Auto spend cap (`done` with stop `budget`). */
  const [budgetHit, setBudgetHit] = useState(false);
  /** Settings → Models → Auto tab (`NetworkPanel.focusAuto`). */
  const [focusAuto, setFocusAuto] = useState(0);
  /** Picker → Add models → Settings → Model → Models tab with the add form open. */
  const [focusAdd, setFocusAdd] = useState(0);
  /** Picker → Source → Set up → Settings → Model → Sources tab. */
  const [focusSources, setFocusSources] = useState(0);
  // The Evals entry only shows when the Engine finds `evals/` (dev checkout).
  useEffect(() => {
    void window.silence
      ?.rpc("eval.catalog")
      .then((r) => setEvalsAvailable(Boolean((r as { available?: boolean }).available)))
      .catch(() => setEvalsAvailable(false));
  }, []);
  const modelsRef = useRef<ModelInfo[]>([]);
  const [modelPrefs, setModelPrefs] = useState(() => loadModelPrefs());
  const [mode, setMode] = useState<SessionMode>("agent");
  const [tree, setTree] = useState<string[]>([]);
  const [file, setFile] = useState<string | null>(null);
  const [fileText, setFileText] = useState("");
  const [prompt, setPrompt] = useState("");
  /** Ảnh dán vào composer (data URL), gửi kèm `session.prompt`. */
  const [images, setImages] = useState<string[]>([]);
  /** Ảnh workspace mở từ chip / menu Files / panel Review. */
  const [lightbox, setLightbox] = useState<LightboxState>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  /** Setter gốc — handler sự kiện Engine che `setLines` bằng bản định tuyến theo session. */
  const setLinesState = setLines;
  const [diff, setDiff] = useState<Diff | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [perm, setPerm] = useState<Perm | null>(null);
  const [permBusy, setPermBusy] = useState(false);
  const [permError, setPermError] = useState(false);
  const [cost, setCost] = useState({ usd: 0, input_tokens: 0, output_tokens: 0, events: 0 });
  const [busy, setBusy] = useState(false);
  /** Chế độ quyền (Settings): Cân bằng mặc định hoặc Thận trọng. Gửi lên Engine mỗi lượt. */
  const [permMode, setPermMode] = useState<UiPermMode>(() => loadPermMode());
  /** Sandbox lệnh (`sandbox.status`, Engine cache 30 s). `null` = chưa biết / Engine cũ. */
  const [sandbox, setSandbox] = useState<SandboxStatus | null>(null);
  /** Run pulse của lượt đang chạy: giờ bắt đầu, token/USD cộng từ `cost`, cờ Stop (`docs/frontend/status.md`). */
  const [run, setRun] = useState<RunMeter | null>(null);
  const termRef = useRef<HTMLDivElement | null>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  /** Đổi session đang xem và cập nhật ref ngay — sự kiện tới trước lần render kế tiếp không rơi nhầm thread. */
  const switchSession = (id: string) => {
    sessionIdRef.current = id;
    setSessionId(id);
  };
  /** Session sở hữu lượt đang chạy (một lượt mỗi lúc). Đổi tab giữa lượt: sự kiện vẫn ghi vào thread của nó. */
  const runSessionRef = useRef("");
  const [runSessionId, setRunSessionId] = useState("");
  const markRun = (id: string) => {
    runSessionRef.current = id;
    setRunSessionId(id);
  };
  /** Plan nộp lúc thread không mở (hoặc đang mở rồi rời đi): giữ theo session, hiện lại khi mở thread. */
  const pendingPlanRef = useRef(new Map<string, string>());
  const turnStartedAtRef = useRef(0);
  const turnFilesRef = useRef<CheckpointFile[]>([]);
  const thoughtStartedAtRef = useRef(0);
  const lastPromptRef = useRef("");
  /** Thread đã gửi `chat.title` trong phiên này — chống gọi trùng / gọi lại sau lỗi. */
  const titleRequestedRef = useRef(new Set<string>());
  /** Mode của lượt đang chạy (để ghi nhãn mode vào dòng route). */
  const turnModeRef = useRef<SessionMode>("agent");
  const [termEl, setTermEl] = useState<HTMLDivElement | null>(null);
  const [showChangesSignal, setShowChangesSignal] = useState(0);
  /** Panel Changes/file chỉ mở khi user chủ động (bấm card diff, chip file…), không tự bật khi có diff. */
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewSub, setReviewSub] = useState<"changes" | "tests" | "logs" | "preview">("changes");
  const [threads, setThreads] = useState<ChatThread[]>(() => loadThreads());
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  /** Sửa `lines` của thread có session `sid`: thread đang mở → state `lines`; thread nền → bản lưu trong `threads`. */
  const linesFor = (sid: string, fn: (xs: ChatLine[]) => ChatLine[]) => {
    if (!sid || sid === sessionIdRef.current) setLines(fn);
    else setThreads((xs) => xs.map((x) => (x.sessionId === sid ? { ...x, lines: fn(x.lines), updatedAt: Date.now() } : x)));
  };
  // Id ảnh không còn trong IndexedDB: không hỏi lại mỗi lần `lines` đổi (stream token).
  const missedImagesRef = useRef(new Set<string>());
  const [openTabIds, setOpenTabIds] = useState<string[]>(() => loadOpenTabs());
  /** Chat vừa xoá, còn hoàn tác được (toast). `index`/`tabIndex` = chỗ cũ trong danh sách / dải tab (-1 = không mở). */
  const [undoDel, setUndoDel] = useState<{ thread: ChatThread; index: number; tabIndex: number; wasActive: boolean } | null>(
    null,
  );
  /** Hộp xác nhận chung (thay window.confirm): `askConfirm` trả Promise<boolean>. */
  const [confirmReq, setConfirmReq] = useState<(ConfirmRequest & { resolve: (ok: boolean) => void }) | null>(null);
  function askConfirm(req: ConfirmRequest): Promise<boolean> {
    return new Promise((resolve) => setConfirmReq({ ...req, resolve }));
  }
  const answerConfirm = (ok: boolean) => {
    setConfirmReq((c) => {
      c?.resolve(ok);
      return null;
    });
  };
  /** Hoàn tác chat đang mở: chờ `threads` có lại thread rồi mới mở nó. */
  const reopenRef = useRef("");
  const [activeThreadId, setActiveThreadId] = useState("");
  activeThreadRef.current = activeThreadId;
  /** Title of the open chat, for the "agent finished" notice. */
  const threadTitleRef = useRef("");
  threadTitleRef.current = threads.find((x) => x.id === activeThreadId)?.title ?? "";
  const spend = spendByThread[activeThreadId] ?? EMPTY_SPEND;
  /** Context của session hiện tại (`session.context`) — khác `cost` (tổng chi phí mọi session). */
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);

  // Trạng thái sandbox: lúc mở app, khi đổi chế độ quyền và khi đóng Settings (có thể vừa cài xong).
  useEffect(() => {
    void refreshSandbox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permMode, settings === null]);
  // Ports tab: the processes of this session (they outlive turns; events only carry changes).
  useEffect(() => {
    // The browser belongs to the session: another chat shows nothing until its agent opens a page.
    setBrowserView(null);
    if (!sessionId || !window.silence) {
      setProcs([]);
      return;
    }
    let stale = false;
    window.silence
      .rpc("proc.list", { session_id: sessionId })
      .then((r) => {
        if (!stale) setProcs(((r as { procs?: ProcRow[] }).procs ?? []).slice());
      })
      // Engine cũ (protocol < 0.1.17) chưa có proc.list.
      .catch(() => {
        if (!stale) setProcs([]);
      });
    return () => {
      stale = true;
    };
  }, [sessionId]);

  // Làm mới khi đổi session / mode / model và khi lượt kết thúc (busy → false).
  useEffect(() => {
    if (!sessionId || busy || !window.silence) {
      if (!sessionId) setContextUsage(null);
      return;
    }
    let stale = false;
    window.silence
      .rpc("session.context", { session_id: sessionId, mode, model })
      .then((r) => {
        if (!stale) setContextUsage(r as ContextUsage);
      })
      .catch(() => {
        // Engine restart → session cũ không còn; session mới được tạo ở lượt gửi kế tiếp.
        if (!stale) setContextUsage(null);
      });
    return () => {
      stale = true;
    };
  }, [sessionId, busy, mode, model]);

  useEffect(() => {
    applyAppearance(appearance);
    saveAppearance(appearance);
    if (appearance.theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyAppearance(appearance);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [appearance]);

  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  // Settings → Dữ liệu → Giữ lịch sử chat: dọn một lần khi mở Studio (chat đã ghim luôn giữ).
  useEffect(() => {
    const days = prefs.retentionDays;
    if (!days) return;
    const { removed } = pruneThreads(threads, days, Date.now());
    if (removed.length) {
      const gone = new Set(removed.map((t) => t.id));
      setThreads((xs) => xs.filter((t) => !gone.has(t.id)));
      setOpenTabIds((ids) => ids.filter((id) => !gone.has(id)));
    }
    void window.silence
      ?.rpc("session.prune", { older_than_days: days, keep: pinnedSessionIds(threads) })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once at startup
  }, []);

  useEffect(() => {
    localStorage.setItem("silence.shell.panel", panelOpen ? "1" : "0");
  }, [panelOpen]);

  useEffect(() => {
    localStorage.setItem("silence.shell.history", historyHidden ? "1" : "0");
  }, [historyHidden]);

  useEffect(() => {
    localStorage.setItem("silence.shell.view", shellView);
  }, [shellView]);

  useEffect(() => {
    localStorage.setItem("silence.shell.openTabs", JSON.stringify(openTabIds));
  }, [openTabIds]);

  useEffect(() => {
    if (workspace) localStorage.setItem("silence.shell.workspace", workspace);
  }, [workspace]);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(threadsForStorage(threads)));
    } catch {
      // Hết quota localStorage: giữ bản đã lưu trước đó thay vì làm sập app.
    }
  }, [threads]);

  // Dọn ảnh IndexedDB của thread đã xoá — một lần lúc mở app.
  useEffect(() => {
    void pruneImages(referencedImageIds(threads));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Thread mở lại từ lịch sử chỉ có `imageIds`: lấy ảnh từ IndexedDB rồi điền vào.
  useEffect(() => {
    if (!lines.some((l) => needsHydrate(l, missedImagesRef.current))) return;
    let alive = true;
    void hydrateImages(lines, missedImagesRef.current).then((next) => {
      if (alive && next !== lines) setLines((cur) => (cur === lines ? next : cur));
    });
    return () => {
      alive = false;
    };
  }, [lines]);

  useEffect(() => {
    const known = new Set(threads.map((t) => t.id));
    setOpenTabIds((prev) => {
      const next = prev.filter((id) => known.has(id));
      if (next.length === prev.length && next.every((id, i) => id === prev[i])) return prev;
      return next;
    });
  }, [threads]);

  useEffect(() => {
    if (!activeThreadId) return;
    setThreads((xs) =>
      xs.map((t) =>
        t.id === activeThreadId
          ? {
              ...t,
              sessionId,
              lines,
              title: titleLocked(t) ? t.title : titleFrom(lines, t.title),
              preview: previewFrom(lines),
              // Chỉ bump khi nội dung đổi; bấm chuyển chat không được reset bộ đếm giờ.
              updatedAt: t.lines === lines && t.sessionId === sessionId ? t.updatedAt : Date.now(),
            }
          : t,
      ),
    );
  }, [lines, sessionId, activeThreadId]);

  // Tiêu đề AI (như ChatGPT/Claude): một lần, sau khi lượt đầu có câu trả lời. Lỗi thì giữ tiêu đề tạm.
  useEffect(() => {
    if (busy || !activeThreadId || !prefs.autoTitle) return;
    const t = threads.find((x) => x.id === activeThreadId);
    if (!t || t.titleSource === "ai" || t.titleSource === "user") return;
    if (titleRequestedRef.current.has(t.id)) return;
    const ex = firstExchange(lines);
    if (!ex) return;
    titleRequestedRef.current.add(t.id);
    void requestTitle(t.id, sessionId, ex.user, ex.reply);
  }, [busy, activeThreadId, lines, threads, sessionId, prefs.autoTitle]);

  useEffect(() => {
    if (activeThreadId) return;
    const t = openTabIds
      .map((id) => threads.find((x) => x.id === id))
      .find((x) => x && (!workspace || x.workspace === workspace));
    if (!t) return;
    setActiveThreadId(t.id);
    switchSession(t.sessionId);
    setLines(t.lines);
  }, [activeThreadId, openTabIds, threads, workspace]);

  useEffect(() => {
    if (!window.silence) {
      setLines([{ kind: "sys", text: t("app.noPreload") }]);
      return;
    }
    return window.silence.onEvent((payload) => {
      const p = payload as { session_id?: string; event?: SessionEvent };
      const ev = p.event;
      if (!ev) return;
      // Lỗi cấp Engine/Sidecar không có session_id: gán cho lượt đang chạy, không phải tab nào đang mở.
      const sid = p.session_id || runSessionRef.current || "";
      // `here`: thread đang mở. `bg`: lượt đang chạy ở thread user vừa rời đi — vẫn ghi vào thread đó.
      const here = !sid || sid === sessionIdRef.current;
      const bg = !here && sid === runSessionRef.current;
      if (!here && !bg) return;
      const bgThread = bg ? threadsRef.current.find((x) => x.sessionId === sid) : undefined;
      const setLines = (fn: (xs: ChatLine[]) => ChatLine[]) => {
        if (here) setLinesState(fn);
        else
          setThreads((xs) =>
            xs.map((x) => (x.sessionId === sid ? { ...x, lines: fn(x.lines), updatedAt: Date.now() } : x)),
          );
      };
      /** Thread chạy nền có việc cho user (xong, lỗi, chờ duyệt): chấm unread trên lịch sử. */
      const flagBg = () => {
        if (bgThread) setThreads((xs) => xs.map((x) => (x.id === bgThread.id ? { ...x, unread: true } : x)));
      };
      if (ev.type === "token") {
        setLines((xs) => {
          let base = xs;
          if (thoughtStartedAtRef.current) {
            base = sealThoughtMs(xs, thoughtStartedAtRef.current);
            thoughtStartedAtRef.current = 0;
          }
          const last = base[base.length - 1];
          if (last?.kind === "token") return [...base.slice(0, -1), { kind: "token", text: last.text + ev.text }];
          return [...base, { kind: "token", text: ev.text }];
        });
      } else if (ev.type === "thinking") {
        if (!thoughtStartedAtRef.current) thoughtStartedAtRef.current = Date.now();
        const started = thoughtStartedAtRef.current;
        setLines((xs) => appendThinkingText(xs, ev.text, started));
      } else if (ev.type === "tool_start") {
        const step = narrateToolLive(ev.name, ev.input);
        setLines((xs) => {
          let next = xs;
          if (thoughtStartedAtRef.current) {
            next = sealThoughtMs(xs, thoughtStartedAtRef.current);
            thoughtStartedAtRef.current = 0;
          } else {
            next = [...xs];
          }
          const last = next[next.length - 1];
          if (
            last?.kind === "narrate" &&
            (isPlanningVerb(last.verb ?? last.text) || /^Thinking$/i.test(last.verb ?? ""))
          ) {
            next[next.length - 1] = { kind: "narrate", ...step };
            return next;
          }
          if (last?.kind === "narrate") {
            const prev = last.verb ? narrateFromLine(last) : parseNarrateLegacy(last.text ?? "");
            if (
              !isPlanningVerb(prev.verb) &&
              !/^Thought$/i.test(prev.verb) &&
              !/^Thinking$/i.test(prev.verb)
            ) {
              next[next.length - 1] = { kind: "narrate", ...narrateToPast(prev) };
            }
          }
          next.push({ kind: "narrate", ...step });
          return next;
        });
      } else if (ev.type === "tool_end") {
        setLines((xs) => [...xs, { kind: "tool", name: ev.name, output: ev.output }]);
      } else if (ev.type === "route") {
        const auto = Boolean(ev.slot);
        const label = auto ? autoModelLabel(ev.model_id, modelsRef.current) : ev.model_id;
        if (here && auto && !isSideRoute(ev.task_class)) setAutoModel(label);
        setLines((xs) => [
          ...xs,
          {
            kind: "route",
            text: routeText(turnModeRef.current, ev.task_class, ev.model_id),
            model: label,
            slot: ev.slot || undefined,
            escalated: ev.escalated || undefined,
            reason: ev.reason,
            purpose: ev.task_class,
          },
        ]);
      } else if (ev.type === "mode_suggestion") {
        const prompt = lastPromptRef.current;
        setLines((xs) => [...xs, { kind: "mode_suggest", mode: ev.mode, reason: ev.reason, prompt }]);
      } else if (ev.type === "plan") {
        if (here) setPlan(ev.markdown);
        else {
          pendingPlanRef.current.set(sid, ev.markdown);
          flagBg();
        }
      } else if (ev.type === "diff") {
        const fileDiff = { path: ev.path, before: ev.before, after: ev.after, applied: ev.applied === true };
        const prev = turnFilesRef.current.filter((f) => f.path !== ev.path);
        turnFilesRef.current = [...prev, fileDiff];
        // Thread nền: file vẫn vào checkpoint của lượt (turnFilesRef); không bật diff lên thread đang xem.
        if (here) setDiff(fileDiff);
      } else if (ev.type === "permission") {
        setPermError(false);
        setPerm({
          session_id: sid || sessionIdRef.current,
          request_id: ev.request_id,
          name: ev.name,
          input: ev.input,
          reason: ev.reason,
          risk: ev.risk,
        });
        flagBg();
        // Cửa sổ không ở phía trước thì báo ra desktop. Chỉ gửi lý do (không gửi lệnh).
        const np = prefsRef.current;
        if (np.notifyPermission || np.flashTaskbar) {
          void window.silence
            .notifyPermission?.(ev.risk?.reasons[0]?.title ?? ev.reason, { notify: np.notifyPermission, flash: np.flashTaskbar })
            .catch(() => undefined);
        }
      } else if (ev.type === "trace" && ev.event === "sandbox.run") {
        // Lệnh shell vừa bắt đầu chạy trong sandbox (Tự chủ): gắn badge lên bước đang chạy.
        setLines((xs) => {
          const i = xs.length - 1;
          const last = xs[i];
          if (last?.kind !== "narrate") return xs;
          const next = [...xs];
          next[i] = { ...last, sandboxed: true };
          return next;
        });
      } else if (ev.type === "trace" && ev.event === "policy.blocked") {
        // Risk Engine chặn lệnh (tầng 3): biến bước "Running …" đang chạy thành "Blocked <lý do>".
        const step = blockedStep(ev.detail);
        if (step) {
          setLines((xs) => {
            const next = [...xs];
            const last = next[next.length - 1];
            if (last?.kind === "narrate") next[next.length - 1] = { kind: "narrate", ...step };
            else next.push({ kind: "narrate", ...step });
            return next;
          });
        }
      } else if (!here && (ev.type === "browser" || ev.type === "proc" || ev.type === "terminal")) {
        // Browser/Ports/Terminal hiển thị theo session đang mở; session nền tự tải lại khi mở thread.
      } else if (ev.type === "browser") {
        setBrowserView((prev) => applyBrowser(prev, ev));
      } else if (ev.type === "proc") {
        setProcs((xs) => applyProc(xs, ev));
        setOutputLog((xs) => [
          ...xs.slice(-199),
          t("ports.outputLine", { id: ev.id, status: ev.status, command: ev.command }) +
            (ev.urls.length ? ` · ${ev.urls.join(" ")}` : ""),
        ]);
      } else if (ev.type === "terminal") {
        term.current?.write(ev.data.replace(/\n/g, "\r\n"));
      } else if (ev.type === "error") {
        const files = turnFilesRef.current;
        turnFilesRef.current = [];
        const thoughtStart = thoughtStartedAtRef.current;
        thoughtStartedAtRef.current = 0;
        const turnStart = turnStartedAtRef.current;
        turnStartedAtRef.current = 0;
        setLines((xs) => {
          const sealed = thoughtStart ? sealThoughtMs(xs, thoughtStart) : xs;
          const withMeta = appendTurnMeta(sealed, turnStart, files);
          return [...withMeta, { kind: "error", message: ev.message, info: ev.error }];
        });
        const logLine = ev.error
          ? `[error] ${ev.error.code}${ev.error.status ? ` (HTTP ${ev.error.status})` : ""}: ${ev.error.detail}`
          : `[error] ${ev.message}`;
        setOutputLog((xs) => [...xs.slice(-199), logLine]);
        setBusy(false);
        setRun(null);
        markRun("");
        if (here) {
          // Giữ prompt: trả lại câu vừa gửi nếu composer đang trống. Không auto-retry.
          const last = lastPromptRef.current;
          setPrompt((p) => (p.trim() ? p : last));
        } else flagBg();
      } else if (ev.type === "done") {
        if (ev.stop === "budget" && here) {
          setBudgetHit(true);
          // The Engine dropped the unanswered prompt: give it back to the composer.
          const last = lastPromptRef.current;
          setPrompt((p) => (p.trim() ? p : last));
        }
        const files = turnFilesRef.current;
        turnFilesRef.current = [];
        const thoughtStart = thoughtStartedAtRef.current;
        thoughtStartedAtRef.current = 0;
        const turnStart = turnStartedAtRef.current;
        turnStartedAtRef.current = 0;
        setLines((xs) => {
          const sealed = thoughtStart ? sealThoughtMs(xs, thoughtStart) : xs;
          return appendTurnMeta(sealed, turnStart, files);
        });
        setBusy(false);
        setRun(null);
        markRun("");
        if (!here) flagBg();
        void refreshCost();
        // Chỉ gửi tên chat, không gửi nội dung trả lời (thông báo hiện cả trên màn hình khoá).
        const np = prefsRef.current;
        if (np.notifyDone || np.flashTaskbar) {
          void window.silence
            .notifyDone?.(bgThread?.title ?? threadTitleRef.current, { notify: np.notifyDone, flash: np.flashTaskbar })
            .catch(() => undefined);
        }
      } else if (ev.type === "cost") {
        setRun((m) => addCost(m, ev));
        const tid = here ? activeThreadRef.current : bgThread?.id;
        if (tid) setSpendByThread((all) => ({ ...all, [tid]: addSpend(all[tid] ?? EMPTY_SPEND, ev) }));
        setCost((c) => ({
          ...c,
          usd: c.usd + ev.usd,
          input_tokens: c.input_tokens + ev.input_tokens,
          output_tokens: c.output_tokens + ev.output_tokens,
        }));
      }
    });
  }, []);

  function loadModels() {
    if (!window.silence) return;
    void window.silence
      .rpc("models.list")
      .then((r) => setModels((r as { models: ModelInfo[] }).models ?? []))
      .catch((err: Error) => setLines((xs) => [...xs, { kind: "sys", text: String(err.message ?? err) }]));
  }

  modelsRef.current = models;
  useEffect(() => {
    setBudgetHit(false);
    setAutoModel("");
  }, [activeThreadId]);
  useEffect(() => {
    saveSpend(spendByThread, [...threads].sort((a, b) => b.updatedAt - a.updatedAt).map((t) => t.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spendByThread]);

  /** Send one source's Auto config (models switched off in Settings left out of the pool). */
  function pushAuto(provider: string, cfg: AutoConfig) {
    const config = engineConfig(cfg, provider, visibleModels(modelsRef.current, modelPrefs), modelsRef.current);
    return window.silence?.rpc("auto.set_config", { provider, config });
  }
  // The Engine keeps Auto settings in memory only: push every source's once the catalog is in,
  // and again when models are switched on/off.
  useEffect(() => {
    for (const s of modelSources(models)) void pushAuto(s.id, autoFor(autoCfgs, s.id))?.catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, modelPrefs]);

  function changeAuto(next: AutoConfig) {
    const all = { ...autoCfgs, [source]: next };
    setAutoCfgs(all);
    saveAuto(all);
    void pushAuto(source, next)?.catch((err: Error) =>
      setLines((xs) => [...xs, { kind: "sys", text: String(err.message ?? err) }]),
    );
  }

  /** Settings → Models edits the Auto config of any source, not only the active one. */
  function changeAutoFor(provider: string, next: AutoConfig) {
    const all = { ...autoCfgs, [provider]: next };
    setAutoCfgs(all);
    saveAuto(all);
    void pushAuto(provider, next)?.catch(() => undefined);
  }

  /** "Tiếp tục 1 lượt" on the spend-cap banner: one turn past the cap, then resend. */
  async function continuePastCap() {
    setBudgetHit(false);
    if (!sessionId) return;
    await window.silence.rpc("session.budget_continue", { session_id: sessionId }).catch(() => undefined);
    const text = prompt.trim() || lastPromptRef.current;
    if (text) {
      setPrompt("");
      void send(text);
    }
  }

  /** Catalog + models added in Settings, minus the ones switched off there. */
  const allModels = useMemo(() => visibleModels(models, modelPrefs), [models, modelPrefs]);
  const sources = useMemo(() => modelSources(models), [models]);
  /** Tier lookups prefer the picked source; the CLI is refused there (Auto on the CLI comes
   * from the session's `source`, sent with `session.set_model`), so the Engine gets "". */
  const preferredFor = (src: string) =>
    sources.find((s) => s.id === src)?.kind === "claude_cli" ? "" : src;

  // Push the saved source first so `models.list` and the first turn see it. A CLI source is
  // refused by the Engine (no Auto there), which is fine: the CLI turn never asks for Auto.
  useEffect(() => {
    if (!window.silence) return;
    void window.silence
      .rpc("providers.set_preferred", { provider: source })
      .catch(() => undefined)
      .finally(loadModels);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which account the Claude CLI source runs as (shown next to it in the Source submenu).
  // `claude auth status` is local and free; read once per catalog load.
  const [cliEmail, setCliEmail] = useState("");
  const cliReady = sources.some((s) => s.kind === "claude_cli" && s.available);
  useEffect(() => {
    if (!cliReady || !window.silence) {
      setCliEmail("");
      return;
    }
    let live = true;
    void window.silence
      .rpc("providers.cli_info")
      .then((r) => {
        const a = (r as CliInfo).account;
        if (live) setCliEmail(a?.logged_in ? a.email : a ? "not signed in" : "");
      })
      .catch(() => live && setCliEmail(""));
    return () => {
      live = false;
    };
  }, [cliReady, models]);

  /** Switch the picker's source: list only its models, keep or reset the model, tell the Engine. */
  function chooseSource(id: string) {
    setSource(id);
    setModel((cur) => modelForSource(cur, id, allModels));
    void window.silence
      ?.rpc("providers.set_preferred", { provider: preferredFor(id) })
      .catch((err: Error) => setLines((xs) => [...xs, { kind: "sys", text: String(err.message ?? err) }]));
  }

  useEffect(() => {
    saveModelPrefs(modelPrefs);
  }, [modelPrefs]);

  // Model + effort survive a reload. A saved model the catalog no longer has falls back to Auto.
  useEffect(() => {
    savePick({ model, effort });
  }, [model, effort]);
  // Keep source + model consistent with the catalog: a gone source → the default (Claude CLI
  // unless set in Settings), never switched just because it is unusable; a model that is gone
  // or belongs to another source → Auto.
  useEffect(() => {
    if (models.length === 0) return;
    const src = resolveSource(source, sources, loadDefaultSource());
    if (src !== source) {
      chooseSource(src);
      return;
    }
    const fixed = modelForSource(
      allModels.some((m) => m.id === model) ? model : "auto",
      src,
      allModels,
    );
    if (fixed !== model) {
      setModel(fixed);
      return;
    }
    setEffort((e) => normalizeEffort(e, model, allModels));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, model, source, allModels]);

  useEffect(() => {
    if (!termEl) return;
    const p = prefsRef.current;
    const t = new Terminal({
      theme: terminalTheme(),
      fontSize: p.codeFontSize,
      fontFamily: p.codeFont,
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(termEl);
    f.fit();
    t.onData((data) => {
      const id = sessionIdRef.current;
      if (!id) return;
      void window.silence.rpc("terminal.write", { session_id: id, data });
    });
    term.current = t;
    fit.current = f;
    termRef.current = termEl;
    return () => {
      t.dispose();
      term.current = null;
      fit.current = null;
    };
  }, [termEl]);

  // Font, size and colours follow Settings without recreating the terminal (scrollback stays).
  useEffect(() => {
    const t = term.current;
    if (!t) return;
    t.options.fontFamily = prefs.codeFont;
    t.options.fontSize = prefs.codeFontSize;
    t.options.theme = terminalTheme();
    fit.current?.fit();
  }, [prefs.codeFont, prefs.codeFontSize, appearance]);

  // Giữ máy thức khi agent đang chạy (nếu bật). Main giữ một blocker duy nhất.
  useEffect(() => {
    void window.silence?.keepAwake?.(busy && prefs.keepAwake).catch(() => undefined);
  }, [busy, prefs.keepAwake]);

  useEffect(() => {
    if (panelOpen && panelTab === "terminal") fit.current?.fit();
  }, [panelOpen, panelTab, reviewSub]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.altKey && !e.shiftKey && e.code === "KeyU") {
        e.preventDefault();
        if (shellView === "hidden") {
          setHistoryHidden(false);
          setShellView("chat");
          return;
        }
        setHistoryHidden((v) => !v);
        return;
      }
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.code === "KeyJ") {
        e.preventDefault();
        setPanelOpen((v) => !v);
        return;
      }
      if (evalsAvailable && e.ctrlKey && e.shiftKey && !e.altKey && e.code === "KeyE") {
        e.preventDefault();
        toggleEvals();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shellView, showEvals, evalsAvailable]);

  async function refreshCost() {
    const r = (await window.silence.rpc("cost.summary")) as {
      usd: number;
      input_tokens: number;
      output_tokens: number;
      events: number;
    };
    setCost(r);
  }

  async function createLiveSession(dir: string) {
    // Cân bằng (mặc định): tầng 0–1 tự chạy có hiển thị, tầng 2 hỏi, tầng 3 chặn — docs/security/permissions.md.
    // Chọn mode trong Settings là B4. Engine cũ (protocol < 0.1.9) chưa biết `balanced` → lùi về `ask`.
    const create = (permission: string) =>
      window.silence.rpc("session.create", { workspace: dir, model, mode, permission }) as Promise<{ session_id: string }>;
    let created: { session_id: string };
    try {
      created = await create(permMode);
    } catch (e) {
      if (!/unknown variant/i.test(e instanceof Error ? e.message : String(e))) throw e;
      setOutputLog((xs) => [...xs.slice(-199), `[warn] ${t("app.oldEngineBalanced")}`]);
      created = await create("ask");
    }
    await window.silence.rpc("terminal.start", { session_id: created.session_id, cols: 100, rows: 16 });
    return created.session_id;
  }

  function rememberThread(id: string) {
    setOpenTabIds((ids) => (ids.includes(id) ? ids : [id, ...ids]));
  }

  function beginThread(
    dir: string,
    liveSessionId: string,
    initial: ChatLine[] = [],
    opts?: { forkedFromId?: string; title?: string; titleSource?: ChatThread["titleSource"] },
  ) {
    const id = crypto.randomUUID();
    const baseTitle = opts?.title?.trim() || titleFrom(initial, t("history.newChat"));
    const thread: ChatThread = {
      id,
      sessionId: liveSessionId,
      workspace: dir,
      title: opts?.forkedFromId ? (baseTitle.startsWith("Fork · ") ? baseTitle : `Fork · ${baseTitle}`) : baseTitle,
      preview: previewFrom(initial),
      updatedAt: Date.now(),
      lines: initial,
      forkedFromId: opts?.forkedFromId,
      titleSource: opts?.titleSource ?? "auto",
    };
    stashPlan();
    setActiveThreadId(id);
    switchSession(liveSessionId);
    setLines(initial);
    setPlan(null);
    setDiff(null);
    setPrompt("");
    setImages([]);
    // Lượt ở thread khác vẫn chạy nền: không tắt busy của nó (chỉ dọn trạng thái kẹt khi không có lượt nào).
    if (!runSessionRef.current) {
      setBusy(false);
      setRun(null);
    }
    setShowEvals(false);
    setShellView("chat");
    setOpenTabIds((ids) => [id, ...ids.filter((x) => x !== id)]);
    setThreads((xs) => [thread, ...xs.filter((x) => x.lines.length > 0)]);
    focusComposer();
  }

  async function forkChat(endLineInclusive: number) {
    if (!workspace || busy) return;
    const parentId = activeThreadId;
    if (!parentId) return;
    const cut = Math.max(0, Math.min(endLineInclusive, lines.length - 1));
    await forkLines(parentId, lines.slice(0, cut + 1), { cut: cutParams(lines, cut + 1) });
  }

  /** Menu chuột phải → Fork from here: chat mới với phần trước tin user `userLine`; tin đó về composer. */
  async function forkFrom(userLine: number) {
    if (!workspace || busy || !activeThreadId) return;
    const target = lines[userLine];
    if (target?.kind !== "user") return;
    await forkLines(activeThreadId, lines.slice(0, userLine), {
      cut: cutParams(lines, userLine),
      prompt: target.text,
      images: target.images,
    });
  }

  /** Fork cả đoạn chat `id` (menu ⋯ ở lịch sử). */
  async function forkThread(id: string) {
    if (!workspace || busy) return;
    const src = id === activeThreadId ? lines : threads.find((t) => t.id === id)?.lines;
    if (!src) return;
    await forkLines(id, src, { cut: {} });
  }

  /**
   * New live session for a fork: `session.fork` copies the parent's model history (cut like the
   * UI lines). Old Engine / lost session: an empty session, as before 0.1.16 (warned in Output).
   */
  async function forkLiveSession(dir: string, parentSid: string, cut: { keep_user_turns?: number; text?: string }) {
    if (parentSid) {
      try {
        const r = (await window.silence.rpc("session.fork", { session_id: parentSid, ...cut })) as { session_id: string };
        await window.silence.rpc("terminal.start", { session_id: r.session_id, cols: 100, rows: 16 });
        return r.session_id;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setOutputLog((xs) => [...xs.slice(-199), `[warn] ${t("app.forkHistoryFailed", { message })}`]);
      }
    }
    return createLiveSession(dir);
  }

  async function forkLines(
    parentId: string,
    src: ChatLine[],
    opts: { cut: { keep_user_turns?: number; text?: string }; prompt?: string; images?: string[] },
  ) {
    if (!workspace) return;
    const sliced = src.map((l) => ({ ...l }));
    if (sliced.length === 0 && opts.prompt === undefined) return;
    snapshotActive();
    const parent = threads.find((t) => t.id === parentId);
    const parentSid = parentId === activeThreadId ? sessionId : (parent?.sessionId ?? "");
    const liveId = await forkLiveSession(workspace, parentSid, opts.cut);
    // Cha đã có tiêu đề chốt (AI / user) thì fork dùng lại, không sinh thêm.
    const parentLocked = parent?.titleSource === "ai" || parent?.titleSource === "user";
    beginThread(workspace, liveId, sliced, {
      forkedFromId: parentId,
      title: parentLocked && parent ? parent.title : titleFrom(sliced, parent?.title ?? t("history.newChat")),
      titleSource: parentLocked ? "ai" : "auto",
    });
    if (opts.prompt !== undefined) setPrompt(opts.prompt);
    if (opts.images?.length) setImages(opts.images);
    await refreshCost();
  }

  /**
   * Cut the Engine's history before line `idx` of `src` (Rewind, Retry, Checkpoint Restore).
   * `true` = cut (or nothing to cut: the session is gone after an Engine restart, so the next
   * send starts a new one). `false` = the Engine refused; the UI must not cut either.
   */
  async function cutEngineHistory(src: ChatLine[], idx: number): Promise<boolean> {
    const cut = cutParams(src, idx);
    if (!sessionId || cut.keep_user_turns === undefined) return true;
    try {
      await window.silence.rpc("session.rewind", { session_id: sessionId, ...cut });
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (/unknown session/i.test(message)) return true;
      const line = /unknown method/i.test(message) ? t("app.rewindOldEngine") : t("app.rewindFailed", { message });
      setOutputLog((xs) => [...xs.slice(-199), `[error] ${line}`]);
      window.alert(line);
      return false;
    }
  }

  /**
   * Menu chuột phải → Rewind to here (hỏi xác nhận: không hoàn tác được) hoặc Retry (lượt cuối).
   * Bỏ tin user `userLine` và mọi thứ sau nó ở UI và ở Engine. Rewind đưa tin về composer; Retry gửi lại.
   * File trong workspace giữ nguyên (khác Checkpoint Restore).
   */
  async function rewindTo(userLine: number, retry = false) {
    if (busy) return;
    const target = lines[userLine];
    if (target?.kind !== "user") return;
    if (!retry) {
      const removed = lines.slice(userLine).filter((l) => l.kind === "user").length;
      const ok = await askConfirm({
        title: t("app.rewindTitle"),
        body: t(removed > 1 ? "app.rewindConfirm" : "app.rewindConfirmOne", { count: removed }),
        confirmLabel: t("app.rewindDo"),
        danger: true,
        icon: <History size={16} aria-hidden />,
      });
      if (!ok) return;
    }
    if (!(await cutEngineHistory(lines, userLine))) return;
    setLines(lines.slice(0, userLine));
    setPlan(null);
    setDiff(null);
    setPerm(null);
    turnFilesRef.current = [];
    turnStartedAtRef.current = 0;
    if (retry) {
      // Retry gửi lại cả ảnh của tin gốc (nếu còn trong bộ nhớ).
      void send(target.text, undefined, target.images);
      return;
    }
    setPrompt((p) => rewindPrompt(target.text, p));
    // Ảnh của tin về composer, không đè ảnh đang đính kèm trong bản nháp.
    if (target.images?.length) setImages((prev) => rewindImages(target.images, prev));
    focusComposer();
  }

  /** Menu chuột phải → Attach message as context: trích dẫn vào composer, giữ bản nháp. */
  function attachMessage(text: string) {
    setPrompt((p) => attachToPrompt(p, text));
    focusComposer();
  }

  async function openWorkspace() {
    const dir = await window.silence.pickFolder();
    if (!dir) return;
    setWorkspace(dir);
    const liveId = await createLiveSession(dir);
    const treeRes = (await window.silence.rpc("fs.tree", { workspace: dir, max_entries: 400 })) as { tree: string };
    setTree(treeRes.tree.split("\n").filter(Boolean));
    await refreshCost();
    beginThread(dir, liveId);
  }

  async function requestTitle(threadId: string, liveSessionId: string, userText: string, replyText: string) {
    try {
      const r = (await window.silence.rpc("chat.title", {
        session_id: liveSessionId,
        user_text: userText,
        reply_text: replyText,
      })) as { title?: string };
      const title = r.title?.trim();
      if (!title) return;
      setThreads((xs) =>
        xs.map((x) => {
          // User có thể đã đổi tên tay trong lúc chờ: không ghi đè.
          if (x.id !== threadId || x.titleSource === "user") return x;
          return { ...x, title: x.forkedFromId ? `Fork · ${title}` : title, titleSource: "ai" };
        }),
      );
      void refreshCost();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setOutputLog((xs) => [...xs.slice(-199), `[warn] ${t("app.titleFailed", { message })}`]);
    }
  }

  function renameThread(id: string, title: string) {
    const t = title.trim().replace(/\s+/g, " ");
    if (!t) return;
    setThreads((xs) => xs.map((x) => (x.id === id ? { ...x, title: t, titleSource: "user" } : x)));
  }

  function patchThread(id: string, patch: Partial<Pick<ChatThread, "pinned" | "archived" | "unread">>) {
    setThreads((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function archiveThread(id: string, archived: boolean) {
    if (archived) {
      // Lưu trữ thì rời khỏi tab (như đóng tab), thread vẫn còn trong lịch sử.
      const wasActive = id === activeThreadId;
      const otherTab = openTabIds.some(
        (x) => x !== id && threads.some((t) => t.id === x && t.workspace === workspace),
      );
      if (openTabIds.includes(id)) closeTab(id);
      patchThread(id, { archived: true, pinned: false });
      // Như xoá: lưu trữ chat đang mở mà không còn tab nào thì mở chat mới, không rơi về màn hình chào.
      if (wasActive && !otherTab) void newChat();
    } else {
      patchThread(id, { archived: false });
    }
  }

  /** Thêm tab cho thread mà không đổi thread đang mở. */
  function openInNewTab(id: string) {
    const t = threads.find((x) => x.id === id);
    if (!t) return;
    if (t.archived) patchThread(id, { archived: false });
    setShellView("chat");
    setOpenTabIds((ids) => {
      if (ids.includes(id)) return ids;
      const at = ids.indexOf(activeThreadId);
      return at < 0 ? [...ids, id] : [...ids.slice(0, at + 1), id, ...ids.slice(at + 1)];
    });
  }

  async function newChat() {
    if (!workspace) return;
    // Đang ở chat trống thì dùng lại, không đẻ thêm chat rỗng.
    if (activeThreadId && lines.length === 0 && threads.some((t) => t.id === activeThreadId)) {
      setShellView("chat");
      focusComposer();
      return;
    }
    const liveId = await createLiveSession(workspace);
    beginThread(workspace, liveId);
    await refreshCost();
  }

  function focusComposer() {
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>(".composer textarea")?.focus();
    });
  }

  function snapshotActive() {
    if (!activeThreadId) return;
    setThreads((xs) =>
      xs.map((x) =>
        x.id === activeThreadId
          ? {
              ...x,
              sessionId,
              lines,
              title: titleLocked(x) ? x.title : titleFrom(lines, x.title),
              preview: previewFrom(lines),
              updatedAt: x.lines === lines && x.sessionId === sessionId ? x.updatedAt : Date.now(),
            }
          : x,
      ),
    );
  }

  /** Rời thread đang mở: plan chưa duyệt đi theo session của nó, mở lại thread thì hiện lại. */
  function stashPlan() {
    if (plan && sessionIdRef.current) pendingPlanRef.current.set(sessionIdRef.current, plan);
  }

  /** Mở thread `t` trong khung chat. Card quyền (`perm`) không xoá: nó gắn session và chỉ hiện ở thread của nó. */
  function showThread(t: ChatThread) {
    stashPlan();
    setActiveThreadId(t.id);
    switchSession(t.sessionId);
    setLines(t.lines);
    const pending = pendingPlanRef.current.get(t.sessionId) ?? null;
    pendingPlanRef.current.delete(t.sessionId);
    setPlan(pending);
    setDiff(null);
    setPrompt("");
    setImages([]);
  }

  function selectThread(id: string) {
    const t = threads.find((x) => x.id === id);
    if (!t) return;
    setShellView("chat");
    setShowEvals(false);
    rememberThread(id);
    if (t.unread || t.archived) patchThread(id, { unread: false, archived: false });
    if (id !== activeThreadId) {
      snapshotActive();
      showThread(t);
      if (workspace && !t.sessionId) {
        void createLiveSession(workspace).then((liveId) => {
          switchSession(liveId);
        });
      }
    }
    focusComposer();
  }

  function closeTab(id: string) {
    if (id === activeThreadId) snapshotActive();
    const nextIds = openTabIds.filter((x) => x !== id);
    setOpenTabIds(nextIds);
    if (activeThreadId !== id) return;
    const next = nextIds.map((x) => threads.find((t) => t.id === x)).find((t) => t && t.workspace === workspace);
    if (next) {
      showThread(next);
      return;
    }
    stashPlan();
    setActiveThreadId("");
    switchSession("");
    setLines([]);
    setPlan(null);
    setDiff(null);
  }

  /** Settings → Dữ liệu → Xoá toàn bộ: mọi chat (kể cả đã ghim) và log của Engine. Audit giữ nguyên. */
  async function clearHistory(): Promise<number> {
    const listed = (await window.silence.rpc("session.list").catch(() => ({ sessions: [] }))) as {
      sessions: { session_id: string }[];
    };
    const ids = new Set([...threads.map((t) => t.sessionId), ...listed.sessions.map((s) => s.session_id)]);
    ids.delete("");
    const r = (await window.silence.rpc("session.delete", { session_ids: [...ids] })) as { deleted: string[] };
    setThreads([]);
    setOpenTabIds([]);
    setActiveThreadId("");
    setLines([]);
    void newChat();
    return r.deleted.length;
  }

  function deleteThread(id: string) {
    const index = threads.findIndex((t) => t.id === id);
    if (index >= 0) {
      const old = threads[index];
      // Chat đang mở: `lines` mới nhất nằm ở state, không phải bản trong `threads`.
      const thread = id === activeThreadId ? { ...old, sessionId, lines } : old;
      setUndoDel({ thread, index, tabIndex: openTabIds.indexOf(id), wasActive: id === activeThreadId });
    }
    const rest = threads.filter((t) => t.id !== id);
    const nextOpenIds = openTabIds.filter((x) => x !== id);
    setThreads(rest);
    if (activeThreadId !== id) {
      setOpenTabIds(nextOpenIds);
      return;
    }
    const next =
      nextOpenIds.map((x) => rest.find((t) => t.id === x)).find((t) => t && t.workspace === workspace) ??
      rest.find((t) => t.workspace === workspace);
    if (next) {
      setOpenTabIds(nextOpenIds.includes(next.id) ? nextOpenIds : [next.id, ...nextOpenIds]);
      setActiveThreadId(next.id);
      switchSession(next.sessionId);
      setLines(next.lines);
      return;
    }
    setOpenTabIds(nextOpenIds);
    void newChat();
  }

  function undoDelete() {
    const u = undoDel;
    if (!u) return;
    setUndoDel(null);
    const id = u.thread.id;
    setThreads((xs) => (xs.some((x) => x.id === id) ? xs : [...xs.slice(0, u.index), u.thread, ...xs.slice(u.index)]));
    if (u.tabIndex >= 0)
      setOpenTabIds((ids) => (ids.includes(id) ? ids : [...ids.slice(0, u.tabIndex), id, ...ids.slice(u.tabIndex)]));
    if (u.wasActive) reopenRef.current = id;
  }

  // Hoàn tác chat đang mở: mở lại nó khi đã về `threads`; tab "Chat mới" rỗng mở thay lúc xoá thì bỏ.
  useEffect(() => {
    const id = reopenRef.current;
    if (!id || !threads.some((x) => x.id === id)) return;
    reopenRef.current = "";
    const placeholder = activeThreadId && activeThreadId !== id && lines.length === 0 ? activeThreadId : "";
    selectThread(id);
    if (placeholder) {
      setOpenTabIds((ids) => ids.filter((x) => x !== placeholder));
      setThreads((xs) => xs.filter((x) => x.id !== placeholder));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads]);

  async function openFile(rel: string) {
    if (!workspace) return;
    if (isImagePath(rel)) {
      // Ảnh không đọc được dạng chữ: mở lightbox (xem, copy, lưu).
      try {
        const img = await readWorkspaceImage(workspace, rel);
        setLightbox({ images: [img.data_url], index: 0 });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setOutputLog((xs) => [...xs.slice(-199), `[error] ${t("app.openImageFailed", { path: rel, message })}`]);
      }
      return;
    }
    try {
      // Đọc trước rồi mới đặt file: chip trong câu trả lời có thể trỏ tới file không tồn tại.
      const r = (await window.silence.rpc("fs.read", { workspace, path: rel })) as { text: string };
      setFile(rel);
      setReviewOpen(true);
        setShowEvals(false);
      setFileText(r.text);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setOutputLog((xs) => [...xs.slice(-199), `[error] ${t("app.openFailed", { path: rel, message })}`]);
    }
  }

  async function send(retryText?: string, modeOverride?: SessionMode, retryImages?: string[]) {
    const text = (retryText ?? prompt).trim();
    // Thử lại (retry): ảnh do nơi gọi đưa vào (Retry trong menu tin nhắn); không thì chỉ gửi lại chữ.
    const turnImages = retryText === undefined ? images : (retryImages ?? []);
    if (!sessionId || (!text && turnImages.length === 0) || busy) return;
    // `mode` là state nên không kịp cập nhật khi vừa setMode: dùng giá trị ghi đè cho lượt này.
    const turnMode = modeOverride ?? mode;
    turnModeRef.current = turnMode;
    lastPromptRef.current = text;
    if (retryText === undefined) {
      setPrompt("");
      setImages([]);
    }
    turnStartedAtRef.current = Date.now();
    turnFilesRef.current = [];
    thoughtStartedAtRef.current = Date.now();
    const plan = planningStep();
    setLines((xs) => [
      ...xs,
      turnImages.length ? { kind: "user", text, images: turnImages } : { kind: "user", text },
      { kind: "narrate", verb: plan.verb, detail: plan.detail },
    ]);
    setBusy(true);
    setRun(startRun(turnStartedAtRef.current));
    markRun(sessionId);
    let sid = sessionId;
    if (turnImages.length) {
      // Lưu ảnh vào IndexedDB để mở lại thread vẫn thấy; dòng user được nhận ra qua mảng ảnh.
      void putImages(turnImages).then((ids) => {
        if (!ids) return;
        setLines((xs) => xs.map((l) => (l.kind === "user" && l.images === turnImages ? { ...l, imageIds: ids } : l)));
      });
    }
    try {
      try {
        await window.silence.rpc("session.set_model", { session_id: sid, model, source });
      } catch (e) {
        // Engine đã restart nên session cũ (lưu trong lịch sử) không còn: tạo session mới, giữ lịch sử hiển thị.
        if (!/unknown session/i.test(e instanceof Error ? e.message : String(e)) || !workspace) throw e;
        const old = sid;
        sid = await createLiveSession(workspace);
        // User có thể đã đổi tab trong lúc chờ: gắn session mới vào đúng thread đã gửi, không kéo khung chat theo.
        if (sessionIdRef.current === old) switchSession(sid);
        else setThreads((xs) => xs.map((x) => (x.sessionId === old ? { ...x, sessionId: sid } : x)));
        markRun(sid);
        await window.silence.rpc("session.set_model", { session_id: sid, model, source });
      }
      // Mode/model chỉ được gửi lúc session.create, nên đồng bộ lại trước mỗi lượt.
      await window.silence.rpc("session.set_mode", { session_id: sid, mode: turnMode });
      // Engine cũ (protocol < 0.1.11) chưa có set_effort: bỏ qua, lượt vẫn chạy với mặc định model.
      await window.silence.rpc("session.set_effort", { session_id: sid, effort }).catch(() => undefined);
      // Settings → Trò chuyện → Phong cách trả lời: áp từ lượt này (Engine cũ không biết method thì bỏ qua).
      await window.silence
        .rpc("session.set_style", { session_id: sid, style: prefsRef.current.responseStyle })
        .catch(() => undefined);
      // Engine restart (watch mode) loses Auto settings: re-send the active source's with the turn.
      await pushAuto(source, autoFor(autoCfgs, source))?.catch(() => undefined);
      // A new live session for this thread (Engine restart, reopened app) starts at $0: carry the
      // thread's spend so the Auto cap still holds. The Engine keeps the larger of the two.
      if (spend.usd > 0) {
        await window.silence.rpc("session.carry_spend", { session_id: sid, usd: spend.usd }).catch(() => undefined);
      }
      // Engine restart (watch mode) loses the Auto preference: re-send it with the turn.
      await window.silence.rpc("providers.set_preferred", { provider: preferredFor(source) }).catch(() => undefined);
      // Session cũ (resume) giữ chế độ quyền lúc tạo: đồng bộ lại theo Settings trước mỗi lượt.
      await window.silence.rpc("session.set_permission", { session_id: sid, permission: permMode }).catch(() => undefined);
      if (turnImages.length) {
        // Engine build cũ (vd. chỉ UI được hot-reload) bỏ qua `images` im lặng: model không thấy ảnh.
        const pong = (await window.silence.rpc("ping", {})) as { protocol?: unknown } | null;
        if (!supportsImages(pong?.protocol)) {
          throw new Error(t("app.engineNoImages", { protocol: String(pong?.protocol ?? "?") }));
        }
      }
      // Debug: gửi kèm phần cuối tab Output (Engine lọc secret trước khi đưa cho model).
      const context = turnMode === "debug" ? outputLog.slice(-60).join("\n") : undefined;
      await window.silence.rpc("session.prompt", {
        session_id: sid,
        text,
        context,
        ...(turnImages.length ? { images: turnImages } : {}),
        // Ngôn ngữ giao diện: Engine dùng khi tin nhắn không rõ ngôn ngữ ("ok", chỉ dán log).
        // Engine cũ (protocol < 0.1.19) bỏ qua trường này.
        ui_lang: langRef.current,
      });
    } catch (e) {
      // RPC bị từ chối (vd. Engine chưa sẵn sàng): tắt busy, trả prompt, hiện thẻ lỗi chung.
      const message = e instanceof Error ? e.message : String(e);
      turnStartedAtRef.current = 0;
      thoughtStartedAtRef.current = 0;
      const stillHere = sid === sessionIdRef.current;
      linesFor(sid, (xs) => [...xs, { kind: "error", message }]);
      setOutputLog((xs) => [...xs.slice(-199), `[error] ${message}`]);
      setBusy(false);
      setRun(null);
      markRun("");
      // Chỉ trả prompt/ảnh về composer khi user còn ở thread đã gửi (không đổ sang chat khác).
      if (stillHere) {
        setPrompt((p) => (p.trim() ? p : text));
        setImages((xs) => (xs.length ? xs : turnImages));
      }
    }
  }

  /** Yêu cầu Engine dừng lượt: cờ abort được kiểm ở đầu mỗi vòng; `done` (stop=abort) sẽ tắt busy. */
  async function stop() {
    const target = runSessionRef.current || sessionId;
    if (!target || !busy) return;
    setRun(markStopping);
    // Engine từ chối quyền đang chờ khi abort; gỡ card ngay để không còn nút duyệt "mồ côi".
    setPerm(null);
    try {
      await window.silence.rpc("session.abort", { session_id: target });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setOutputLog((xs) => [...xs.slice(-199), `[error] ${t("app.stopFailed", { message })}`]);
    }
  }

  async function applyDiff() {
    if (!sessionId || !diff) return;
    if (diff.applied) {
      setDiff(null);
      return;
    }
    try {
      await window.silence.rpc("diff.apply", {
        session_id: sessionId,
        path: diff.path,
        after: diff.after,
      });
      const prev = turnFilesRef.current.filter((f) => f.path !== diff.path);
      turnFilesRef.current = [
        ...prev,
        { path: diff.path, before: diff.before, after: diff.after },
      ];
      setDiff(null);
      if (file === diff.path) setFileText(diff.after);
    } catch {
      setOutputLog((xs) => [
        ...xs.slice(-199),
        t("app.applyFailed"),
      ]);
    }
  }

  async function rejectDiff() {
    if (!sessionId || !diff) return;
    if (diff.applied) {
      // Balanced: file đã được ghi. "Hoàn tác" = ghi lại nội dung trước khi sửa (cùng đường với Restore).
      try {
        await window.silence.rpc("diff.apply", { session_id: sessionId, path: diff.path, after: diff.before });
        turnFilesRef.current = turnFilesRef.current.filter((f) => f.path !== diff.path);
        setDiff(null);
        if (file === diff.path) setFileText(diff.before);
      } catch {
        setOutputLog((xs) => [...xs.slice(-199), t("app.undoFailed", { path: diff.path })]);
      }
      return;
    }
    try {
      await window.silence.rpc("diff.reject", {
        session_id: sessionId,
        path: diff.path,
      });
      setDiff(null);
    } catch {
      setOutputLog((xs) => [
        ...xs.slice(-199),
        t("app.rejectFailed"),
      ]);
    }
  }

  async function restoreCheckpoint(id: string) {
    if (busy) return;
    const checkpoints = lines.filter(
      (l): l is Extract<ChatLine, { kind: "checkpoint" }> => l.kind === "checkpoint",
    );
    const target = checkpoints.find((c) => c.id === id);
    if (!target) return;
    const ok = await askConfirm({
      title: t("app.restoreTitle"),
      body: t("app.restoreConfirm"),
      confirmLabel: t("app.restoreDo"),
      danger: true,
      icon: <History size={16} aria-hidden />,
    });
    if (!ok) return;

    const toWrite = filesToRestore(checkpoints, id);
    for (const f of toWrite) {
      if (!sessionId) break;
      try {
        await window.silence.rpc("diff.apply", {
          session_id: sessionId,
          path: f.path,
          after: f.before,
        });
        if (file === f.path) setFileText(f.before);
      } catch {
        setOutputLog((xs) => [...xs.slice(-199), t("app.restoreFailed", { path: f.path })]);
      }
    }

    const idx = lines.findIndex((l) => l.kind === "checkpoint" && l.id === id);
    if (idx >= 0) {
      // Model history follows the cut too (before 0.1.16 only the UI was cut). Files are already
      // restored, so a refusal here only leaves the model seeing the later turns.
      if (userTurnsBefore(lines, lines.length) > userTurnsBefore(lines, idx + 1)) {
        await cutEngineHistory(lines, idx + 1);
      }
      setLines(lines.slice(0, idx + 1));
    }
    setDiff(null);
    setPlan(null);
    setPerm((p) => (p?.session_id === sessionId ? null : p));
    // Lượt đang chạy ở thread khác thì để yên.
    if (!runSessionRef.current || runSessionRef.current === sessionId) {
      turnFilesRef.current = [];
      turnStartedAtRef.current = 0;
      setBusy(false);
      setRun(null);
      markRun("");
    }
  }

  function onChip(chip: string) {
    const byChip: Record<string, SessionMode> = {
      Plan: "plan",
      Agent: "agent",
      Code: "agent",
      Debug: "debug",
      MultiTask: "multitask",
      Review: "review",
      Ask: "ask",
    };
    if (chip === "ReviewChanges") {
      // Nút Review ở hàng Files: chuyển sang Review và điền sẵn yêu cầu nếu ô nhập đang trống.
      setMode("review");
      setPrompt((p) => (p.trim() ? p : t("app.reviewPrompt")));
      focusComposer();
    } else if (byChip[chip]) setMode(byChip[chip]);
    else if (chip === "More") openSettings();
  }

  async function answerPerm(allow: boolean, scope: PermScope) {
    if (!perm || permBusy) return;
    setPermBusy(true);
    setPermError(false);
    try {
      // Deny never persists; Engine enforces this too. `remember` is the legacy flag for old Engines.
      const s: PermScope = allow ? scope : "once";
      await window.silence.rpc("session.permission", {
        session_id: perm.session_id,
        request_id: perm.request_id,
        allow,
        scope: s,
        remember: s === "workspace",
      });
      setPerm(null);
    } catch {
      // Keep the banner mounted so the user can retry.
      setPermError(true);
    } finally {
      setPermBusy(false);
    }
  }

  async function approvePlan() {
    if (!sessionId || busy) return;
    // Engine lưu plan vào .silence/plans/, chuyển sang Agent và tự chạy lượt implement.
    setPlan(null);
    setMode("agent");
    turnStartedAtRef.current = Date.now();
    turnFilesRef.current = [];
    thoughtStartedAtRef.current = Date.now();
    const step = planningStep();
    setLines((xs) => [
      ...xs,
      { kind: "user", text: t("app.approvePlanMsg") },
      { kind: "narrate", verb: step.verb, detail: step.detail },
    ]);
    setBusy(true);
    setRun(startRun(turnStartedAtRef.current));
    markRun(sessionId);
    const planSid = sessionId;
    try {
      await window.silence.rpc("session.approve_plan", { session_id: planSid });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      turnStartedAtRef.current = 0;
      thoughtStartedAtRef.current = 0;
      linesFor(planSid, (xs) => [...xs, { kind: "error", message }]);
      setBusy(false);
      setRun(null);
      markRun("");
    }
  }

  function revisePlan() {
    // Giữ mode Plan; góp ý gõ vào ô nhập sẽ được model dùng để sửa và nộp lại plan.
    setMode("plan");
    setPrompt((p) => (p.trim() ? p : t("app.revisePlanPrompt")));
    focusComposer();
  }

  async function attachEdited(png: Blob, text: string): Promise<string | null> {
    // "Gửi cho agent" từ trình chỉnh sửa ảnh: đính PNG đã đánh dấu + điền sẵn yêu cầu; user tự gửi.
    const file = new File([png], "anh-danh-dau.png", { type: "image/png" });
    const r = await imagesFromFiles([file], images.length, t);
    if (!r.images.length) return r.error ?? t("app.attachFailed");
    setImages((xs) => [...xs, ...r.images]);
    // Ô nhập đang có chữ thì giữ lại, đặt sau yêu cầu sửa.
    setPrompt((p) => (p.trim() ? `${text.endsWith("\n") ? text : `${text}\n`}${p}` : text));
    focusComposer();
    return null;
  }

  const editorLang = useMemo(() => {
    const f = file ?? "";
    if (f.endsWith(".ts") || f.endsWith(".tsx")) return "typescript";
    if (f.endsWith(".py")) return "python";
    if (f.endsWith(".rs")) return "rust";
    if (f.endsWith(".json")) return "json";
    if (f.endsWith(".md")) return "markdown";
    return "plaintext";
  }, [file]);

  const wsName = (workspace || threads.find((t) => t.workspace)?.workspace || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop() ?? "";
  const showReview = Boolean(diff || file) && reviewOpen;
  // Diff mới chỉ hiện card trong chat; panel đóng lại trừ khi user đang xem một file.
  useEffect(() => {
    if (!file) setReviewOpen(false);
  }, [diff]);
  const wsThreads = useMemo(
    () =>
      threads
        .filter((t) => t.workspace === workspace)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [threads, workspace],
  );
  const openTabs = useMemo(
    () =>
      openTabIds
        .map((id) => threads.find((t) => t.id === id))
        .filter((t): t is ChatThread => Boolean(t && t.workspace === workspace)),
    [openTabIds, threads, workspace],
  );
  const threadIdx = openTabs.findIndex((t) => t.id === activeThreadId);
  const wp = appearance.wallpaper === "mountains" ? `url(${mountains})` : "";
  // Locked opt-in models (e.g. Fable) stay visible in the picker but can't be picked there.
  const locked = lockedModels(models, modelPrefs);
  const pickerModels = locked.length ? [...allModels, ...locked] : allModels;
  /** Lượt đang chạy thuộc thread đang mở? Thread khác chỉ thấy composer khoá, không thấy pulse/Stop. */
  const busyHere = busy && (!runSessionId || runSessionId === sessionId);
  const busyElsewhere = busy && !busyHere;
  const permHere = perm && perm.session_id === sessionId ? perm : null;
  const runThreadId = runSessionId ? threads.find((x) => x.sessionId === runSessionId)?.id : undefined;

  const composerEl = (
    <Composer
      prompt={prompt}
      onPrompt={setPrompt}
      images={images}
      onImages={setImages}
      onSend={() => void send()}
      onSendAs={(m) => {
        setMode(m);
        void send(undefined, m);
      }}
      onChip={onChip}
      mode={mode}
      model={model}
      models={pickerModels}
      onModel={setModel}
      effort={effort}
      onEffort={setEffort}
      source={source}
      sources={sources}
      onSource={chooseSource}
      sourceAccounts={cliEmail ? { "claude_cli": cliEmail } : undefined}
      onSetupSources={() => {
        setFocusSources(Date.now());
        openSettings("models");
      }}
      busy={busyHere}
      onStop={() => void stop()}
      disabled={!sessionId || busyElsewhere}
      files={tree}
      context={contextUsage}
      onOpenFile={(p) => void openFile(p)}
      onAddModels={() => {
        setFocusAdd(Date.now());
        openSettings("models");
      }}
      lockedIds={locked.map((m) => m.id)}
      onEnableModel={(id) => {
        setFocusModel({ id, n: Date.now() });
        openSettings("models");
      }}
      autoConfig={autoFor(autoCfgs, source)}
      onAutoConfig={changeAuto}
      autoModel={model === "auto" ? autoModel : undefined}
      spend={spend}
      onAutoMore={() => {
        setFocusAuto(Date.now());
        openSettings("models");
      }}
    />
  );

  const capUsd = autoFor(autoCfgs, source).budget_usd;
  const budgetBanner =
    budgetHit && model === "auto" ? (
      <div className="budget-banner" role="alert">
        <span>
          {t("budget.hit", { cap: capUsd ? ` ${fmtUsd(capUsd)}` : "", used: fmtUsd(spend.usd) })}
        </span>
        <button
          type="button"
          onClick={() => {
            const cfg = autoFor(autoCfgs, source);
            const base = Math.max(cfg.budget_usd ?? 0, spend.usd);
            changeAuto({ ...cfg, budget_usd: Math.ceil(base * 1.5 * 100) / 100 || 1 });
            setBudgetHit(false);
          }}
        >
          {t("budget.raise")}
        </button>
        <button type="button" onClick={() => void continuePastCap()}>
          {t("budget.once")}
        </button>
        <button
          type="button"
          className="budget-banner-close"
          title={t("budget.close")}
          onClick={() => setBudgetHit(false)}
        >
          ×
        </button>
      </div>
    ) : null;

  const chatMain = (
    <div className={showReview ? "chat-split" : "chat-col-fill"}>
      <div className="chat-col">
        <ChatPane
          transcript={prefs.transcript}
          lines={lines}
          plan={plan}
          perm={permHere}
          sandboxNote={autonomousFallbackNote(permMode, sandbox, t)}
          onOpenPermissions={() => openSettings("permissions")}
          diff={diff}
          sessionId={sessionId}
          hasSession={Boolean(sessionId)}
          wsName={wsName}
          workspace={workspace || undefined}
          busy={busyHere}
          run={busyHere ? run : null}
          mode={mode}
          onOpenFile={(p) => void openFile(p)}
          onSwitchAndRun={(m, text) => {
            // Đổi mode rồi gửi lại đúng prompt cũ; vẫn qua xin quyền và diff như thường.
            setMode(m);
            void send(text, m);
          }}
          onApprovePlan={() => void approvePlan()}
          onRevisePlan={revisePlan}
          permBusy={permBusy}
          permError={permError}
          onAllow={(scope) => void answerPerm(true, scope)}
          onDeny={() => void answerPerm(false, "once")}
          onApplyDiff={() => void applyDiff()}
          onRejectDiff={() => void rejectDiff()}
          onShowDiff={() => {
            setReviewOpen(true);
            setShowChangesSignal((n) => n + 1);
          }}
          onRestoreCheckpoint={(id) => void restoreCheckpoint(id)}
          onForkChat={(endLine) => void forkChat(endLine)}
          onForkFrom={(userLine) => void forkFrom(userLine)}
          onRewind={(userLine) => void rewindTo(userLine)}
          onRetryTurn={(userLine) => void rewindTo(userLine, true)}
          onAttachMessage={attachMessage}
          onOpenWorkspace={() => void openWorkspace()}
          onChip={onChip}
          onUsePrompt={setPrompt}
          onSwitchModel={() => {
            setFocusSources(Date.now());
            openSettings("models");
          }}
          onRetry={(text) => {
            const again = text ?? lastPromptRef.current;
            // Lỗi đã trả prompt về composer: gửi lại thì dọn đi để không gửi trùng lần nữa.
            setPrompt((p) => (p.trim() === again.trim() ? "" : p));
            void send(again);
          }}
          onAttachEdited={attachEdited}
        />
        {activeThreadId ? budgetBanner : null}
        {activeThreadId ? composerEl : null}
      </div>
      {showReview ? (
        <DiffPane
          tree={tree}
          file={file}
          fileText={fileText}
          diff={diff}
          language={editorLang}
          onOpenFile={(p) => void openFile(p)}
          onChange={setFileText}
          onApply={() => void applyDiff()}
          onReject={() => void rejectDiff()}
          onClose={() => {
            setReviewOpen(false);
            if (!diff) setFile(null);
          }}
          onReviewTab={setReviewSub}
          showChangesSignal={showChangesSignal}
          code={{ font: prefs.codeFont, size: prefs.codeFontSize, minimap: prefs.minimap }}
        />
      ) : null}
    </div>
  );

  const chatHidden = shellView === "hidden";
  const showHistory = !chatHidden && !historyHidden;

  function toggleHistory() {
    if (chatHidden) {
      setHistoryHidden(false);
      setShellView("chat");
      return;
    }
    setHistoryHidden((v) => !v);
  }

  return (
    <LangContext.Provider value={appearance.lang}>
    <div
      className={`app view-${shellView}${!chatHidden && historyHidden ? " no-history" : ""}`}
      data-wp={appearance.wallpaper}
      data-blur={appearance.blur ? "on" : "off"}
      style={wp ? ({ ["--wp" as string]: wp } as CSSProperties) : undefined}
    >
      <TooltipLayer />
      {lightbox ? (
        <ImageLightbox images={lightbox.images} index={lightbox.index} onClose={() => setLightbox(null)} />
      ) : null}
      <TitleBar
        wsName={wsName}
        chatHidden={chatHidden}
        panelOpen={panelOpen}
        historyHidden={historyHidden}
        canBack={threadIdx >= 0 && threadIdx < openTabs.length - 1}
        canForward={threadIdx > 0}
        onBack={() => {
          const t = openTabs[threadIdx + 1];
          if (t) selectThread(t.id);
        }}
        onForward={() => {
          const t = openTabs[threadIdx - 1];
          if (t) selectThread(t.id);
        }}
        onTogglePanel={() => setPanelOpen((v) => !v)}
        onOpenTerminal={() => {
          setPanelTab("terminal");
          setPanelOpen(true);
        }}
        onToggleChatWorkspace={() => setShellView((v) => (v === "chat" ? "hidden" : "chat"))}
        onToggleHistory={toggleHistory}
        onSettings={() => openSettings()}
        evals={
          evalsAvailable
            ? (() => {
                const p = liveProgress(evals.live);
                return {
                  open: showEvals && !chatHidden,
                  running: Boolean(evals.live?.running),
                  progress: t("evals.running", { done: p.done, total: p.total, usd: fmtUsd(p.usd) }),
                  onToggle: toggleEvals,
                };
              })()
            : undefined
        }
        onOpenWorkspace={() => void openWorkspace()}
        onQuit={() => void window.silence?.window.close()}
      />
      <div className="shell">
        <main className="workspace">
          {!chatHidden ? (
            <ChatTabBar
              tabs={openTabs}
              activeId={activeThreadId}
              canNew={Boolean(workspace)}
              onNew={() => void newChat()}
              onSelect={selectThread}
              onClose={closeTab}
              historyHidden={historyHidden}
              onToggleHistory={toggleHistory}
            />
          ) : null}
          <div className="work-body">
            {chatHidden ? null : showEvals ? (
              <EvalsPage
                models={models}
                live={evals.live}
                ended={evals.ended}
                onStopping={evals.markStopping}
                onClose={() => setShowEvals(false)}
              />
            ) : (
              chatMain
            )}
          </div>
          <BottomPanel
            open={panelOpen}
            tab={panelTab}
            onTab={setPanelTab}
            onClose={() => setPanelOpen(false)}
            termRef={setTermEl}
            output={outputLog}
            procs={procs}
            browser={browserView}
            onStopProc={(id) => {
              if (!sessionId) return;
              void window.silence.rpc("proc.stop", { session_id: sessionId, id }).catch((e: unknown) => {
                const message = e instanceof Error ? e.message : String(e);
                setOutputLog((xs) => [...xs.slice(-199), `[error] proc.stop ${id}: ${message}`]);
              });
            }}
            onOpenUrl={(url) => {
              if (isLocalUrl(url)) void window.silence.openExternal(url);
            }}
          />
        </main>

        {confirmReq ? (
          <ConfirmDialog
            title={confirmReq.title}
            body={confirmReq.body}
            confirmLabel={confirmReq.confirmLabel}
            danger={confirmReq.danger}
            icon={confirmReq.icon}
            onResult={answerConfirm}
          />
        ) : null}
        {undoDel ? (
          <UndoToast
            key={undoDel.thread.id}
            title={shownTitle(undoDel.thread.title, t)}
            onUndo={undoDelete}
            onDismiss={() => setUndoDel(null)}
          />
        ) : null}
        {showHistory ? (
          <ChatHistoryPanel
            workspace={workspace}
            threads={threads}
            activeId={activeThreadId}
            runState={busy ? (perm && !run?.stopping ? "waiting" : "running") : undefined}
            runId={runThreadId}
            onNewChat={() => void newChat()}
            onSelect={selectThread}
            onDelete={deleteThread}
            onRename={renameThread}
            onPin={(id, pinned) => patchThread(id, { pinned })}
            onMarkUnread={(id, unread) => patchThread(id, { unread })}
            onArchive={archiveThread}
            onOpenInTab={openInNewTab}
            onFork={(id) => void forkThread(id)}
            forkDisabled={busy}
            onCustomize={() => openSettings()}
            onToggle={toggleHistory}
          />
        ) : null}
      </div>
      {settings ? (
        <SettingsDialog
          open={settings}
          onClose={() => setSettings(null)}
          appearance={appearance}
          onAppearance={setAppearance}
          prefs={prefs}
          onPrefs={setPrefs}
          chatCount={threads.length}
          onClearHistory={clearHistory}
          onOpenEvals={
            evalsAvailable
              ? () => {
                  openEvals();
                  setSettings(null);
                }
              : undefined
          }
          workspace={workspace}
          sandbox={sandbox}
          onRefreshSandbox={refreshSandbox}
          onSetupSandbox={setupSandbox}
          permMode={permMode}
          onPermMode={(m) => {
            setPermMode(m);
            savePermMode(m);
            // Áp dụng ngay cho phiên đang mở (các phiên khác đồng bộ ở lượt gửi kế tiếp).
            if (sessionId) {
              void window.silence.rpc("session.set_permission", { session_id: sessionId, permission: m }).catch(() => undefined);
            }
          }}
          models={{
            catalog: models,
            prefs: modelPrefs,
            onPrefs: setModelPrefs,
            activeModel: model,
            onSourcesChanged: loadModels,
            focus: focusModel,
            autoConfigs: autoCfgs,
            onAutoConfig: changeAutoFor,
            activeSource: source,
            spentUsd: spend.usd,
            focusAuto,
            focusAdd,
            focusSources,
          }}
        />
      ) : null}
    </div>
    </LangContext.Provider>
  );
}
