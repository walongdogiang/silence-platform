import { useCallback, useEffect, useState } from "react";
import { BarChart3, RefreshCw, X } from "lucide-react";
import { useT, type T } from "../i18n";
import { Segmented } from "./settings/SettingRow";

/** `metrics.summary` (TS core, roadmap 1.10). `available: false` = the core is not running. */
export type Totals = {
  sessions: number;
  turns: number;
  falseDone: number;
  verifiedTurns: number;
  fixRounds: number;
  repeats: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  usd: number;
};
export type MetricsSummary = {
  available?: false;
  days: number;
  core: Totals;
  external: Totals;
  byDay: Array<{ day: string; core: Totals; external: Totals }>;
  byProject: Array<{ project: string; core: Totals; external: Totals }>;
  quota?: { status: string; utilization?: number; window?: string; resetsAt?: number; at: string };
};

const RANGES = [7, 30, 90] as const;

/** `1234567` → `1.2M`, `12345` → `12.3k`. */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

/** Share as `12%`, or `—` when there is nothing to divide by. */
export function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

/** Per-turn average with one decimal, or `—`. */
export function perTurn(n: number, turns: number): string {
  return turns > 0 ? (n / turns).toFixed(1) : "—";
}

/** Rows of the 5ilence vs bare Claude table. `null` = not measured on that side. */
export function comparisonRows(s: MetricsSummary, t: T): Array<{ label: string; core: string; external: string; hint?: string }> {
  const c = s.core;
  const e = s.external;
  return [
    { label: t("metrics.sessions"), core: String(c.sessions), external: String(e.sessions) },
    { label: t("metrics.turns"), core: String(c.turns), external: String(e.turns) },
    { label: t("metrics.turnsPerSession"), core: perTurn(c.turns, c.sessions), external: perTurn(e.turns, e.sessions) },
    { label: t("metrics.repeatRate"), core: pct(c.repeats, c.turns), external: pct(e.repeats, e.turns), hint: t("metrics.repeatHint") },
    { label: t("metrics.falseDone"), core: pct(c.falseDone, c.verifiedTurns), external: "—", hint: t("metrics.falseDoneHint") },
    { label: t("metrics.fixRounds"), core: perTurn(c.fixRounds, c.verifiedTurns), external: "—" },
    { label: t("metrics.outPerTurn"), core: c.turns ? compact(c.outputTokens / c.turns) : "—", external: e.turns ? compact(e.outputTokens / e.turns) : "—" },
  ];
}

function Tile(props: { label: string; value: string; sub?: string }) {
  return (
    <div className="metric-tile">
      <span className="metric-label">{props.label}</span>
      <strong className="metric-value">{props.value}</strong>
      {props.sub ? <span className="metric-sub">{props.sub}</span> : null}
    </div>
  );
}

