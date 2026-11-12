import type { ModelInfo } from "../types";

export type ModelPrefs = {
  /** Normal models the user switched off. */
  disabled: string[];
  /** `opt_in` models (off by default, e.g. Fable) the user switched on. */
  enabled: string[];
  extras: ModelInfo[];
};

const KEY = "silence.models.prefs.v1";

const EMPTY: ModelPrefs = { disabled: [], enabled: [], extras: [] };

export function parseModelPrefs(raw: string | null): ModelPrefs {
  if (!raw) return { ...EMPTY };
  try {
    const parsed = JSON.parse(raw) as Partial<ModelPrefs>;
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    return {
      disabled: ids(parsed.disabled),
      enabled: ids(parsed.enabled),
      extras: Array.isArray(parsed.extras) ? parsed.extras : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

export function loadModelPrefs(): ModelPrefs {
  try {
    return parseModelPrefs(localStorage.getItem(KEY));
  } catch {
    return { ...EMPTY };
  }
}

/** On in the picker: `opt_in` models only when switched on, others unless switched off. */
export function isModelOn(m: { id: string; opt_in?: boolean }, prefs: ModelPrefs): boolean {
  return m.opt_in ? prefs.enabled.includes(m.id) : !prefs.disabled.includes(m.id);
}

/** Flip a model's switch in Settings (opt-in models use `enabled`, others `disabled`). */
export function toggleModel(m: { id: string; opt_in?: boolean }, prefs: ModelPrefs): ModelPrefs {
  const flip = (list: string[]) => (list.includes(m.id) ? list.filter((x) => x !== m.id) : [...list, m.id]);
  return m.opt_in ? { ...prefs, enabled: flip(prefs.enabled) } : { ...prefs, disabled: flip(prefs.disabled) };
}

export function saveModelPrefs(p: ModelPrefs) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

const KNOWN_NAMES: Record<string, string> = {
  "claude-haiku": "Claude Haiku 5.5",
  "claude-sonnet": "Claude Sonnet 5.5",
  "claude-opus": "Claude Opus 5.5",
  "north-mini-code": "North Mini Code",
  "nemotron-3-ultra": "Nemotron 3 Ultra",
  "xing4-29b": "Xing4.0 29B A4B",
};

function humanizeSlug(id: string) {
  const raw = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  return raw.replace(/[-_]+/g, " ").replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

function looksLikeName(s: string, id: string) {
  return Boolean(s) && s !== id && !s.includes("/");
}

export function modelName(m: { id: string; label?: string; api_model?: string }) {
  const given = m.label?.trim() ?? "";
  if (looksLikeName(given, m.id)) return given;
  if (KNOWN_NAMES[m.id]) return KNOWN_NAMES[m.id];
  const slug = m.api_model?.trim() || given || m.id;
  return humanizeSlug(slug);
}

/**
 * Rows for the model picker: only models that can run now (a source without a key or without the
 * CLI is hidden; the selected model always stays so the check mark never vanishes). `dupes` holds
 * the ids whose display name appears more than once (same model from two sources), the only rows
 * that need a source suffix to tell them apart.
 */
export function pickerRows<T extends { id: string; label?: string; api_model?: string; available?: boolean }>(
  models: T[],
  selectedId: string,
): { rows: T[]; dupes: Set<string> } {
  const rows = models.filter((m) => m.available !== false || m.id === selectedId);
  const count = new Map<string, number>();
  for (const m of rows) count.set(modelName(m), (count.get(modelName(m)) ?? 0) + 1);
  return { rows, dupes: new Set(rows.filter((m) => (count.get(modelName(m)) ?? 0) > 1).map((m) => m.id)) };
}

/** Display name only. The tier (`fast`/`mid`/`strong`/`free`) is Auto's routing hint, not shown. */
export function modelTitle(m: { id: string; label?: string; api_model?: string; tier?: string }) {
  return modelName(m);
}

/** `opt_in` models still switched off: listed in the picker as locked, with an Enable button. */
export function lockedModels(catalog: ModelInfo[], prefs: ModelPrefs): ModelInfo[] {
  return catalog.filter((m) => m.opt_in && !isModelOn(m, prefs));
}

export function visibleModels(catalog: ModelInfo[], prefs: ModelPrefs): ModelInfo[] {
  const extra = prefs.extras.filter((e) => !catalog.some((c) => c.id === e.id));
  return [...catalog, ...extra].filter((m) => isModelOn(m, prefs));
}
