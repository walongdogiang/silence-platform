import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useRiskText, useT, type T } from "../i18n";
import type { Perm } from "../models";
import { permEscalation, permHosts, scopeLabels, tierBadge, type PermScope } from "../permissionUi";
import type { PermAnswer, RiskLevel } from "../types";

/**
 * Permission card above the composer. TS core cards (`risk.level`, docs/security/permissions.md):
 * a summary line + buttons, details folded by default. Rust Engine cards keep the old layout
 * (tier badge, escalation, hosts, session/workspace scopes).
 */
export function PermissionCard(props: {
  perm: Perm;
  busy: boolean;
  error: boolean;
  /** TS core card. */
  onAnswer: (a: PermAnswer) => void;
  /** Rust Engine card. */
  onAllow: (scope: PermScope) => void;
  onDeny: () => void;
  /** Start with details open (tests, previews). Default: folded. */
  detailsOpen?: boolean;
}) {
  return props.perm.risk?.level ? <CoreCard {...props} level={props.perm.risk.level} /> : <EngineCard {...props} />;
}

const command = (perm: Perm) => (perm.input as { command?: unknown } | null | undefined)?.command;

/** Real call text: the command, or the tool input. Approval is based on this, never on model text. */
function CallText(props: { perm: Perm }) {
  const c = command(props.perm);
  return <pre>{typeof c === "string" ? c : JSON.stringify(props.perm.input, null, 2)}</pre>;
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

function CoreCard(props: { perm: Perm; level: RiskLevel; busy: boolean; error: boolean; onAnswer: (a: PermAnswer) => void; detailsOpen?: boolean }) {
  const t = useT();
  const text = useRiskText();
  const risk = props.perm.risk!;
  const [open, setOpen] = useState(Boolean(props.detailsOpen));
  const left = useCountdown(risk.countdown_s);
  const codes = risk.codes ?? risk.reasons.map((r) => r.code);
  // Reasons worth reading: the shown ones from the core, in the UI language.
  const shown = (risk.reasons.length ? risk.reasons.map((r) => r.code) : codes).filter((c, i, a) => a.indexOf(c) === i);
  const headline = shown[0] ? (text(shown[0])?.title ?? risk.reasons[0]?.title ?? "") : "";
  const safer = shown.map((c) => text(c)?.safer).filter((s): s is string => Boolean(s));
  const impact = risk.impact;
  const red = props.level === "danger" || props.level === "hard_block";

  return (
    <div className={`banner perm-card perm-level-${props.level}`} role="alertdialog" aria-label={t("perm.cardLabel")}>
      <h4>
        <span className={`perm-tier ${red ? "block" : "ask"}`}>{levelLabel(props.level, t)}</span>
        {headline ? t("perm.askWithReason", { reason: headline, tool: props.perm.name }) : t("perm.ask", { tool: props.perm.name })}
      </h4>
      <CallText perm={props.perm} />
      {left !== null ? (
        <p className="perm-countdown" role="timer">
          {t("perm.countdown", { n: left })}
        </p>
      ) : null}
      <button type="button" className="perm-details-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ChevronDown size={13} className={open ? "mode-chev open" : "mode-chev"} />
        {open ? t("perm.hideDetails") : t("perm.details")}
      </button>
      {open ? (
        <dl className="perm-details">
          {risk.segments?.length ? (
            <>
              <dt>{t("perm.d.what")}</dt>
              <dd>
                <ul className="perm-segments">
                  {risk.segments.map((s, i) => (
                    <li key={i} className={`perm-seg perm-level-${s.level}`}>
                      <code>{s.text}</code>
                      <span>{s.codes.map((c) => text(c)?.title ?? c).join(" · ")}</span>
                    </li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
          {shown.length ? (
            <>
              <dt>{t("perm.d.why")}</dt>
              <dd>
                <ul className="perm-reasons">
                  {shown.map((c) => {
                    const r = text(c);
                    const fallback = risk.reasons.find((x) => x.code === c);
                    return (
                      <li key={c} title={c}>
                        <strong>{r?.title ?? fallback?.title ?? c}.</strong> {r?.detail ?? fallback?.detail ?? ""}
                      </li>
                    );
                  })}
                </ul>
              </dd>
            </>
          ) : null}
          {impact ? (
            <>
              <dt>{t("perm.d.impact")}</dt>
              <dd className="perm-impact">
                {impact.network ? <span>{t("perm.impact.network")}</span> : null}
                {impact.outside_workspace ? <span>{t("perm.impact.outside")}</span> : null}
                {impact.deletes ? <span>{t("perm.impact.deletes")}</span> : null}
                {impact.admin ? <span>{t("perm.impact.admin")}</span> : null}
                <span>{impact.undoable ? t("perm.impact.undoable") : t("perm.impact.notUndoable")}</span>
              </dd>
            </>
          ) : null}
          <dt>{t("perm.d.source")}</dt>
          <dd>
            {t(risk.source === "subagent" ? "perm.source.subagent" : risk.source === "verify" ? "perm.source.verify" : risk.source === "hook" ? "perm.source.hook" : "perm.source.agent")}
            {risk.tainted ? <p className="perm-tainted">{t("perm.tainted")}</p> : null}
          </dd>
          {safer.length ? (
            <>
              <dt>{t("perm.d.safer")}</dt>
              <dd>
                <ul className="perm-reasons">
                  {safer.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
          <dt>{t("perm.d.codes")}</dt>
          <dd>
            <code>{codes.join(", ")}</code>
          </dd>
        </dl>
      ) : null}
      <SendError show={props.error} />
      <div className="row perm-actions">
        <button type="button" className="primary" disabled={props.busy} onClick={() => props.onAnswer("allow_once")}>
          {t("perm.allowOnce")}
        </button>
        {risk.allow_rule ? (
          <button type="button" className="ghost" disabled={props.busy} title={t("perm.alwaysTip")} onClick={() => props.onAnswer("allow_always")}>
            {t("perm.alwaysAllow", { rule: risk.allow_rule })}
          </button>
        ) : null}
        <button type="button" className="ghost" disabled={props.busy} onClick={() => props.onAnswer("deny")}>
          {t("perm.deny")}
        </button>
        {risk.deny_rule ? (
          <button type="button" className="ghost" disabled={props.busy} title={t("perm.alwaysTip")} onClick={() => props.onAnswer("deny_always")}>
            {t("perm.denyAlways", { rule: risk.deny_rule })}
          </button>
        ) : null}
      </div>
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
