import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, FileCode2, FilePen, FilePlus2, Globe, Info, MessageSquare, Plug, SquareTerminal, Wrench, type LucideIcon } from "lucide-react";
import { diffHunks, summarizeDiff } from "../diffSummary";
import { useRiskText, useT, type T } from "../i18n";
import type { Perm } from "../models";
import { alwaysAllowText, permEscalation, permHosts, permKeyAction, permLayout, scopeLabels, tierBadge, type PermScope } from "../permissionUi";
import { languageFor, useTokens } from "../syntax";
import type { FilePreview, PermAnswer, RiskLevel } from "../types";
import { DiffTable, TokenLine } from "./CodeView";
import { DiffStat, splitPath } from "./DiffCard";

/**
 * Permission card docked above the composer (docs/frontend/chat.md "Card xin quyền"). TS core cards
 * (`risk.level`): full card (B) or one line (C, `permLayout`). Rust Engine cards keep the old layout
 * (tier badge, escalation, hosts, session/workspace scopes).
 */
export function PermissionCard(props: {
  perm: Perm;
  busy: boolean;
  error: boolean;
  /** TS core card. */
  onAnswer: (a: PermAnswer) => void;
  /** TS core card: "Deny with a note" (the composer takes the note). Absent = no such button. */
  onDenyNote?: () => void;
  /** Rust Engine card. */
  onAllow: (scope: PermScope) => void;
  onDeny: () => void;
  /** Start with details open (tests, previews). Default: folded. */
  detailsOpen?: boolean;
}) {
  return props.perm.risk?.level ? <CoreCard {...props} level={props.perm.risk.level} /> : <EngineCard {...props} />;
}

const command = (perm: Perm) => (perm.input as { command?: unknown } | null | undefined)?.command;

/** Lines a command shows before "Show all". */
export const CMD_LINES = 6;

/**
 * Real call text: the command, or the tool input as JSON. Approval is based on this, never on model
 * text. Long commands show `CMD_LINES` lines, then "Show all" (nothing is hidden for good).
 */
