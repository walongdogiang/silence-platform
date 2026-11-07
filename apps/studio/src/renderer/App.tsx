import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import mountains from "./assets/wallpapers/mountains.png";
import { AppearancePanel } from "./components/AppearancePanel";
import { BottomPanel, type PanelTab } from "./components/BottomPanel";
import { ChatHistoryPanel, HISTORY_KEY, loadThreads, previewFrom, titleFrom } from "./components/ChatHistoryPanel";
import { ChatPane } from "./components/ChatPane";
import { ChatTabBar } from "./components/ChatTabBar";
import { Composer } from "./components/Composer";
import { DiffPane } from "./components/DiffPane";
import { NetworkPanel } from "./components/NetworkPanel";
import { TitleBar } from "./components/TitleBar";
import {
  briefFromNarrations,
  filesToRestore,
  briefFromThinkingBody,
  isPlanningVerb,
  narrateToPast,
  narrateToolLive,
  newCheckpointId,
  parseNarrateLegacy,
  planningStep,
  thinkingLiveStep,
  type NarrateStep,
} from "./chatMeta";
import type { ChatLine, ChatThread, CheckpointFile, Diff, Perm, ShellView } from "./models";
import {
  applyAppearance,
  loadAppearance,
  saveAppearance,
  type Appearance,
} from "./theme/appearance";
import { loadModelPrefs, saveModelPrefs, visibleModels } from "./theme/modelsPrefs";
import type { ModelInfo, SessionEvent } from "./types";

function loadShellView(): ShellView {
  const v = localStorage.getItem("silence.shell.view");
  return v === "hidden" || v === "explorer" ? "hidden" : "chat";
}

