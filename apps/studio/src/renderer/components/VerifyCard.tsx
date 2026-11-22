import { CircleCheck, CircleSlash, CircleX } from "lucide-react";
import { useT, type T } from "../i18n";
import type { ChatLine } from "../models";

export type VerifyLine = Extract<ChatLine, { kind: "verify" }>;

/** Seconds, short: `0.4s`, `12s`, `2m 05s`. */
export function checkTime(ms: number): string {
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** Headline of the latest round. */
export function verifyTitle(last: VerifyLine, t: T): string {
  if (last.ok) return last.round > 0 ? t("verify.passedAfter", { n: last.round }) : t("verify.passed");
  if (!last.final) return t("verify.fixing", { n: last.round + 1, max: 2 });
  return last.round > 0 ? t("verify.stillFailing", { n: last.round }) : t("verify.failed");
}

/**
 * "Checks" card at the end of a turn (roadmap 1.8, docs/frontend/chat.md): every command that ran
 * for the files the turn changed, pass / fail / skipped, failing output folded; earlier fix rounds
 * folded under the latest one.
 */
export function VerifyCard(props: { rounds: VerifyLine[] }) {
  const t = useT();
  const last = props.rounds[props.rounds.length - 1];
  if (!last) return null;
  const earlier = props.rounds.slice(0, -1);
  const state = last.ok ? "ok" : last.final ? "fail" : "fixing";
  return (
    <section className={`verify-card verify-${state}`} aria-label={t("verify.label")}>
      <header>
        {last.ok ? <CircleCheck size={15} aria-hidden="true" /> : <CircleX size={15} aria-hidden="true" />}
        <strong>{verifyTitle(last, t)}</strong>
        <span className="verify-meta">
          {t("verify.meta", { n: last.changed })} · {t(last.source === "repo" ? "verify.sourceRepo" : "verify.sourceUser")}
        </span>
      </header>
      <ChecksList checks={last.checks} />
      {earlier.length ? (
        <details className="verify-earlier">
          <summary>{t("verify.earlier", { n: earlier.length })}</summary>
          {earlier.map((r, i) => (
            <div key={i} className="verify-round">
              <p className="verify-round-title">{t("verify.round", { n: r.round + 1 })}</p>
              <ChecksList checks={r.checks} />
            </div>
          ))}
        </details>
      ) : null}
    </section>
  );
}

/** Why a check did not run, in the UI language (the core sends fixed English reasons). */
export function skippedText(why: string, t: T): string {
  if (why === "declined") return t("verify.why.declined");
  if (why.startsWith("needs approval")) return t("verify.why.unattended");
  if (why.startsWith("denied by rule")) return t("verify.why.rule", { rule: why.replace(/^denied by rule\s*/, "") });
  if (why.startsWith("blocked by policy")) return t("verify.why.blocked");
  return why;
}

function ChecksList(props: { checks: VerifyLine["checks"] }) {
  const t = useT();
  return (
    <ul className="verify-checks">
      {props.checks.map((c, i) => (
        <li key={i} className={c.skipped ? "skipped" : c.ok ? "ok" : "fail"}>
          <span className="verify-row">
            {c.skipped ? <CircleSlash size={13} aria-label={t("verify.skipped")} /> : c.ok ? <CircleCheck size={13} aria-label={t("verify.ok")} /> : <CircleX size={13} aria-label={t("verify.fail")} />}
            <code>{c.command === "pairs" ? t("verify.pairs") : c.command}</code>
            {c.skipped ? <span className="verify-time">{t("verify.notRun", { why: skippedText(c.skipped, t) })}</span> : c.command === "pairs" ? null : <span className="verify-time">{checkTime(c.ms)}</span>}
          </span>
          {!c.ok && !c.skipped && c.output ? (
            <details>
              <summary>{t("verify.output")}</summary>
              <pre>{c.output}</pre>
            </details>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
