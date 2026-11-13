import { FolderOpen, Play, RotateCcw, Square, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtUsd } from "../autoConfig";
import {
  failedIds,
  lastFailed,
  loadEvalStore,
  MAX_REPEAT,
  rerunFailed,
  resetConfig,
  sanitize,
  saveEvalStore,
  suiteTasks,
  withSuite,
  type EvalStore,
} from "../evalConfig";
import { liveProgress, type Live } from "../evalLive";
import { useT, type T } from "../i18n";
import { MarkdownMessage } from "./MarkdownMessage";
import type {
  EvalCatalog,
  EvalConfig,
  EvalEstimate,
  EvalRun,
  EvalStatus,
  EvalTaskDetail,
  ModelInfo,
} from "../types";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

function rpc<R>(method: string, params?: unknown): Promise<R> {
  return window.silence.rpc(method, params) as Promise<R>;
}

function StatusBadge(props: { status?: EvalStatus | "RUN" | "WAIT"; flaky?: boolean; t: T }) {
  const s = props.status ?? "WAIT";
  const label = s === "RUN" ? "…" : s === "WAIT" ? props.t("evals.waiting") : s;
  return (
    <span className={`eval-badge eval-${s.toLowerCase()}`}>
      {label}
      {props.flaky ? ` · ${props.t("evals.flaky")}` : ""}
    </span>
  );
}

/**
 * Settings → Evals: pick suite, tasks, source, model, effort, attempts and cap; see the
 * estimate; run with live progress; open one task's report, changes and audit. Named setups and
 * "reset to default" are kept in `evalConfig.ts`.
 */