function loadOpenTabs(): string[] {
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
    const step = l.verb ? { verb: l.verb, detail: l.detail } : parseNarrateLegacy(l.text ?? "");
    if (isPlanningVerb(step.verb) || /^Thinking$/i.test(step.verb) || /^Thought$/i.test(step.verb)) return [];
    const past = narrateToPast(step);
    return [{ kind: "narrate", verb: past.verb, detail: past.detail }];
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
  const [shellView, setShellView] = useState<ShellView>(() => loadShellView());
  const [showNetwork, setShowNetwork] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => localStorage.getItem("silence.shell.panel") === "1");
  const [panelTab, setPanelTab] = useState<PanelTab>("terminal");
  const [outputLog, setOutputLog] = useState<string[]>([]);
  const [historyHidden, setHistoryHidden] = useState(() => localStorage.getItem("silence.shell.history") === "1");
  const [appearOpen, setAppearOpen] = useState(false);

  const [workspace, setWorkspace] = useState(() => localStorage.getItem("silence.shell.workspace") ?? "");
  const [sessionId, setSessionId] = useState("");
  const [model, setModel] = useState("auto");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelPrefs, setModelPrefs] = useState(() => loadModelPrefs());
  const [mode, setMode] = useState<"agent" | "plan">("agent");
  const [tree, setTree] = useState<string[]>([]);
  const [file, setFile] = useState<string | null>(null);
  const [fileText, setFileText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [diff, setDiff] = useState<Diff | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [perm, setPerm] = useState<Perm | null>(null);
  const [cost, setCost] = useState({ usd: 0, input_tokens: 0, output_tokens: 0, events: 0 });
  const [busy, setBusy] = useState(false);
  const termRef = useRef<HTMLDivElement | null>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const turnStartedAtRef = useRef(0);
  const turnFilesRef = useRef<CheckpointFile[]>([]);
  const thoughtStartedAtRef = useRef(0);
  const lastPromptRef = useRef("");
  const [termEl, setTermEl] = useState<HTMLDivElement | null>(null);
  const [reviewSub, setReviewSub] = useState<"changes" | "tests" | "logs" | "preview">("changes");
  const [threads, setThreads] = useState<ChatThread[]>(() => loadThreads());
  const [openTabIds, setOpenTabIds] = useState<string[]>(() => loadOpenTabs());
  const [activeThreadId, setActiveThreadId] = useState("");

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
    localStorage.setItem(HISTORY_KEY, JSON.stringify(threads));
  }, [threads]);

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
              title: titleFrom(lines, t.title),
              preview: previewFrom(lines),
              updatedAt: Date.now(),
            }
          : t,
      ),
    );
  }, [lines, sessionId, activeThreadId]);

  useEffect(() => {
    if (activeThreadId) return;
    const t = openTabIds
      .map((id) => threads.find((x) => x.id === id))
      .find((x) => x && (!workspace || x.workspace === workspace));
    if (!t) return;
    setActiveThreadId(t.id);
    setSessionId(t.sessionId);
    setLines(t.lines);
  }, [activeThreadId, openTabIds, threads, workspace]);

  useEffect(() => {
    if (!window.silence) {
      setLines([{ kind: "sys", text: "Preload không gắn được. Chạy lại npm run desktop." }]);
      return;
    }
    return window.silence.onEvent((payload) => {
      const p = payload as { session_id?: string; event?: SessionEvent };
      const ev = p.event;
      if (!ev) return;
      if (p.session_id && p.session_id !== sessionIdRef.current) return;
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
            next[next.length - 1] = { kind: "narrate", verb: step.verb, detail: step.detail };
            return next;
          }
          if (last?.kind === "narrate") {
            const prev = last.verb
              ? { verb: last.verb, detail: last.detail }
              : parseNarrateLegacy(last.text ?? "");
            if (
              !isPlanningVerb(prev.verb) &&
              !/^Thought$/i.test(prev.verb) &&
              !/^Thinking$/i.test(prev.verb)
            ) {
              const past = narrateToPast(prev);
              next[next.length - 1] = { kind: "narrate", verb: past.verb, detail: past.detail };
            }
          }
          next.push({ kind: "narrate", verb: step.verb, detail: step.detail });
          return next;
        });
      } else if (ev.type === "tool_end") {
        setLines((xs) => [...xs, { kind: "tool", name: ev.name, output: ev.output }]);
      } else if (ev.type === "route") {
        setLines((xs) => [...xs, { kind: "route", text: `${ev.task_class} → ${ev.model_id}` }]);
      } else if (ev.type === "plan") {
        setPlan(ev.markdown);
      } else if (ev.type === "diff") {
        const fileDiff = { path: ev.path, before: ev.before, after: ev.after };
        const prev = turnFilesRef.current.filter((f) => f.path !== ev.path);
        turnFilesRef.current = [...prev, fileDiff];
        setDiff(fileDiff);
      } else if (ev.type === "permission") {
        setPerm({ request_id: ev.request_id, name: ev.name, input: ev.input, reason: ev.reason });
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
        // Giữ prompt: trả lại câu vừa gửi nếu composer đang trống. Không auto-retry.
        const last = lastPromptRef.current;
        setPrompt((p) => (p.trim() ? p : last));
      } else if (ev.type === "done") {
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
        void refreshCost();
      } else if (ev.type === "cost") {
        setCost((c) => ({
          ...c,
          usd: c.usd + ev.usd,
          input_tokens: c.input_tokens + ev.input_tokens,
          output_tokens: c.output_tokens + ev.output_tokens,
        }));
      }
    });
  }, []);

  useEffect(() => {
    if (!window.silence) return;
    void window.silence
      .rpc("models.list")
      .then((r) => setModels((r as { models: ModelInfo[] }).models ?? []))
      .catch((err: Error) => setLines((xs) => [...xs, { kind: "sys", text: String(err.message ?? err) }]));
  }, []);

  useEffect(() => {
    saveModelPrefs(modelPrefs);
  }, [modelPrefs]);

  useEffect(() => {
    if (!termEl) return;
    const t = new Terminal({
      theme: { background: "#191A1C", foreground: "#F0EFEC", cursor: "#E5A05B" },
      fontSize: 12,
      fontFamily: "Cascadia Code, Consolas, monospace",
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
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shellView]);

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
    const created = (await window.silence.rpc("session.create", {
      workspace: dir,
      model,
      mode,
      permission: "ask",
    })) as { session_id: string };
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
    opts?: { forkedFromId?: string; title?: string },
  ) {
    const id = crypto.randomUUID();
    const baseTitle = opts?.title?.trim() || titleFrom(initial);
    const thread: ChatThread = {
      id,
      sessionId: liveSessionId,
      workspace: dir,
      title: opts?.forkedFromId ? (baseTitle.startsWith("Fork · ") ? baseTitle : `Fork · ${baseTitle}`) : baseTitle,
      preview: previewFrom(initial),
      updatedAt: Date.now(),
      lines: initial,
      forkedFromId: opts?.forkedFromId,
    };
    setActiveThreadId(id);
    setSessionId(liveSessionId);
    setLines(initial);
    setPlan(null);
    setDiff(null);
    setPerm(null);
    setPrompt("");
    setBusy(false);
    setShowNetwork(false);
    setShellView("chat");
    setOpenTabIds((ids) => [id, ...ids.filter((x) => x !== id)]);
    setThreads((xs) => [thread, ...xs]);
    focusComposer();
  }

  async function forkChat(endLineInclusive: number) {
    if (!workspace || busy) return;
    const parentId = activeThreadId;
    if (!parentId) return;
    const cut = Math.max(0, Math.min(endLineInclusive, lines.length - 1));
    const sliced = lines.slice(0, cut + 1).map((l) => ({ ...l }));
    if (sliced.length === 0) return;
    snapshotActive();
    const parent = threads.find((t) => t.id === parentId);
    const liveId = await createLiveSession(workspace);
    beginThread(workspace, liveId, sliced, {
      forkedFromId: parentId,
      title: titleFrom(sliced, parent?.title ?? "Đoạn chat"),
    });
    await refreshCost();
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

  async function newChat() {
    if (!workspace) return;
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
              title: titleFrom(lines, x.title),
              preview: previewFrom(lines),
              updatedAt: Date.now(),
            }
          : x,
      ),
    );
  }

  function selectThread(id: string) {
    const t = threads.find((x) => x.id === id);
    if (!t) return;
    setShellView("chat");
    setShowNetwork(false);
    rememberThread(id);
    if (id !== activeThreadId) {
      snapshotActive();
      setActiveThreadId(id);
      setSessionId(t.sessionId);
      setLines(t.lines);
      setPlan(null);
      setDiff(null);
      setPerm(null);
      setPrompt("");
      if (workspace && !t.sessionId) {
        void createLiveSession(workspace).then((liveId) => {
          setSessionId(liveId);
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
      setActiveThreadId(next.id);
      setSessionId(next.sessionId);
      setLines(next.lines);
      setPlan(null);
      setDiff(null);
      setPerm(null);
      setPrompt("");
      return;
    }
    setActiveThreadId("");
    setSessionId("");
    setLines([]);
    setPlan(null);
    setDiff(null);
    setPerm(null);
  }

  function deleteThread(id: string) {
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
      setSessionId(next.sessionId);
      setLines(next.lines);
      return;
    }
    setOpenTabIds(nextOpenIds);
    void newChat();
  }

  async function openFile(rel: string) {
    if (!workspace) return;
    setFile(rel);
    setShowNetwork(false);
    const r = (await window.silence.rpc("fs.read", { workspace, path: rel })) as { text: string };
    setFileText(r.text);
  }

  async function send(retryText?: string) {
    const text = (retryText ?? prompt).trim();
    if (!sessionId || !text || busy) return;
    lastPromptRef.current = text;
    if (retryText === undefined) setPrompt("");
    turnStartedAtRef.current = Date.now();
    turnFilesRef.current = [];
    thoughtStartedAtRef.current = Date.now();
    const plan = planningStep();
    setLines((xs) => [
      ...xs,
      { kind: "user", text },
      { kind: "narrate", verb: plan.verb, detail: plan.detail },
    ]);
    setBusy(true);
    try {
      await window.silence.rpc("session.prompt", { session_id: sessionId, text });
    } catch (e) {
      // RPC bị từ chối (vd. Engine chưa sẵn sàng): tắt busy, trả prompt, hiện thẻ lỗi chung.
      const message = e instanceof Error ? e.message : String(e);
      turnStartedAtRef.current = 0;
      thoughtStartedAtRef.current = 0;
      setLines((xs) => [...xs, { kind: "error", message }]);
      setOutputLog((xs) => [...xs.slice(-199), `[error] ${message}`]);
      setBusy(false);
      setPrompt((p) => (p.trim() ? p : text));
    }
  }

  async function applyDiff() {
    if (!sessionId || !diff) return;
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
        "Không áp dụng được thay đổi. Thử Apply lại hoặc Reject rồi để agent đề xuất lại.",
      ]);
    }
  }

  async function rejectDiff() {
    if (!sessionId || !diff) return;
    try {
      await window.silence.rpc("diff.reject", {
        session_id: sessionId,
        path: diff.path,
      });
      setDiff(null);
    } catch {
      setOutputLog((xs) => [
        ...xs.slice(-199),
        "Không hủy được thay đổi. Thử Reject lại.",
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
    const ok = window.confirm(
      "Khôi phục checkpoint này? Hội thoại sau điểm này sẽ bị cắt; file đã đổi ở các lượt sau sẽ được ghi lại nội dung trước đó.",
    );
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
        setOutputLog((xs) => [...xs.slice(-199), `Restore failed: ${f.path}`]);
      }
    }

    const idx = lines.findIndex((l) => l.kind === "checkpoint" && l.id === id);
    if (idx >= 0) {
      setLines(lines.slice(0, idx + 1));
    }
    setDiff(null);
    setPlan(null);
    setPerm(null);
    turnFilesRef.current = [];
    turnStartedAtRef.current = 0;
    setBusy(false);
  }

  function onChip(chip: string) {
    if (chip === "Plan") setMode("plan");
    else if (chip === "Code" || chip === "Agent") setMode("agent");
    else if (chip === "More") setAppearOpen(true);
  }

  function answerPerm(allow: boolean) {
    if (!perm || !sessionId) return;
    void window.silence.rpc("session.permission", {
      session_id: sessionId,
      request_id: perm.request_id,
      allow,
      remember: allow,
    });
    setPerm(null);
  }

  function approvePlan() {
    if (!sessionId) return;
    void window.silence.rpc("session.approve_plan", { session_id: sessionId });
    setPlan(null);
    setMode("agent");
    setLines((xs) => [...xs, { kind: "sys", text: "Plan đã duyệt — agent sẽ implement." }]);
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
  const showReview = Boolean(diff || file);
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
  const pickerModels = visibleModels(models, modelPrefs);
  const composerEl = (
    <Composer
      prompt={prompt}
      onPrompt={setPrompt}
      onSend={() => void send()}
      onChip={onChip}
      mode={mode}
      model={model}
      models={pickerModels}
      onModel={setModel}
      busy={busy}
      disabled={!sessionId}
      files={tree}
      tokens={cost.input_tokens}
      onOpenFile={(p) => void openFile(p)}
      onAddModels={() => {
        setShowNetwork(true);
        setShellView("chat");
      }}
    />
  );

  const chatMain = (
    <div className={showReview ? "chat-split" : "chat-col-fill"}>
      <div className="chat-col">
        <ChatPane
          lines={lines}
          plan={plan}
          perm={perm}
          diff={diff}
          sessionId={sessionId}
          hasSession={Boolean(sessionId)}
          wsName={wsName}
          busy={busy}
          onApprovePlan={approvePlan}
          onAllow={() => answerPerm(true)}
          onDeny={() => answerPerm(false)}
          onApplyDiff={() => void applyDiff()}
          onRejectDiff={() => void rejectDiff()}
          onRestoreCheckpoint={(id) => void restoreCheckpoint(id)}
          onForkChat={(endLine) => void forkChat(endLine)}
          onOpenWorkspace={() => void openWorkspace()}
          onChip={onChip}
          onUsePrompt={setPrompt}
          onRetry={() => void send(lastPromptRef.current)}
        />
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
          onReviewTab={setReviewSub}
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
    <div
      className={`app view-${shellView}${!chatHidden && historyHidden ? " no-history" : ""}`}
      data-wp={appearance.wallpaper}
      data-blur={appearance.blur ? "on" : "off"}
      style={wp ? ({ ["--wp" as string]: wp } as CSSProperties) : undefined}
    >
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
        onSettings={() => setAppearOpen(true)}
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
            {chatHidden
              ? null
              : showNetwork
                ? (
                  <NetworkPanel catalog={models} prefs={modelPrefs} onPrefs={setModelPrefs} activeModel={model} />
                )
                : chatMain}
          </div>
          <BottomPanel
            open={panelOpen}
            tab={panelTab}
            onTab={setPanelTab}
            onClose={() => setPanelOpen(false)}
            termRef={setTermEl}
            output={outputLog}
          />
        </main>

        {showHistory ? (
          <ChatHistoryPanel
            workspace={workspace}
            threads={threads}
            activeId={activeThreadId}
            onNewChat={() => void newChat()}
            onSelect={selectThread}
            onDelete={deleteThread}
            onCustomize={() => setAppearOpen(true)}
            onToggle={toggleHistory}
          />
        ) : null}
      </div>
      <AppearancePanel
        open={appearOpen}
        value={appearance}
        onChange={setAppearance}
        onClose={() => setAppearOpen(false)}
      />
    </div>
  );
}
