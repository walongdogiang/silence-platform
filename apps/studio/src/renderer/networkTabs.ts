import type { ModelPrefs } from "./theme/modelsPrefs";
import type { ModelInfo } from "./types";

/** Settings → Model is split into three tabs; the last one picked is remembered. */
export type NetworkTab = "sources" | "auto" | "models";

export const NETWORK_TABS: NetworkTab[] = ["sources", "auto", "models"];

const KEY = "silence.shell.networkTab";

export function isNetworkTab(v: unknown): v is NetworkTab {
  return typeof v === "string" && (NETWORK_TABS as string[]).includes(v);
}

export function loadNetworkTab(): NetworkTab {
  try {
    const v = localStorage.getItem(KEY);
    return isNetworkTab(v) ? v : "sources";
  } catch {
    return "sources";
  }
}

export function saveNetworkTab(tab: NetworkTab) {
  try {
    localStorage.setItem(KEY, tab);
  } catch {
    /* storage blocked: the page opens on Sources next time */
  }
}

export type ModelGroup = { id: string; label: string; models: ModelInfo[] };

/**
 * Models grouped by source, in first-seen order. Models without a provider (user-added OpenRouter
 * slugs) join the OpenRouter-compatible source when there is one, otherwise an "other" group.
 */
export function groupModels(models: ModelInfo[], otherLabel: string): ModelGroup[] {
  const groups: ModelGroup[] = [];
  const compat = models.find((m) => m.provider_kind === "openai_compat" && m.provider);
  for (const m of models) {
    const id = m.provider || compat?.provider || "_other";
    const label = m.provider ? m.provider_label || m.provider : compat ? compat.provider_label || compat.provider! : otherLabel;
    let g = groups.find((x) => x.id === id);
    if (!g) {
      g = { id, label, models: [] };
      groups.push(g);
    }
    g.models.push(m);
  }
  return groups;
}

/** Case-insensitive match on the shown name, id and source label. */
export function matchesFilter(m: ModelInfo, title: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [title, m.id, m.provider_label ?? ""].some((s) => s.toLowerCase().includes(q));
}

/**
 * Focus requests from the composer carry `Date.now()`. App keeps the last one around, so a page
 * mounted later must ignore it instead of jumping tabs again.
 */
export function isFreshFocus(n: number | undefined, now = Date.now(), maxAgeMs = 3000): boolean {
  return typeof n === "number" && n > 0 && now - n <= maxAgeMs;
}

/** Every switch back to its default (opt-in models off, the rest on); user-added models stay. */
export function defaultPrefs(prefs: ModelPrefs): ModelPrefs {
  return { disabled: [], enabled: [], extras: prefs.extras };
}

/** Structural equality for small JSON-like settings (key order ignored). */
export function sameValue(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "undefined";
}
