import type { EvalCatalog, EvalConfig, EvalRun, EvalStatus, EvalTaskInfo } from "./types";

/**
 * Evals page settings (`EvalsPage.tsx`): the config being edited plus named ones, kept in
 * `localStorage` `silence.evals.v1`. The Engine checks every config again (`eval_rpc.rs`).
 */
export type EvalStore = { current: EvalConfig; saved: Record<string, EvalConfig> };

export const MAX_REPEAT = 5;
/** `source` = mỗi task chạy model ghim của nó. Không có `source` = nguồn trong `evals/config.yaml`. */
export const PER_TASK = "per-task";

/** v0, every task, each task's own model, one attempt, $1 cap, no history line. */
export const DEFAULT_EVAL_CONFIG: EvalConfig = {
  suite: "v0",
  tasks: [],
  repeat: 1,
  retry_failed: false,
  max_cost: 1,
  history: false,
};

const KEY = "silence.evals.v1";

function isConfig(v: unknown): v is EvalConfig {
  const c = v as EvalConfig;
  return Boolean(c) && typeof c.suite === "string" && Array.isArray(c.tasks);
}

export function loadEvalStore(): EvalStore {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<EvalStore> | null;
    const saved: Record<string, EvalConfig> = {};
    for (const [k, c] of Object.entries(v?.saved ?? {})) if (isConfig(c)) saved[k] = c;
    return { current: isConfig(v?.current) ? v!.current : { ...DEFAULT_EVAL_CONFIG }, saved };
  } catch {
    return { current: { ...DEFAULT_EVAL_CONFIG }, saved: {} };
  }
}

export function saveEvalStore(s: EvalStore) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: settings reset on reload */
  }
}

export function suiteTasks(catalog: EvalCatalog | null, suite: string): EvalTaskInfo[] {
  return catalog?.suites.find((s) => s.name === suite)?.tasks ?? [];
}

/** The default config with every task of its suite selected. */
export function resetConfig(catalog: EvalCatalog | null): EvalConfig {
  const suite = catalog?.suites.some((s) => s.name === DEFAULT_EVAL_CONFIG.suite)
    ? DEFAULT_EVAL_CONFIG.suite
    : (catalog?.suites[0]?.name ?? DEFAULT_EVAL_CONFIG.suite);
  return { ...DEFAULT_EVAL_CONFIG, suite, tasks: suiteTasks(catalog, suite).map((t) => t.id) };
}

/** Switch suite: select all of its tasks. */
export function withSuite(cfg: EvalConfig, suite: string, catalog: EvalCatalog | null): EvalConfig {
  return { ...cfg, suite, tasks: suiteTasks(catalog, suite).map((t) => t.id) };
}

/**
 * Keep a (saved or stale) config valid for the current catalog: unknown suite → default,
 * task ids that no longer exist dropped, unknown source dropped, numbers clamped.
 */
export function sanitize(cfg: EvalConfig, catalog: EvalCatalog | null): EvalConfig {
  if (!catalog?.available) return cfg;
  if (!catalog.suites.some((s) => s.name === cfg.suite)) return resetConfig(catalog);
  const ids = new Set(suiteTasks(catalog, cfg.suite).map((t) => t.id));
  const out: EvalConfig = {
    ...cfg,
    tasks: cfg.tasks.filter((id) => ids.has(id)),
    repeat: Math.min(MAX_REPEAT, Math.max(1, Math.round(cfg.repeat || 1))),
  };
  if (out.source && out.source !== PER_TASK && !catalog.sources.some((s) => s.id === out.source)) delete out.source;
  if (out.max_cost !== undefined && !(out.max_cost >= 0)) delete out.max_cost;
  return out;
}

/** Tasks that failed or errored in a run (for "Re-run failed"). */
export function failedIds(run: { tasks: { id: string; status: EvalStatus }[] }): string[] {
  return run.tasks.filter((t) => t.status === "FAIL" || t.status === "ERROR").map((t) => t.id);
}

/** A config that re-runs only the failed tasks of `run`, keeping the other settings. */
export function rerunFailed(cfg: EvalConfig, run: EvalRun | { suite: string; tasks: { id: string; status: EvalStatus }[] }): EvalConfig {
  return { ...cfg, suite: run.suite, tasks: failedIds(run) };
}

/** Task ids whose last result was FAIL/ERROR (the "only failed last time" filter). */
export function lastFailed(tasks: EvalTaskInfo[]): string[] {
  return tasks.filter((t) => t.last?.status === "FAIL" || t.last?.status === "ERROR").map((t) => t.id);
}

/** Model the task runs on before the source mapping (manifest → pin → default). */
export function ownModel(t: EvalTaskInfo, override?: string): string {
  return override || t.manifest_model || t.pinned || "claude-haiku";
}
