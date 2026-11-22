import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, GitBranch, GitMerge, Lock } from "lucide-react";
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

/** Line at the top of a chat that runs in its own worktree: why, where, which branch. */
export function WorktreeBanner(props: { w: WorktreeView }) {
  const t = useT();
  return (
    <div className="wt-banner" role="note">
      <GitBranch size={14} aria-hidden="true" />
      <span>
        {t("wt.banner", { reason: reasonText(props.w, t), branch: props.w.branch, base: props.w.base })} <code title={props.w.path}>{props.w.path}</code>
      </span>
    </div>
  );
}

/**
 * Merge card under a worktree chat (roadmap 1.11): what changed since the worktree was made, and
 * Merge into <base> / Keep the branch / Discard (asks first; the work is lost).
 */
export function WorktreeCard(props: {
  w: WorktreeView;
  files: WorktreeFile[];
  commits: number;
  busy?: boolean;
  outcome?: MergeOutcome | null;
  onMerge: () => void;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);
  const added = props.files.reduce((n, f) => n + f.added, 0);
  const removed = props.files.reduce((n, f) => n + f.removed, 0);
  return (
    <section className="wt-card" aria-label={t("wt.cardLabel")}>
      <header>
        <GitMerge size={15} aria-hidden="true" />
        <strong>{t("wt.cardTitle", { n: props.files.length, branch: props.w.branch })}</strong>
        <DiffStat added={added} removed={removed} />
      </header>
      <ul className="wt-files">
        {props.files.slice(0, 30).map((f) => (
          <li key={f.path}>
            <code>{f.path}</code>
            {f.isNew ? <span className="lesson-new">{t("lesson.newFile")}</span> : <DiffStat added={f.added} removed={f.removed} />}
          </li>
        ))}
        {props.files.length > 30 ? <li className="muted">{t("wt.more", { n: props.files.length - 30 })}</li> : null}
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
      {props.outcome?.ok ? (
        <p role="status" className="wt-merged">
          <Check size={13} aria-hidden="true" /> {t("wt.merged", { base: props.w.base, commit: props.outcome.commit ?? "" })}
        </p>
      ) : null}
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
