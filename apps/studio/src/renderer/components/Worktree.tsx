import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Copy, GitBranch, GitMerge, Lock } from "lucide-react";
import { useT, type T } from "../i18n";
import { DiffStat } from "./DiffCard";
import { ConfirmDialog } from "./ConfirmDialog";

/** `session.create` → `worktree` (TS core, roadmap 1.11). */
export type WorktreeView = { path: string; branch: string; base: string; reason: "forced" | "other_running" | "dirty" };
export type WorktreeFile = { path: string; added: number; removed: number; isNew?: boolean };
export type WorktreeMode = "auto" | "on" | "off";
export type MergeOutcome = { ok: boolean; commit?: string; conflicts?: string[]; message?: string };

export function reasonText(w: WorktreeView, t: T): string {
  return t(w.reason === "forced" ? "wt.reason.forced" : w.reason === "dirty" ? "wt.reason.dirty" : "wt.reason.running");
}

/**
 * One line at the top of a chat that runs in its own worktree: branch ← base, and why.
 * The folder is in the tooltip and behind a copy button, not in the text.
 */
export function WorktreeBanner(props: { w: WorktreeView }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="wt-banner" role="note" title={props.w.path}>
      <GitBranch size={14} aria-hidden="true" />
      <span className="wt-banner-text">
        {t("wt.bannerLead")} · <code>{props.w.branch}</code> ← {props.w.base}
        <span className="muted"> · {t("wt.bannerWhy", { reason: reasonText(props.w, t) })}</span>
      </span>
      <button
        type="button"
        className="icon-btn wt-banner-copy"
        title={t("wt.copyPath")}
        aria-label={t("wt.copyPath")}
        onClick={() => {
          void navigator.clipboard?.writeText(props.w.path).then(() => setCopied(true), () => undefined);
        }}
        onMouseLeave={() => setCopied(false)}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

/** "1 file" / "2 files": the count of a worktree card's files. */
function filesText(n: number, t: T): string {
  return t(n === 1 ? "wt.files1" : "wt.files", { n });
}

/**
 * Merge card under a worktree chat (roadmap 1.11): what changed since the worktree was made, and
 * Merge into <base> / Keep the branch / Discard (asks first; the work is lost). Once merged it
 * shows what went into <base> (`merged`, kept from before the merge) and only a Close button.
 */
export function WorktreeCard(props: {
  w: WorktreeView;
  files: WorktreeFile[];
  commits: number;
  busy?: boolean;
  outcome?: MergeOutcome | null;
  /** Files as they were when the merge ran; the branch shows none after it. */
  merged?: WorktreeFile[];
  onMerge: () => void;
  onKeep: () => void;
  onDiscard: () => void;
  onClose?: () => void;
}) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  const done = Boolean(props.outcome?.ok);
  const files = done ? (props.merged ?? []) : props.files;
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  const title = done
    ? t("wt.mergedTitle", { files: filesText(files.length, t), base: props.w.base, commit: props.outcome?.commit ?? "" })
    : t("wt.cardTitle", { files: filesText(files.length, t), branch: props.w.branch });
  return (
    <section className={done ? "wt-card done" : "wt-card"} aria-label={t("wt.cardLabel")}>
      <header>
        {done ? <Check size={15} aria-hidden="true" /> : <GitMerge size={15} aria-hidden="true" />}
        <strong role={done ? "status" : undefined}>{title}</strong>
        <DiffStat added={added} removed={removed} />
      </header>
      <ul className="wt-files">
        {files.slice(0, 30).map((f) => (
          <li key={f.path}>
            <code>{f.path}</code>
            {f.isNew ? <span className="lesson-new">{t("lesson.newFile")}</span> : <DiffStat added={f.added} removed={f.removed} />}
          </li>
        ))}
        {files.length > 30 ? <li className="muted">{t("wt.more", { n: files.length - 30 })}</li> : null}
      </ul>
      {props.outcome && !props.outcome.ok ? (
        <div className="perm-error" role="alert">
          {props.outcome.conflicts?.length ? (
            <>
              {t("wt.conflict")}
              <ul>
                {props.outcome.conflicts.map((c) => (
                  <li key={c}>
                    <code>{c}</code>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            props.outcome.message
          )}
        </div>
      ) : null}
      {done ? (
        <div className="row wt-actions">
          <p className="muted wt-done-note">{t("wt.mergedNote")}</p>
          {props.onClose ? (
            <button type="button" className="ghost" onClick={props.onClose}>
              {t("common.close")}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="row wt-actions">
          <button type="button" className="primary" disabled={props.busy || !props.files.length} onClick={props.onMerge}>
            {t("wt.merge", { base: props.w.base })}
          </button>
          <button type="button" className="ghost" disabled={props.busy} onClick={props.onKeep}>
            {t("wt.keep")}
          </button>
          <button type="button" className="ghost" disabled={props.busy} onClick={() => setConfirm(true)}>
            {t("wt.discard")}
          </button>
        </div>
      )}
      {confirm ? (
        <ConfirmDialog
          title={t("wt.discardTitle")}
          body={t("wt.discardBody", { branch: props.w.branch, path: props.w.path })}
          confirmLabel={t("wt.discard")}
          danger
          onResult={(ok) => {
            setConfirm(false);
            if (ok) props.onDiscard();
          }}
        />
      ) : null}
    </section>
  );
}

const MODES: { id: WorktreeMode; label: "wt.mode.auto" | "wt.mode.on" | "wt.mode.off"; desc: "wt.mode.autoDesc" | "wt.mode.onDesc" | "wt.mode.offDesc" }[] = [
  { id: "auto", label: "wt.mode.auto", desc: "wt.mode.autoDesc" },
  { id: "on", label: "wt.mode.on", desc: "wt.mode.onDesc" },
  { id: "off", label: "wt.mode.off", desc: "wt.mode.offDesc" },
];

/** Per-chat worktree switch next to the chat input: Auto / Always / Never; locked after the first message. */
export function WorktreeMenu(props: { mode: WorktreeMode; onMode: (m: WorktreeMode) => void; locked: boolean; active: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const cur = MODES.find((m) => m.id === props.mode) ?? MODES[0]!;
  return (
    <div className="mode-dd" ref={ref}>
      <button
        type="button"
        className={`mode-trigger perm-trigger wt-trigger${props.active ? " wt-on" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t("wt.menu")}: ${t(cur.label)}`}
        data-tip={props.locked ? t("wt.locked") : t(cur.desc)}
        disabled={props.locked}
        onClick={() => setOpen((v) => !v)}
      >
        {props.locked ? <Lock size={12} /> : <GitBranch size={14} />}
        <span>{props.active ? t("wt.inWorktree") : t(cur.label)}</span>
        {props.locked ? null : <ChevronDown size={12} className={open ? "mode-chev open" : "mode-chev"} />}
      </button>
      {open ? (
        <div className="mode-menu" role="menu" aria-label={t("wt.menu")}>
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="menuitemradio"
              aria-checked={props.mode === m.id}
              className={`mode-item${props.mode === m.id ? " active" : ""}`}
              title={t(m.desc)}
              onClick={() => {
                setOpen(false);
                if (m.id !== props.mode) props.onMode(m.id);
              }}
            >
              <GitBranch size={14} />
              <span>{t(m.label)}</span>
              {props.mode === m.id ? <Check size={13} className="mode-check" /> : <span />}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