/** The figures, without fetching (tests and previews). */
export function MetricsView(props: { summary: MetricsSummary }) {
  const t = useT();
  const s = props.summary;
  const c = s.core;
  return (
    <>
      <h3 className="metrics-h">{t("metrics.coreTitle")}</h3>
      <div className="metric-tiles">
        <Tile label={t("metrics.turns")} value={String(c.turns)} sub={t("metrics.inSessions", { n: c.sessions })} />
        <Tile label={t("metrics.falseDone")} value={pct(c.falseDone, c.verifiedTurns)} sub={t("metrics.ofChecked", { n: c.falseDone, m: c.verifiedTurns })} />
        <Tile label={t("metrics.fixRounds")} value={String(c.fixRounds)} sub={t("metrics.perChecked", { n: perTurn(c.fixRounds, c.verifiedTurns) })} />
        <Tile label={t("metrics.repeats")} value={String(c.repeats)} sub={pct(c.repeats, c.turns)} />
        <Tile label={t("metrics.tokens")} value={compact(c.inputTokens + c.outputTokens)} sub={t("metrics.tokensSub", { out: compact(c.outputTokens), cache: compact(c.cacheReadTokens) })} />
        <Tile label={t("metrics.cost")} value={`$${c.usd.toFixed(2)}`} sub={t("metrics.costSub")} />
      </div>
      {s.quota ? (
        <p className="muted metrics-quota">
          {t("metrics.quota", { status: s.quota.status, used: s.quota.utilization !== undefined ? `${Math.round(s.quota.utilization * 100)}%` : "—", window: s.quota.window ?? "" })}
        </p>
      ) : null}

      <h3 className="metrics-h">{t("metrics.compareTitle")}</h3>
      <p className="muted">{t("metrics.compareDesc")}</p>
      <table className="metrics-table">
        <thead>
          <tr>
            <th scope="col">{t("metrics.measure")}</th>
            <th scope="col">5ilence</th>
            <th scope="col">{t("metrics.bare")}</th>
          </tr>
        </thead>
        <tbody>
          {comparisonRows(s, t).map((r) => (
            <tr key={r.label} title={r.hint}>
              <th scope="row">{r.label}</th>
              <td>{r.core}</td>
              <td>{r.external}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="metrics-h">{t("metrics.byProject")}</h3>
      <SplitTable rows={s.byProject.map((r) => ({ key: r.project, core: r.core, external: r.external }))} first={t("metrics.project")} />

      <h3 className="metrics-h">{t("metrics.byDay")}</h3>
      <SplitTable rows={s.byDay.map((r) => ({ key: r.day, core: r.core, external: r.external }))} first={t("metrics.day")} />
    </>
  );
}

function SplitTable(props: { rows: Array<{ key: string; core: Totals; external: Totals }>; first: string }) {
  const t = useT();
  if (!props.rows.length) return <p className="muted">{t("metrics.none")}</p>;
  return (
    <table className="metrics-table">
      <thead>
        <tr>
          <th scope="col">{props.first}</th>
          <th scope="col">{t("metrics.turns5")}</th>
          <th scope="col">{t("metrics.falseDone")}</th>
          <th scope="col">{t("metrics.turnsBare")}</th>
        </tr>
      </thead>
      <tbody>
        {props.rows.map((r) => (
          <tr key={r.key}>
            <th scope="row">{r.key}</th>
            <td>{r.core.turns}</td>
            <td>{pct(r.core.falseDone, r.core.verifiedTurns)}</td>
            <td>{r.external.turns}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Metrics page (roadmap 1.10, ADR 0004 pillar 7): 5ilence sessions from the core's event log next to
 * Claude desktop / terminal sessions, for the last 7 / 30 / 90 days.
 */
export function MetricsPage(props: { onClose: () => void }) {
  const t = useT();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [data, setData] = useState<MetricsSummary | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    let live = true;
    setLoading(true);
    setErr("");
    window.silence
      .rpc("metrics.summary", { days })
      .then((r) => live && setData(r as MetricsSummary))
      .catch((e: unknown) => live && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [days]);
  useEffect(() => load(), [load]);

  return (
    <section className="metrics-page" aria-label={t("metrics.title")}>
      <header className="metrics-head">
        <BarChart3 size={16} aria-hidden="true" />
        <h2>{t("metrics.title")}</h2>
        <Segmented label={t("metrics.range")} value={String(days)} onChange={(v) => setDays(Number(v) as (typeof RANGES)[number])} options={RANGES.map((d) => ({ id: String(d), label: t("metrics.days", { n: d }) }))} />
        <button type="button" className="icon-btn" aria-label={t("metrics.refresh")} title={t("metrics.refresh")} disabled={loading} onClick={() => void load()}>
          <RefreshCw size={15} />
        </button>
        <button type="button" className="icon-btn" aria-label={t("common.close")} onClick={props.onClose}>
          <X size={16} />
        </button>
      </header>
      <div className="metrics-body">
        {err ? (
          <p className="perm-error" role="alert">
            {err}
          </p>
        ) : !data ? (
          <p className="muted">{t("common.loading")}</p>
        ) : data.available === false ? (
          <p className="muted">{t("metrics.coreOff")}</p>
        ) : (
          <MetricsView summary={data} />
        )}
      </div>
    </section>
  );
}
