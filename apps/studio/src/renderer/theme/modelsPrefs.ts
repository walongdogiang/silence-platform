import type { ModelInfo } from "../types";

export type ModelPrefs = {
  disabled: string[];
  extras: ModelInfo[];
};

const KEY = "silence.models.prefs.v1";

export function loadModelPrefs(): ModelPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { disabled: [], extras: [] };
    const parsed = JSON.parse(raw) as Partial<ModelPrefs>;
    return {
      disabled: Array.isArray(parsed.disabled) ? parsed.disabled : [],
      extras: Array.isArray(parsed.extras) ? parsed.extras : [],
    };
  } catch {
    return { disabled: [], extras: [] };
  }
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

export function speedLabel(tier: string) {
  const t = tier.trim().toLowerCase();
  if (t === "high-fast" || t === "highfast" || t === "high_fast") return "High Fast";
  if (t === "fast") return "Fast";
  if (t === "mid" || t === "medium") return "Medium";
  if (t === "strong" || t === "high") return "High";
  if (t === "free") return "Free";
  return tier.trim();
}

export function modelParts(m: { id: string; label?: string; api_model?: string; tier: string }) {
  const name = modelName(m);
  const speed = speedLabel(m.tier);
  if (!speed) return { name, speed: "" };
  if (name.toLowerCase().endsWith(` ${speed.toLowerCase()}`)) {
    return { name: name.slice(0, -(speed.length + 1)).trimEnd(), speed };
  }
  return { name, speed };
}

export function modelTitle(m: { id: string; label?: string; api_model?: string; tier: string }) {
  const { name, speed } = modelParts(m);
  return speed ? `${name} ${speed}` : name;
}

export function visibleModels(catalog: ModelInfo[], prefs: ModelPrefs): ModelInfo[] {
  const extra = prefs.extras.filter((e) => !catalog.some((c) => c.id === e.id));
  return [...catalog, ...extra].filter((m) => !prefs.disabled.includes(m.id));
}
