import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  CircleDot,
  FileText,
  GitFork,
  Hash,
  MoreHorizontal,
  PanelRight,
  PanelTop,
  Pencil,
  Pin,
  PinOff,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Workflow,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { translate, useT, type MsgKey, type T } from "../i18n";
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

/** Title from the first user message; `fallback` (e.g. "New chat" in the UI language) when there is none. */
export function titleFrom(lines: ChatLine[], fallback: string): string {
  const u = lines.find((l) => l.kind === "user");
  if (u?.kind === "user" && u.text.trim()) {
    const t = u.text.trim().replace(/\s+/g, " ");
    // Viết hoa chữ đầu (Unicode: "sửa" → "Sửa"); chỉ đụng ký tự đầu, giữ nguyên phần còn lại.
    const first = Array.from(t)[0] ?? "";
    const cased = first.toLocaleUpperCase() + t.slice(first.length);
    return cased.length > 48 ? `${cased.slice(0, 47)}…` : cased;
  }
  return fallback;
}

/** Default titles of both languages ("Đoạn chat" = older builds), shown in the current UI language. */
const DEFAULT_TITLES = new Set([translate("vi", "history.newChat"), translate("en", "history.newChat"), "Đoạn chat"]);

/** Stored title as shown: a default "New chat" follows the UI language (also after "Fork · "). */
export function shownTitle(title: string, t: T): string {
  const fork = title.startsWith("Fork · ") ? "Fork · " : "";
  const rest = title.slice(fork.length);
  return DEFAULT_TITLES.has(rest) ? fork + t("history.newChat") : title;
}

/** Tiêu đề đã chốt (AI sinh hoặc user đổi tay) thì không tính lại từ prompt. */
export function titleLocked(t: Pick<ChatThread, "titleSource" | "forkedFromId">): boolean {
  return t.titleSource === "ai" || t.titleSource === "user" || Boolean(t.forkedFromId);
}

/**
 * Lượt đầu tiên có câu trả lời (câu hỏi + trả lời) để Engine sinh tiêu đề.
 * Bỏ qua lượt lỗi không có chữ nào. `null` nếu chưa lượt nào được trả lời.
 */