function CallText(props: { perm: Perm }) {
  const t = useT();
  const c = command(props.perm);
  const isCmd = typeof c === "string";
  const text = isCmd ? c : JSON.stringify(props.perm.input, null, 2);
  const lang = !isCmd ? "json" : /powershell|pwsh/i.test(props.perm.name) ? "powershell" : "shell";
  const tokens = useTokens(text, lang);
  const lines = text.split("\n");
  const [all, setAll] = useState(false);
  const long = isCmd && (lines.length > CMD_LINES || text.length > CMD_LINES * 90);
  return (
    <>
      <pre className={`${isCmd ? "perm-cmd" : "perm-input"}${long && !all ? " clamped" : ""}`}>
        <code>
          {isCmd ? <span className="perm-prompt">$ </span> : null}
          {lines.map((l, i) => (
            <Fragment key={i}>
              <TokenLine text={l} tokens={tokens?.[i]} />
              {i < lines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </code>
      </pre>
      {long && !all ? (
        <button type="button" className="perm-more-lines" onClick={() => setAll(true)}>
          {t("perm.showAll", { n: lines.length })}
        </button>
      ) : null}
    </>
  );
}

/** MCP / other tools: first-level parameters as key → value, one line each. */
function ParamTable(props: { input: unknown }) {
  const rows = props.input && typeof props.input === "object" && !Array.isArray(props.input) ? Object.entries(props.input as Record<string, unknown>) : [];
  return (
    <dl className="perm-kv">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt>{k}</dt>
          <dd title={typeof v === "string" ? v : JSON.stringify(v)}>{typeof v === "string" ? v : JSON.stringify(v)}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** Icon of the card head by what the call does. */
function headIcon(perm: Perm): LucideIcon {
  if (perm.preview) return perm.preview.before === "" ? FilePlus2 : FilePen;
  if (typeof command(perm) === "string") return SquareTerminal;
  if (typeof (perm.input as { url?: unknown } | null | undefined)?.url === "string") return Globe;
  if (perm.name.startsWith("mcp__")) return Plug;
  return Wrench;
}

const PREVIEW_ROWS = 12;

/** What a write/edit would change: file name + diff (a new file is all additions). */
export function PermPreview(props: { preview: FilePreview }) {
  const t = useT();
  const { path, before, after } = props.preview;
  const [all, setAll] = useState(false);
  const sum = useMemo(() => summarizeDiff(before, after), [before, after]);
  const hunks = useMemo(() => diffHunks(before, after), [before, after]);
  const total = hunks.reduce((n, h) => n + h.rows.length, 0);
  let budget = all ? Infinity : PREVIEW_ROWS;
  const shown = hunks
    .map((h) => {
      const rows = h.rows.slice(0, Math.max(0, budget));
      budget -= rows.length;
      return { ...h, rows };
    })
    .filter((h) => h.rows.length > 0);
  const { dir, name } = splitPath(path);
  return (
    <section className="perm-preview" aria-label={path}>
      <header className="perm-preview-head">
        <span className="diff-card-file">
          <FileCode2 size={15} aria-hidden />
          <span className="diff-path">
            {dir && <span className="dir">{dir}</span>}
            <span className="name">{name}</span>
          </span>
        </span>
        {before === "" ? <span className="perm-new">{t("perm.previewNew")}</span> : null}
        <DiffStat added={sum.added} removed={sum.removed} />
      </header>
      <div className="diff-card-body">
        <DiffTable hunks={shown} lang={languageFor(path)} />
        {total > PREVIEW_ROWS ? (
          <button type="button" className="diff-more" onClick={() => setAll((v) => !v)}>
            {all ? t("diff.collapse") : t("diff.showMore", { n: total - PREVIEW_ROWS })}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Plain question for the card head: "Allow creating hello.py?", "Allow running this command?". */
export function permHead(perm: Perm, t: T): string {
  const base = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  if (perm.preview) {
    const name = base(perm.preview.path);
    return perm.preview.before === "" ? t("perm.title.create", { name }) : t("perm.title.edit", { name });
  }
  if (typeof command(perm) === "string") return t("perm.title.shell");
  const url = (perm.input as { url?: unknown } | null | undefined)?.url;
  if (typeof url === "string") {
    try {
      return t("perm.title.fetch", { host: new URL(url).hostname });
    } catch {
      /* not a URL: fall through */
    }
  }
  const mcp = perm.name.match(/^mcp__(.+?)__(.+)$/);
  if (mcp) return t("perm.title.mcp", { tool: mcp[2]!, server: mcp[1]! });
  return t("perm.title.tool", { tool: perm.name });
}

function SendError(props: { show: boolean }) {
  const t = useT();
  return props.show ? (
    <p className="perm-error" role="alert">
      <strong>{t("perm.sendFailed")}</strong> {t("perm.sendFailedHint")}
    </p>
  ) : null;
}

export function levelLabel(level: RiskLevel, t: T): string {
  return t(level === "hard_block" ? "perm.level.hardBlock" : level === "danger" ? "perm.level.danger" : level === "caution" ? "perm.level.caution" : "perm.level.safe");
}

/** Seconds left before a Bypass countdown refuses on its own. */
function useCountdown(seconds: number | undefined): number | null {
  const [left, setLeft] = useState(seconds ?? null);
  useEffect(() => {
    if (!seconds) return;
    const end = Date.now() + seconds * 1000;
    setLeft(seconds);
    const id = window.setInterval(() => setLeft(Math.max(0, Math.ceil((end - Date.now()) / 1000))), 250);
    return () => window.clearInterval(id);
  }, [seconds]);
  return seconds ? left : null;
}

function CoreCard(props: {
  perm: Perm;
  level: RiskLevel;
  busy: boolean;
  error: boolean;
  onAnswer: (a: PermAnswer) => void;
  onDenyNote?: () => void;
  detailsOpen?: boolean;
}) {
  const t = useT();
  const text = useRiskText();
  const risk = props.perm.risk!;
  const left = useCountdown(risk.countdown_s);
  const codes = risk.codes ?? risk.reasons.map((r) => r.code);
  // Reasons worth reading: the shown ones from the core that have words (a bare code is never shown).
  const shown = (risk.reasons.length ? risk.reasons.map((r) => r.code) : codes)
    .filter((c, i, a) => a.indexOf(c) === i)
    .filter((c) => Boolean(text(c) || risk.reasons.some((x) => x.code === c)));
  const reason = (c: string) => {
    const r = text(c);
    const fb = risk.reasons.find((x) => x.code === c);
    return { title: r?.title ?? fb?.title ?? c, detail: r?.detail ?? fb?.detail ?? "", safer: r?.safer };
  };
  const first = shown[0] ? reason(shown[0]) : null;
  const red = props.level === "danger" || props.level === "hard_block";
  const isMcp = props.perm.name.startsWith("mcp__") && typeof command(props.perm) !== "string" && !props.perm.preview;
  const [expanded, setExpanded] = useState(false);
  const compact = !expanded && permLayout(props.perm) === "compact";
  const [reasonsOpen, setReasonsOpen] = useState(Boolean(props.detailsOpen));
  const [json, setJson] = useState(false);
  const [menu, setMenu] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const answer = useRef(props.onAnswer);
  answer.current = props.onAnswer;
  const busy = useRef(props.busy);
  busy.current = props.busy;
  const Icon = headIcon(props.perm);
  const title = props.perm.preview ? permHead(props.perm, t) : (first?.title ?? permHead(props.perm, t));
  const tool = risk.source && risk.source !== "agent" ? `${props.perm.name} · ${t(`perm.source.${risk.source}`)}` : props.perm.name;
  const more = shown.slice(1);
  const safer = shown.map((c) => reason(c).safer).filter((x): x is string => Boolean(x));

  // The card takes focus when it shows (not the Allow button, so a stray Enter in flight does nothing
  // twice). Esc denies while focus is on the card or nowhere in particular, never while typing elsewhere.
  useEffect(() => {
    setMenu(false);
    cardRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || busy.current) return;
      const at = document.activeElement;
      if (at && at !== document.body && !cardRef.current?.contains(at)) return;
      e.preventDefault();
      answer.current("deny");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [props.perm.request_id]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return; // the document listener above denies
    const el = e.target as HTMLElement;
    const a = permKeyAction(e.key, {
      level: props.level,
      hasRule: Boolean(risk.allow_rule),
      inText: Boolean(el.closest("input, textarea, [contenteditable='true']")),
      onButton: el instanceof HTMLButtonElement,
      busy: busy.current,
      mods: e.altKey || e.ctrlKey || e.metaKey,
    });
    if (!a) return;
    e.preventDefault();
    props.onAnswer(a);
  };

  const allow = (
    <div className="perm-split">
      <button type="button" className="perm-btn perm-allow" disabled={props.busy} onClick={() => props.onAnswer("allow_once")}>
        {t("perm.allowOnce")}
        {!red && !compact ? <kbd>Enter</kbd> : null}
      </button>
      {risk.allow_rule ? (
        <button
          type="button"
          className="perm-btn perm-allow perm-caret"
          disabled={props.busy}
          aria-label={t("perm.scopeMenu")}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={() => setMenu((v) => !v)}
        >
          <ChevronDown size={14} />
        </button>
      ) : null}
      {menu && risk.allow_rule ? (
        <div className="perm-scope-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => props.onAnswer("allow_once")}>
            {t("perm.scope.once")}
            <kbd>1</kbd>
          </button>
          <button type="button" role="menuitem" title={risk.allow_rule} onClick={() => props.onAnswer("allow_always")}>
            {alwaysAllowText(risk.allow_rule, t)}
            <kbd>2</kbd>
          </button>
          <p className="perm-scope-hint">{t("perm.saveHint", { rule: risk.allow_rule })}</p>
        </div>
      ) : null}
    </div>
  );

  if (compact) {
    const cmd = String(command(props.perm) ?? "");
    return (
      <div
        ref={cardRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`perm-card perm-compact perm-level-${props.level}`}
        role="alertdialog"
        aria-label={t("perm.cardLabel")}
      >
        <Icon size={15} className="perm-icon" aria-hidden />
        <code className="perm-cmd1" title={cmd}>
          {cmd}
        </code>
        {first ? <span className="perm-why1">{first.title}</span> : null}
        <button type="button" className="perm-btn perm-ghost" disabled={props.busy} title="Esc" onClick={() => props.onAnswer("deny")}>
          {t("perm.deny")}
        </button>
        {allow}
        <button type="button" className="perm-btn perm-ghost perm-icon-btn" aria-label={t("perm.expand")} title={t("perm.expand")} onClick={() => setExpanded(true)}>
          <ChevronUp size={15} />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={`perm-card perm-level-${props.level}`}
      role="alertdialog"
      aria-label={t("perm.cardLabel")}
    >
      <header className="perm-head">
        <Icon size={15} className="perm-icon" aria-hidden />
        <h4>{title}</h4>
        <span className={`perm-risk perm-risk-${props.level}`}>{levelLabel(props.level, t)}</span>
        <span className="perm-tool">{tool}</span>
      </header>
      <div className="perm-main">
        {left !== null ? (
          <p className="perm-countdown" role="timer">
            {t("perm.countdown", { n: left })}
          </p>
        ) : null}
        <div className="perm-body">
          {props.perm.preview ? (
            <PermPreview preview={props.perm.preview} />
          ) : isMcp && !json ? (
            <ParamTable input={props.perm.input} />
          ) : (
            <CallText perm={props.perm} />
          )}
        </div>
        {first ? (
          <div className="perm-why">
            <Info size={14} aria-hidden />
            <span>
              {first.detail || first.title}
              {more.length || safer.length ? (
                <>
                  {" "}
                  <button type="button" className="perm-more" aria-expanded={reasonsOpen} onClick={() => setReasonsOpen((v) => !v)}>
                    {more.length ? t("perm.moreReasons", { n: more.length }) : t("perm.saferLink")}
                  </button>
                </>
              ) : null}
            </span>
          </div>
        ) : null}
        {reasonsOpen ? (
          <ul className="perm-reasons">
            {more.map((c) => {
              const r = reason(c);
              return (
                <li key={c} title={c}>
                  <strong>{r.title}.</strong> {r.detail}
                </li>
              );
            })}
            {safer.map((x) => (
              <li key={x} className="perm-safer">
                {x}
              </li>
            ))}
          </ul>
        ) : null}
        {risk.tainted ? <p className="perm-tainted">{t("perm.tainted")}</p> : null}
        <SendError show={props.error} />
      </div>
      <footer className="perm-foot">
        {props.onDenyNote ? (
          <button type="button" className="perm-btn perm-ghost" disabled={props.busy} onClick={props.onDenyNote}>
            <MessageSquare size={14} aria-hidden />
            {t("perm.denyNote")}
          </button>
        ) : null}
        {isMcp ? (
          <button type="button" className="perm-btn perm-ghost" onClick={() => setJson((v) => !v)}>
            {json ? t("perm.table") : "JSON"}
          </button>
        ) : null}
        <span className="perm-spacer" />
        <button type="button" className="perm-btn perm-deny" disabled={props.busy} onClick={() => props.onAnswer("deny")}>
          {t("perm.deny")}
          <kbd>Esc</kbd>
        </button>
        {allow}
      </footer>
    </div>
  );
}

function EngineCard(props: { perm: Perm; busy: boolean; error: boolean; onAllow: (scope: PermScope) => void; onDeny: () => void }) {
  const t = useT();
  const scopes = scopeLabels(props.perm, t);
  const permEsc = permEscalation(props.perm);
  const permHostList = permHosts(props.perm);
  return (
    <div className="banner warn perm-card" role="alertdialog" aria-label={permEsc ? t("perm.esc.label") : t("perm.cardLabel")}>
      <h4>
        <span className={`perm-tier ${tierBadge(permEsc ? "block" : props.perm.risk?.tier, t).cls}`}>
          {tierBadge(permEsc ? "block" : props.perm.risk?.tier, t).label}
        </span>
        {permEsc
          ? t("perm.esc.title", { count: permEsc.count })
          : props.perm.risk?.reasons[0]?.title
            ? t("perm.askWithReason", { reason: props.perm.risk.reasons[0].title, tool: props.perm.name })
            : t("perm.ask", { tool: props.perm.name })}
      </h4>
      {permEsc ? <p className="perm-esc-desc">{permEsc.stop_only ? t("perm.esc.stopOnly") : t("perm.esc.desc")}</p> : null}
      <CallText perm={props.perm} />
      {permEsc && permEsc.blocked.length ? (
        <>
          <p className="perm-hosts-label">{t("perm.esc.blocked")}</p>
          <ul className="perm-reasons">
            {permEsc.blocked.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </>
      ) : null}
      {permHostList.length ? (
        <>
          <p className="perm-hosts-label">{t("perm.hostsLabel")}</p>
          <ul className="perm-hosts">
            {permHostList.map((h) => (
              <li key={h}>
                <code>{h}</code>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {props.perm.risk?.reasons.length && !permEsc ? (
        <ul className="perm-reasons">
          {props.perm.risk.reasons.map((r) => (
            <li key={r.code} title={r.code}>
              <strong>{r.title}.</strong> {r.detail}
            </li>
          ))}
        </ul>
      ) : null}
      <SendError show={props.error} />
      <div className="row perm-actions">
        {permEsc?.stop_only ? null : (
          <button type="button" className="primary" disabled={props.busy} onClick={() => props.onAllow("once")}>
            {permEsc ? t("perm.esc.run") : t("perm.allowOnce")}
          </button>
        )}
        {scopes ? (
          <>
            <button type="button" className="ghost" disabled={props.busy} title={t("perm.sessionTip")} onClick={() => props.onAllow("session")}>
              {scopes.session}
            </button>
            <button type="button" className="ghost" disabled={props.busy} title={t("perm.workspaceTip")} onClick={() => props.onAllow("workspace")}>
              {scopes.workspace}
            </button>
          </>
        ) : null}
        <button type="button" className={permEsc?.stop_only ? "primary" : "ghost"} disabled={props.busy} onClick={props.onDeny}>
          {permEsc ? t("perm.esc.stop") : t("perm.deny")}
        </button>
      </div>
    </div>
  );
}
