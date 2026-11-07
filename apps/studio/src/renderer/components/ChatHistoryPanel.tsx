import { PanelRight, Search, SlidersHorizontal, Sparkles, Trash2, Workflow } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ChatLine, ChatThread } from "../models";
import { SoftScroll } from "./SoftScroll";

export const HISTORY_KEY = "silence.chat.history";

export function loadThreads(): ChatThread[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatThread[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function titleFrom(lines: ChatLine[], fallback = "Đoạn chat mới"): string {
  const u = lines.find((l) => l.kind === "user");
  if (u?.kind === "user" && u.text.trim()) {
    const t = u.text.trim().replace(/\s+/g, " ");
    return t.length > 48 ? `${t.slice(0, 47)}…` : t;
  }
  return fallback;
}

export function previewFrom(lines: ChatLine[]): string {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    const text = l.kind === "tool" ? l.output : "text" in l ? l.text : "";
    const t = (text ?? "").trim().replace(/\s+/g, " ");
    if (t) return t.length > 72 ? `${t.slice(0, 71)}…` : t;
  }
  return "";
}

type DayGroup = "today" | "yesterday" | "week" | "older";

const GROUP_LABEL: Record<DayGroup, string> = {
  today: "Hôm nay",
  yesterday: "Hôm qua",
  week: "Tuần này",
  older: "Trước đó",
};

const GROUP_ORDER: DayGroup[] = ["today", "yesterday", "week", "older"];

function relativeTime(ts: number, now: number): string {
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 60) return `${Math.max(1, sec)}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

/** Một đồng hồ cho cả list — interval theo item mới nhất; dừng khi tab ẩn. */
function tickMsForNewest(newestAt: number | undefined, now: number): number {
  if (newestAt == null) return 60_000;
  const age = now - newestAt;
  if (age < 60_000) return 1_000;
  if (age < 3_600_000) return 30_000;
  return 60_000;
}

function dayGroup(ts: number): DayGroup {
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startToday) return "today";
  if (ts >= startToday - 86_400_000) return "yesterday";
  if (ts >= startToday - 6 * 86_400_000) return "week";
  return "older";
}

export function ChatHistoryPanel(props: {
  workspace: string;
  threads: ChatThread[];
  activeId: string;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCustomize: () => void;
  onToggle: () => void;
}) {
  const [q, setQ] = useState("");
  const [autoHint, setAutoHint] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const newestAt = useMemo(() => {
    let max = 0;
    for (const t of props.threads) {
      if (t.workspace !== props.workspace) continue;
      if (t.updatedAt > max) max = t.updatedAt;
    }
    return max || undefined;
  }, [props.threads, props.workspace]);

  useEffect(() => {
    let id = 0;
    function clear() {
      if (id) window.clearInterval(id);
      id = 0;
    }
    function arm() {
      clear();
      if (typeof document !== "undefined" && document.hidden) return;
      const ms = tickMsForNewest(newestAt, Date.now());
      id = window.setInterval(() => {
        const t = Date.now();
        setNow(t);
        const next = tickMsForNewest(newestAt, t);
        if (next !== ms) arm();
      }, ms);
    }
    function onVis() {
      if (document.hidden) clear();
      else {
        setNow(Date.now());
        arm();
      }
    }
    arm();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clear();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [newestAt]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const items = props.threads
      .filter((t) => t.workspace === props.workspace)
      .filter((t) => !needle || t.title.toLowerCase().includes(needle) || t.preview.toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const map = new Map<DayGroup, ChatThread[]>();
    for (const t of items) {
      const g = dayGroup(t.updatedAt);
      const arr = map.get(g) ?? [];
      arr.push(t);
      map.set(g, arr);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({
      id: g,
      label: GROUP_LABEL[g],
      items: map.get(g) ?? [],
    }));
  }, [props.threads, props.workspace, q]);

  const empty = groups.every((g) => g.items.length === 0);

  return (
    <aside className="context history-panel">
      <div className="history-toolbar">
        <button
          type="button"
          className="history-toggle"
          title="Toggle Agents Side Bar (Ctrl+Alt+U)"
          aria-label="Ẩn thanh Agents"
          onClick={props.onToggle}
        >
          <PanelRight size={15} strokeWidth={1.75} />
        </button>
      </div>
      <button
        type="button"
        className="history-action"
        disabled={!props.workspace}
        onClick={props.onNewChat}
      >
        <Sparkles size={15} />
        New Agent
      </button>
      <label className="history-action history-search">
        <Search size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
      </label>
      <button
        type="button"
        className="history-action"
        title="Chưa gắn"
        onClick={() => setAutoHint(true)}
      >
        <Workflow size={15} />
        Automations
      </button>
      <button type="button" className="history-action" onClick={props.onCustomize}>
        <SlidersHorizontal size={15} />
        Customize
      </button>
      <SoftScroll className="history-list" deps={[groups, q, autoHint, props.workspace, empty, props.activeId, now]}>
        {autoHint && <p className="hint">Automations chưa gắn backend.</p>}
        {!props.workspace && <p className="hint">Mở workspace để xem lịch sử.</p>}
        {props.workspace && empty && !q && <p className="hint">Chưa có đoạn chat.</p>}
        {groups.map((g) => (
          <section key={g.id}>
            <span className="history-group">{g.label}</span>
            {g.items.map((t) => (
              <div key={t.id} className={`history-item ${t.id === props.activeId ? "active" : ""}`}>
                <button type="button" className="history-open" onClick={() => props.onSelect(t.id)}>
                  <span className={`history-dot ${t.id === props.activeId ? "on" : ""}`} />
                  <strong>{t.title}</strong>
                  <em>{relativeTime(t.updatedAt, now)}</em>
                </button>
                <button
                  type="button"
                  className="history-del"
                  title="Xóa đoạn chat"
                  aria-label="Xóa đoạn chat"
                  onClick={() => props.onDelete(t.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </section>
        ))}
      </SoftScroll>
      <div className="history-user">
        <span className="avatar">5</span>
        <div>
          <b>Local</b>
          <small>Developer</small>
        </div>
      </div>
    </aside>
  );
}