export function EvalsPage(props: {
  models: ModelInfo[];
  /** Run state kept by the App (`useEvalLive`), so it survives closing this page. */
  live: Live | null;
  /** Increases when a run ends: reload the catalog and recent runs. */
  ended: number;
  onStopping: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [catalog, setCatalog] = useState<EvalCatalog | null>(null);
  const [loadError, setLoadError] = useState("");
  const [store, setStore] = useState<EvalStore>(() => loadEvalStore());
  const [setupName, setSetupName] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<EvalEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [kindFilter, setKindFilter] = useState("");
  const [lastFilter, setLastFilter] = useState<"" | "failed" | "never">("");
  const [query, setQuery] = useState("");
  const live = props.live;
  const [runs, setRuns] = useState<EvalRun[]>([]);
  const [detail, setDetail] = useState<EvalTaskDetail | null>(null);
  const [detailTab, setDetailTab] = useState<"report" | "diff" | "audit">("report");
  const [error, setError] = useState("");
  const cfg = store.current;
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  const setCfg = (next: EvalConfig) => setStore((s) => ({ ...s, current: next }));
  useEffect(() => saveEvalStore(store), [store]);

  const refresh = async () => {
    try {
      const c = await rpc<EvalCatalog>("eval.catalog");
      setCatalog(c);
      setLoadError("");
      setStore((s) => {
        const fixed = sanitize(s.current, c);
        // First visit: every task of the default suite.
        return { ...s, current: fixed.tasks.length === 0 && s.current.tasks.length === 0 ? resetConfig(c) : fixed };
      });
      const r = await rpc<{ runs: EvalRun[] }>("eval.runs");
      setRuns(r.runs ?? []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  // On open and after each run that ends while the App listens.
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.ended]);

  // Estimate (debounced) whenever the config changes.
  useEffect(() => {
    if (!catalog?.available || cfg.tasks.length === 0) {
      setEstimate(null);
      return;
    }
    setEstimating(true);
    const id = window.setTimeout(() => {
      rpc<EvalEstimate>("eval.estimate", cfg)
        .then((e) => {
          if (cfgRef.current === cfg) setEstimate(e);
          setError("");
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setEstimating(false));
    }, 300);
    return () => window.clearTimeout(id);
  }, [cfg, catalog]);

  const tasks = suiteTasks(catalog, cfg.suite);
  const kinds = useMemo(() => [...new Set(tasks.map((x) => x.kind))].sort(), [tasks]);
  const planned = useMemo(() => {
    const m: Record<string, { model?: string; usd?: number | null; skip?: string }> = {};
    for (const x of estimate?.estimate.tasks ?? []) m[x.id] = { model: x.model, usd: x.usd };
    for (const x of estimate?.skipped ?? []) m[x.id] = { skip: x.reason };
    return m;
  }, [estimate]);
  const visible = tasks.filter((x) => {
    if (kindFilter && x.kind !== kindFilter) return false;
    if (lastFilter === "failed" && !(x.last?.status === "FAIL" || x.last?.status === "ERROR")) return false;
    if (lastFilter === "never" && x.last) return false;
    return !query.trim() || x.id.toLowerCase().includes(query.trim().toLowerCase());
  });
  const selected = new Set(cfg.tasks);
  const toggle = (id: string) =>
    setCfg({ ...cfg, tasks: selected.has(id) ? cfg.tasks.filter((x) => x !== id) : tasks.map((x) => x.id).filter((x) => x === id || selected.has(x)) });
  const sourceModels = props.models.filter((m) => !cfg.source || m.provider === cfg.source);
  const running = Boolean(live?.running) || Boolean(catalog?.running && !live);

  async function start() {
    setError("");
    setDetail(null);
    try {
      await rpc("eval.start", cfg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function stop() {
    props.onStopping();
    await rpc("eval.cancel").catch(() => undefined);
  }

  async function openDetail(suite: string, id: string, attempt?: number) {
    try {
      setDetail(await rpc<EvalTaskDetail>("eval.task", { suite, task_id: id, attempt }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function saveSetup(name: string) {
    const n = name.trim();
    if (!n) return;
    setStore((s) => ({ ...s, saved: { ...s.saved, [n]: s.current } }));
    setSetupName(n);
    setNaming(null);
  }

  if (loadError) {
    return (
      <div className="network-page evals-page">
        <p className="evals-error">{loadError}</p>
      </div>
    );
  }
  if (!catalog) {
    return (
      <div className="network-page evals-page">
        <p className="evals-muted">{t("evals.loading")}</p>
      </div>
    );
  }
  if (!catalog.available) {
    return (
      <div className="network-page evals-page">
        <header>
          <h2>{t("evals.title")}</h2>
        </header>
        <p className="evals-muted">{t("evals.unavailable")}</p>
      </div>
    );
  }

  const { done, usd: liveUsd } = liveProgress(live);
  const est = estimate?.estimate;

  return (
    <div className="network-page evals-page">
      <header className="evals-head">
        <div>
          <h2>{t("evals.title")}</h2>
          <p>{t("evals.intro")}</p>
        </div>
        <button type="button" className="evals-close" title={t("evals.close")} aria-label={t("evals.close")} onClick={props.onClose}>
          <X size={15} />
        </button>
      </header>

      <div className="evals-grid">
        <section className="evals-config">
          <div className="evals-setups">
            <label>
              <span>{t("evals.saved")}</span>
              <select
                value={setupName}
                onChange={(e) => {
                  const n = e.target.value;
                  setSetupName(n);
                  if (n && store.saved[n]) setCfg(sanitize(store.saved[n], catalog));
                }}
              >
                <option value="">{t("evals.current")}</option>
                {Object.keys(store.saved)
                  .sort()
                  .map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
              </select>
            </label>
            <div className="evals-setup-actions">
              {setupName ? (
                <button type="button" onClick={() => saveSetup(setupName)}>
                  {t("evals.save")}
                </button>
              ) : null}
              <button type="button" onClick={() => setNaming("")}>
                {t("evals.saveAs")}
              </button>
              {setupName ? (
                <button
                  type="button"
                  onClick={() => {
                    setStore((s) => {
                      const saved = { ...s.saved };
                      delete saved[setupName];
                      return { ...s, saved };
                    });
                    setSetupName("");
                  }}
                >
                  {t("evals.delete")}
                </button>
              ) : null}
              <button
                type="button"
                className="evals-reset"
                onClick={() => {
                  setSetupName("");
                  setCfg(resetConfig(catalog));
                  setKindFilter("");
                  setLastFilter("");
                  setQuery("");
                }}
              >
                <RotateCcw size={13} aria-hidden="true" />
                {t("evals.reset")}
              </button>
            </div>
            {naming !== null ? (
              <form
                className="evals-naming"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveSetup(naming);
                }}
              >
                <input
                  autoFocus
                  value={naming}
                  placeholder={t("evals.saveAsPrompt")}
                  onChange={(e) => setNaming(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setNaming(null)}
                />
                <button type="submit">{t("evals.save")}</button>
                <button type="button" aria-label={t("common.close")} onClick={() => setNaming(null)}>
                  <X size={13} />
                </button>
              </form>
            ) : null}
          </div>

          <div className="evals-form">
            <label>
              <span>{t("evals.suite")}</span>
              <select value={cfg.suite} onChange={(e) => setCfg(withSuite(cfg, e.target.value, catalog))}>
                {catalog.suites.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name} ({s.tasks.length})
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("evals.source")}</span>
              <select
                value={cfg.source ?? ""}
                onChange={(e) => {
                  const source = e.target.value || undefined;
                  // A model of another source no longer fits: back to each task's own model.
                  const keepModel = !cfg.model || cfg.model === "auto" || props.models.some((m) => m.id === cfg.model && m.provider === source);
                  setCfg({ ...cfg, source, model: keepModel ? cfg.model : undefined });
                }}
              >
                <option value="">{t("evals.sourceOwn")}</option>
                {catalog.sources.map((s) => (
                  <option key={s.id} value={s.id} disabled={!s.available} title={s.unavailable_reason || undefined}>
                    {s.label}
                    {s.available ? "" : ` — ${s.unavailable_reason}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("evals.model")}</span>
              <select value={cfg.model ?? ""} onChange={(e) => setCfg({ ...cfg, model: e.target.value || undefined })}>
                <option value="">{t("evals.modelOwn")}</option>
                <option value="auto">Auto</option>
                {sourceModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label || m.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("evals.effort")}</span>
              <select value={cfg.effort ?? ""} onChange={(e) => setCfg({ ...cfg, effort: e.target.value || undefined })}>
                <option value="">{t("evals.effortOwn")}</option>
                {EFFORTS.map((x) => (
                  <option key={x} value={x}>
                    {t(`effort.${x}`)}
                  </option>
                ))}
              </select>
            </label>
            <label title={t("evals.repeatHint")}>
              <span>{t("evals.repeat")}</span>
              <input
                type="number"
                min={1}
                max={MAX_REPEAT}
                value={cfg.repeat}
                onChange={(e) => setCfg({ ...cfg, repeat: Math.min(MAX_REPEAT, Math.max(1, Number(e.target.value) || 1)) })}
              />
            </label>
            <label>
              <span>{t("evals.cap")}</span>
              <span className="auto-budget-input">
                $
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  placeholder={t("evals.capNone")}
                  value={cfg.max_cost ?? ""}
                  onChange={(e) => {
                    const v = e.target.value.trim() === "" ? undefined : Number(e.target.value);
                    setCfg({ ...cfg, max_cost: v !== undefined && Number.isFinite(v) && v >= 0 ? v : undefined });
                  }}
                />
              </span>
            </label>
            <label className="evals-check">
              <input type="checkbox" checked={cfg.retry_failed} onChange={(e) => setCfg({ ...cfg, retry_failed: e.target.checked })} />
              {t("evals.retry")}
            </label>
            <label className="evals-check">
              <input type="checkbox" checked={cfg.history} onChange={(e) => setCfg({ ...cfg, history: e.target.checked })} />
              {t("evals.history")}
            </label>
          </div>

          <div className="evals-tasks-head">
            <b>{t("evals.tasks")}</b>
            <span className="evals-muted">{t("evals.selected", { n: cfg.tasks.length, total: tasks.length })}</span>
            <span className="evals-spacer" />
            <button type="button" onClick={() => setCfg({ ...cfg, tasks: tasks.map((x) => x.id) })}>
              {t("evals.selectAll")}
            </button>
            <button type="button" onClick={() => setCfg({ ...cfg, tasks: [] })}>
              {t("evals.selectNone")}
            </button>
            <button type="button" onClick={() => setCfg({ ...cfg, tasks: lastFailed(tasks) })}>
              {t("evals.selectFailed")}
            </button>
          </div>
          <div className="evals-filters">
            <input value={query} placeholder={t("evals.search")} onChange={(e) => setQuery(e.target.value)} />
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
              <option value="">{t("evals.filterKind")}</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select value={lastFilter} onChange={(e) => setLastFilter(e.target.value as typeof lastFilter)}>
              <option value="">{t("evals.filterAll")}</option>
              <option value="failed">{t("evals.filterFailed")}</option>
              <option value="never">{t("evals.filterNever")}</option>
            </select>
          </div>
          <ul className="evals-task-list">
            {visible.map((x) => {
              const p = planned[x.id];
              return (
                <li key={x.id} className={selected.has(x.id) ? "on" : undefined}>
                  <label>
                    <input type="checkbox" checked={selected.has(x.id)} onChange={() => toggle(x.id)} />
                    <span className="evals-task-id">{x.id}</span>
                  </label>
                  <span className="evals-task-meta">
                    {x.kind} · {x.mode}
                    {selected.has(x.id) && p?.model ? ` · ${t("evals.runsOn", { model: p.model })}` : ""}
                    {p?.skip ? <em className="evals-warn"> · {t("evals.skipWhy", { why: p.skip })}</em> : null}
                    {x.missing_env ? <em className="evals-warn"> · {t("evals.needsEnv", { env: x.missing_env })}</em> : null}
                  </span>
                  <span className="evals-task-last">
                    {x.last ? (
                      <>
                        <StatusBadge status={x.last.status} t={t} /> {fmtUsd(x.last.cost_usd)}
                      </>
                    ) : (
                      <span className="evals-muted">{t("evals.never")}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>

          <div className="evals-footer">
            <span className="evals-estimate">
              {estimating
                ? t("evals.estimating")
                : est
                  ? `${t("evals.estimate", { usd: fmtUsd(est.total_usd) })}${est.unknown ? t("evals.estimateUnknown", { n: est.unknown }) : ""}${estimate?.skipped.length ? t("evals.estimateSkipped", { n: estimate.skipped.length }) : ""}`
                  : ""}
            </span>
            {running ? (
              <button type="button" className="evals-stop" onClick={() => void stop()} disabled={live?.stopping}>
                <Square size={13} aria-hidden="true" />
                {live?.stopping ? t("evals.stopping") : t("evals.stop")}
              </button>
            ) : (
              <button type="button" className="evals-run" disabled={cfg.tasks.length === 0} onClick={() => void start()}>
                <Play size={13} aria-hidden="true" />
                {t("evals.run", { n: cfg.tasks.length })}
              </button>
            )}
          </div>
          {error ? <p className="evals-error">{error}</p> : null}
        </section>

        <section className="evals-results">
          {live ? (
            <>
              <div className="evals-results-head">
                <b>{t("evals.results")}</b>
                <span className="evals-muted">
                  {live.running
                    ? t("evals.running", { done, total: live.order.length, usd: fmtUsd(liveUsd) })
                    : live.summary
                      ? t("evals.total", {
                          pass: live.summary.counts.pass,
                          fail: live.summary.counts.fail,
                          error: live.summary.counts.error,
                          skip: live.summary.counts.skip,
                          usd: fmtUsd(live.summary.total_cost_usd),
                        })
                      : ""}
                </span>
                {live.summary && failedIds(live.summary).length > 0 ? (
                  <button type="button" onClick={() => setCfg(rerunFailed(cfg, live.summary!))}>
                    {t("evals.rerunFailed", { n: failedIds(live.summary).length })}
                  </button>
                ) : null}
              </div>
              {live.running ? (
                <progress className="evals-progress" max={live.order.length} value={done} />
              ) : null}
              {live.summary?.stopped ? <p className="evals-warn">{t("evals.stopped", { why: live.summary.stopped })}</p> : null}
              {live.failed ? <p className="evals-error">{t("evals.failed", { message: live.failed })}</p> : null}
              <table className="evals-table">
                <thead>
                  <tr>
                    <th>{t("evals.col.task")}</th>
                    <th>{t("evals.col.status")}</th>
                    <th>{t("evals.col.model")}</th>
                    <th>{t("evals.col.cost")}</th>
                    <th>{t("evals.col.time")}</th>
                  </tr>
                </thead>
                <tbody>
                  {live.order.map((id) => {
                    const r = live.rows[id];
                    const m = r?.metrics;
                    const status: EvalStatus | "RUN" | "WAIT" = m ? m.status : r?.skip ? "SKIP" : r?.attempt ? "RUN" : "WAIT";
                    return (
                      <tr
                        key={id}
                        className={m ? "clickable" : undefined}
                        title={r?.skip || m?.error || undefined}
                        onClick={() => m && m.status !== "SKIP" && void openDetail(live.suite, id)}
                      >
                        <td>{id}</td>
                        <td>
                          <StatusBadge status={status} flaky={m?.flaky} t={t} />
                          {status === "RUN" && r?.attempt ? (
                            <span className="evals-muted"> {t("evals.runningTask", { n: r.attempt })}</span>
                          ) : null}
                        </td>
                        <td>{r?.model ?? ""}</td>
                        <td>{m ? fmtUsd(m.cost_usd) : ""}</td>
                        <td>{m ? `${m.duration_secs.toFixed(0)}s` : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : null}

          {detail ? <TaskDetail detail={detail} tab={detailTab} onTab={setDetailTab} onAttempt={(n) => void openDetail(detail.suite, detail.task_id, n)} onClose={() => setDetail(null)} t={t} /> : null}

          <div className="evals-recent">
            <b>{t("evals.recent")}</b>
            {runs.length === 0 ? <p className="evals-muted">{t("evals.noRuns")}</p> : null}
            <ul>
              {runs.slice(0, 10).map((r) => (
                <li key={r.run_id}>
                  <span className="evals-run-id">
                    {r.run_id} · {r.suite}
                  </span>
                  <span className="evals-muted">
                    {t("evals.total", {
                      pass: r.counts.pass,
                      fail: r.counts.fail,
                      error: r.counts.error,
                      skip: r.counts.skip,
                      usd: fmtUsd(r.total_cost_usd),
                    })}
                  </span>
                  <span className="evals-run-actions">
                    <button type="button" onClick={() => setCfg({ ...withSuite(cfg, r.suite, catalog), tasks: r.tasks.map((x) => x.id) })}>
                      {t("evals.loadRun")}
                    </button>
                    {r.failed.length > 0 ? (
                      <button type="button" onClick={() => setCfg(rerunFailed(cfg, r))}>
                        {t("evals.rerunFailed", { n: r.failed.length })}
                      </button>
                    ) : null}
                  </span>
                  <span className="evals-run-tasks">
                    {r.tasks.map((x) => (
                      <button
                        type="button"
                        key={x.id}
                        className={`eval-chip eval-${x.status.toLowerCase()}`}
                        title={`${x.id} · ${x.model} · ${fmtUsd(x.cost_usd)}`}
                        onClick={() => x.status !== "SKIP" && void openDetail(r.suite, x.id)}
                      >
                        {x.id.split("-")[0]}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

function TaskDetail(props: {
  detail: EvalTaskDetail;
  tab: "report" | "diff" | "audit";
  onTab: (t: "report" | "diff" | "audit") => void;
  onAttempt: (n: number) => void;
  onClose: () => void;
  t: T;
}) {
  const { detail: d, t } = props;
  return (
    <div className="evals-detail">
      <div className="evals-detail-head">
        <b>
          {t("evals.detail")}: {d.task_id}
        </b>
        {d.attempts.length > 1 ? (
          <label>
            {t("evals.detail.attempt")}
            <select value={d.attempt} onChange={(e) => props.onAttempt(Number(e.target.value))}>
              {d.attempts.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span className="evals-spacer" />
        {window.silence.revealEval ? (
          <button type="button" onClick={() => void window.silence.revealEval?.(d.workspace)}>
            <FolderOpen size={13} aria-hidden="true" />
            {t("evals.detail.reveal")}
          </button>
        ) : null}
        <button type="button" aria-label={t("common.close")} onClick={props.onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="evals-tabs" role="tablist">
        {(["report", "diff", "audit"] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={props.tab === k} className={props.tab === k ? "on" : undefined} onClick={() => props.onTab(k)}>
            {t(`evals.detail.${k}`)}
            {k === "diff" && d.files.length ? ` (${d.files.length})` : ""}
          </button>
        ))}
      </div>
      <div className="evals-detail-body">
        {props.tab === "report" ? (
          d.report.trim() ? (
            <MarkdownMessage text={d.report} />
          ) : (
            <p className="evals-muted">{t("evals.detail.empty")}</p>
          )
        ) : null}
        {props.tab === "diff" ? (
          d.files.length === 0 ? (
            <p className="evals-muted">{t("evals.detail.noChanges")}</p>
          ) : (
            d.files.map((f) => (
              <details key={f.path} className="evals-file" open={d.files.length <= 3}>
                <summary>
                  <code>{f.path}</code> <span className={`evals-file-${f.status}`}>{t(`evals.status.${f.status}`)}</span>
                </summary>
                {f.binary ? (
                  <p className="evals-muted">{t("evals.detail.binary")}</p>
                ) : (
                  <div className="evals-file-sides">
                    {f.status !== "added" ? (
                      <div>
                        <small>{t("evals.detail.before")}</small>
                        <pre>{f.before}</pre>
                      </div>
                    ) : null}
                    {f.status !== "deleted" ? (
                      <div>
                        <small>{t("evals.detail.after")}</small>
                        <pre>{f.after}</pre>
                      </div>
                    ) : null}
                  </div>
                )}
              </details>
            ))
          )
        ) : null}
        {props.tab === "audit" ? (
          d.audit.length === 0 ? (
            <p className="evals-muted">{t("evals.detail.empty")}</p>
          ) : (
            <pre className="evals-audit">{d.audit.join("\n")}</pre>
          )
        ) : null}
      </div>
    </div>
  );
}