export function firstExchange(lines: ChatLine[]): { user: string; reply: string } | null {
  let user = "";
  let reply = "";
  for (const l of lines) {
    if (l.kind === "user") {
      if (user && reply.trim()) break;
      user = l.text.trim();
      reply = "";
    } else if (l.kind === "token" && user) {
      reply += l.text;
    }
  }
  return user && reply.trim() ? { user, reply } : null;
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

/** Đoạn chat dạng Markdown (menu ⋯ → Copy dạng Markdown). Bỏ dòng nội bộ (route, narrate…). */
export function threadMarkdown(thread: Pick<ChatThread, "title" | "lines">): string {
  const out: string[] = [`# ${thread.title}`];
  let reply = "";
  let inReply = false;
  const flush = () => {
    if (reply.trim()) out.push(reply.trim());
    reply = "";
  };
  const openReply = () => {
    if (!inReply) {
      out.push("## Assistant");
      inReply = true;
    }
  };
  for (const l of thread.lines) {
    if (l.kind === "user") {
      flush();
      inReply = false;
      out.push("## User", l.text.trim() || "_(image)_");
    } else if (l.kind === "token") {
      openReply();
      reply += l.text;
    } else if (l.kind === "tool") {
      openReply();
      flush();
      const body = l.output.length > 400 ? `${l.output.slice(0, 399)}…` : l.output;
      out.push(`\`${l.name}\``, "```\n" + body.trimEnd() + "\n```");
    } else if (l.kind === "error") {
      openReply();
      flush();
      out.push(`> Error: ${l.message}`);
    }
  }
  flush();
  return out.join("\n\n") + "\n";
}

type DayGroup = "today" | "yesterday" | "week" | "older";
type GroupId = DayGroup | "pinned";

const GROUP_LABEL: Record<GroupId, MsgKey> = {
  pinned: "history.pinned",
  today: "history.today",
  yesterday: "history.yesterday",
  week: "history.week",
  older: "history.older",
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

/**
 * Nhóm lịch sử của một workspace: "Đã ghim" đầu tiên, rồi theo ngày; chat lưu trữ tách riêng
 * (`archived`). Chat chưa gửi gì không vào lịch sử. `needle` lọc cả nhóm lưu trữ.
 */
export function groupThreads(
  threads: ChatThread[],
  workspace: string,
  needle: string,
): { groups: { id: GroupId; items: ChatThread[] }[]; archived: ChatThread[] } {
  const n = needle.trim().toLowerCase();
  const items = threads
    .filter((t) => t.workspace === workspace)
    // Chat chưa gửi gì thì chưa vào lịch sử (như Claude); vẫn hiện ở tab.
    .filter((t) => t.lines.length > 0)
    .filter((t) => !n || t.title.toLowerCase().includes(n) || t.preview.toLowerCase().includes(n))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const map = new Map<GroupId, ChatThread[]>();
  const archived: ChatThread[] = [];
  for (const t of items) {
    if (t.archived) {
      archived.push(t);
      continue;
    }
    const g: GroupId = t.pinned ? "pinned" : dayGroup(t.updatedAt);
    const arr = map.get(g) ?? [];
    arr.push(t);
    map.set(g, arr);
  }
  const order: GroupId[] = ["pinned", ...GROUP_ORDER];
  return {
    groups: order.filter((g) => map.has(g)).map((g) => ({ id: g, items: map.get(g) ?? [] })),
    archived,
  };
}

type MenuItem =
  | "divider"
  | {
      id: string;
      label: string;
      icon: ReactNode;
      kbd?: string;
      danger?: boolean;
      disabled?: boolean;
      run: () => void;
    };

/** Menu ⋯ của một chat: vị trí fixed theo nút (không bị SoftScroll cắt), lật lên khi sát đáy. */
function HistoryItemMenu(props: {
  anchor: DOMRect;
  items: MenuItem[];
  onClose: (refocus: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<CSSProperties>(() => ({
    position: "fixed",
    top: props.anchor.bottom + 4,
    right: Math.max(8, window.innerWidth - props.anchor.right),
    visibility: "hidden",
  }));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    const right = Math.max(8, window.innerWidth - props.anchor.right);
    const below = props.anchor.bottom + 4 + h <= window.innerHeight - 8;
    setPos(
      below
        ? { position: "fixed", top: props.anchor.bottom + 4, right }
        : { position: "fixed", top: Math.max(8, props.anchor.top - 4 - h), right },
    );
    el.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [props.anchor]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) props.onClose(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") {
        e.preventDefault();
        props.onClose(true);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const btns = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
        if (!btns.length) return;
        const i = btns.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === "ArrowDown" ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
        btns[next]?.focus();
        return;
      }
      const key = e.key.toUpperCase();
      const hit = props.items.find((x) => x !== "divider" && x.kbd === key && !x.disabled);
      if (hit && hit !== "divider") {
        e.preventDefault();
        hit.run();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [props]);

  return (
    <div ref={ref} className="history-menu" role="menu" style={pos}>
      {props.items.map((x, i) =>
        x === "divider" ? (
          <hr key={`d${i}`} className="history-menu-sep" />
        ) : (
          <button
            key={x.id}
            type="button"
            role="menuitem"
            className={`history-menu-item${x.danger ? " danger" : ""}`}
            disabled={x.disabled}
            onClick={x.run}
          >
            {x.icon}
            <span>{x.label}</span>
            {x.kbd ? <kbd>{x.kbd}</kbd> : <i />}
          </button>
        ),
      )}
    </div>
  );
}

export function ChatHistoryPanel(props: {
  workspace: string;
  threads: ChatThread[];
  activeId: string;
  /** Trạng thái lượt của thread đang mở: chấm nhấp nháy (running) hoặc copper (waiting = chờ duyệt quyền). */
  runState?: "running" | "waiting";
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPin?: (id: string, pinned: boolean) => void;
  onMarkUnread?: (id: string, unread: boolean) => void;
  onArchive?: (id: string, archived: boolean) => void;
  onOpenInTab?: (id: string) => void;
  onFork?: (id: string) => void;
  /** Đang chạy lượt: Fork tạm khoá (như Fork Chat trong hội thoại). */
  forkDisabled?: boolean;
  onCustomize: () => void;
  onToggle: () => void;
}) {
  const tr = useT();
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState<{ id: string; anchor: DOMRect; trigger: HTMLElement } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [copiedId, setCopiedId] = useState("");
  const [archOpen, setArchOpen] = useState(false);

  useEffect(() => {
    if (!copiedId) return;
    const id = window.setTimeout(() => setCopiedId(""), 1200);
    return () => window.clearTimeout(id);
  }, [copiedId]);

  function closeMenu(refocus: boolean) {
    if (refocus) menu?.trigger.focus();
    setMenu(null);
    setConfirmDel(false);
  }

  function copy(id: string, text: string) {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setCopiedId(id))
      .catch(() => {});
  }

  function menuItems(t: ChatThread): MenuItem[] {
    const done = (fn: () => void) => () => {
      closeMenu(false);
      fn();
    };
    const items: MenuItem[] = [];
    if (props.onOpenInTab)
      items.push(
        {
          id: "tab",
          label: tr("history.openInTab"),
          icon: <PanelTop size={14} />,
          run: done(() => props.onOpenInTab?.(t.id)),
        },
        "divider",
      );
    if (props.onPin && !t.archived)
      items.push({
        id: "pin",
        label: tr(t.pinned ? "history.unpin" : "history.pin"),
        icon: t.pinned ? <PinOff size={14} /> : <Pin size={14} />,
        kbd: "P",
        run: done(() => props.onPin?.(t.id, !t.pinned)),
      });
    if (props.onMarkUnread)
      items.push({
        id: "unread",
        label: tr(t.unread ? "history.markRead" : "history.markUnread"),
        icon: <CircleDot size={14} />,
        kbd: "U",
        run: done(() => props.onMarkUnread?.(t.id, !t.unread)),
      });
    items.push({
      id: "rename",
      label: tr("history.renameShort"),
      icon: <Pencil size={14} />,
      kbd: "R",
      run: done(() => startRename(t)),
    });
    if (props.onFork)
      items.push({
        id: "fork",
        label: tr("history.fork"),
        icon: <GitFork size={14} />,
        kbd: "F",
        disabled: props.forkDisabled,
        run: done(() => props.onFork?.(t.id)),
      });
    items.push(
      "divider",
      {
        id: "md",
        label: tr("history.copyMarkdown"),
        icon: <FileText size={14} />,
        run: done(() => copy(t.id, threadMarkdown({ title: shownTitle(t.title, tr), lines: t.lines }))),
      },
      {
        id: "sid",
        label: tr("history.copySessionId"),
        icon: <Hash size={14} />,
        disabled: !t.sessionId,
        run: done(() => copy(t.id, t.sessionId)),
      },
      "divider",
    );
    if (props.onArchive)
      items.push({
        id: "archive",
        label: tr(t.archived ? "history.unarchive" : "history.archive"),
        icon: t.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />,
        kbd: "A",
        run: done(() => props.onArchive?.(t.id, !t.archived)),
      });
    items.push({
      id: "delete",
      label: tr(confirmDel ? "history.deleteConfirm" : "history.deleteShort"),
      icon: <Trash2 size={14} />,
      kbd: "D",
      danger: true,
      run: () => {
        if (!confirmDel) {
          setConfirmDel(true);
          return;
        }
        closeMenu(false);
        props.onDelete(t.id);
      },
    });
    return items;
  }
  const dotClass = (id: string) => {
    if (id !== props.activeId) return "history-dot";
    return props.runState ? `history-dot on ${props.runState}` : "history-dot on";
  };
  const dotTitle = (id: string) =>
    id === props.activeId && props.runState
      ? props.runState === "waiting"
        ? tr("history.waiting")
        : tr("history.running")
      : undefined;
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState("");

  function startRename(t: ChatThread) {
    setEditingId(t.id);
    setDraft(t.title);
  }

  function commitRename() {
    if (!editingId) return;
    const id = editingId;
    const t = props.threads.find((x) => x.id === id);
    setEditingId("");
    if (t && draft.trim() && draft.trim() !== t.title) props.onRename(id, draft);
  }
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

  const { groups, archived } = useMemo(
    () => groupThreads(props.threads, props.workspace, q),
    [props.threads, props.workspace, q],
  );

  const empty = groups.length === 0 && archived.length === 0;
  const showArchived = archOpen || Boolean(q.trim());
  const menuThread = menu ? props.threads.find((t) => t.id === menu.id) : undefined;

  function row(t: ChatThread) {
    const open = menu?.id === t.id;
    return (
      <div
        key={t.id}
        className={`history-item${t.id === props.activeId ? " active" : ""}${t.unread ? " unread" : ""}${
          open ? " menu-open" : ""
        }${t.archived ? " archived" : ""}`}
      >
        {editingId === t.id ? (
          <div className="history-open history-rename">
            <span className={`history-dot ${t.id === props.activeId ? "on" : ""}`} />
            <input
              autoFocus
              value={draft}
              aria-label={tr("history.rename")}
              maxLength={80}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                else if (e.key === "Escape") setEditingId("");
              }}
            />
          </div>
        ) : (
          <button
            type="button"
            className="history-open"
            title={tr("history.renameTip")}
            onClick={() => props.onSelect(t.id)}
            onDoubleClick={() => startRename(t)}
          >
            <span className={`${dotClass(t.id)}${t.unread ? " unread" : ""}`} title={dotTitle(t.id)} />
            <strong>{shownTitle(t.title, tr)}</strong>
            <em>{copiedId === t.id ? tr("common.copied") : relativeTime(t.updatedAt, now)}</em>
          </button>
        )}
        <button
          type="button"
          className="history-more"
          title={tr("history.more")}
          aria-label={tr("history.more")}
          aria-haspopup="menu"
          aria-expanded={open}
          onMouseDown={(e) => {
            // Không để mousedown "ngoài menu" đóng rồi click mở lại.
            if (open) e.stopPropagation();
          }}
          onClick={(e) => {
            if (open) {
              closeMenu(false);
              return;
            }
            setConfirmDel(false);
            setMenu({ id: t.id, anchor: e.currentTarget.getBoundingClientRect(), trigger: e.currentTarget });
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
    );
  }

  return (
    <aside className="context history-panel">
      <div className="history-toolbar">
        <button
          type="button"
          className="history-toggle"
          title={tr("shell.toggleAgents")}
          aria-label={tr("shell.hideAgents")}
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
        {tr("history.newAgent")}
      </button>
      <label className="history-action history-search">
        <Search size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("history.search")} />
      </label>
      <button
        type="button"
        className="history-action"
        title={tr("common.notWiredCap")}
        onClick={() => setAutoHint(true)}
      >
        <Workflow size={15} />
        {tr("history.automations")}
      </button>
      <button type="button" className="history-action" onClick={props.onCustomize}>
        <SlidersHorizontal size={15} />
        {tr("history.customize")}
      </button>
      <SoftScroll className="history-list" deps={[groups, archived, showArchived, q, autoHint, props.workspace, empty, props.activeId, now]}>
        {autoHint && <p className="hint">{tr("history.automationsHint")}</p>}
        {!props.workspace && <p className="hint">{tr("history.noWorkspace")}</p>}
        {props.workspace && empty && !q && <p className="hint">{tr("history.empty")}</p>}
        {groups.map((g) => (
          <section key={g.id}>
            <span className="history-group">{tr(GROUP_LABEL[g.id])}</span>
            {g.items.map(row)}
          </section>
        ))}
        {archived.length > 0 && (
          <section className="history-archived">
            <button
              type="button"
              className={`history-group history-group-toggle${showArchived ? " open" : ""}`}
              aria-expanded={showArchived}
              onClick={() => setArchOpen((v) => !v)}
            >
              <ChevronRight size={12} />
              {tr("history.archived", { count: archived.length })}
            </button>
            {showArchived && archived.map(row)}
          </section>
        )}
      </SoftScroll>
      {menu && menuThread && (
        <HistoryItemMenu anchor={menu.anchor} items={menuItems(menuThread)} onClose={closeMenu} />
      )}
      <div className="history-user">
        <span className="avatar">5</span>
        <div>
          <b>{tr("history.local")}</b>
          <small>{tr("history.developer")}</small>
        </div>
      </div>
    </aside>
  );
}
