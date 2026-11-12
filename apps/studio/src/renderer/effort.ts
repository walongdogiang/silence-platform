import type { ModelInfo } from "./types";

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";
export type Effort = "auto" | EffortLevel;

export const EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

export const EFFORT_LABEL: Record<Effort, string> = {
  auto: "Auto",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra",
  max: "Max",
};

const STORE_KEY = "silence.composer.pick.v1";

export function isEffort(v: unknown): v is Effort {
  return v === "auto" || EFFORT_LEVELS.includes(v as EffortLevel);
}

/**
 * Levels the picker offers for `modelId`. Auto routes between catalog models, so it offers the
 * levels every routed model shares; an explicit model offers its own `efforts`.
 */
export function effortOptions(modelId: string, models: ModelInfo[]): EffortLevel[] {
  if (modelId !== "auto") {
    const m = models.find((x) => x.id === modelId);
    // Models added in Settings (OpenRouter slugs) carry no `efforts`; the Engine gives them all.
    if (!m || m.efforts === undefined) return [...EFFORT_LEVELS];
    return m.efforts.filter((e): e is EffortLevel => EFFORT_LEVELS.includes(e as EffortLevel));
  }
  const withEffort = models.filter((m) => (m.efforts ?? []).length > 0);
  if (withEffort.length === 0) return [];
  return EFFORT_LEVELS.filter((e) => withEffort.every((m) => (m.efforts ?? []).includes(e)));
}

/**
 * The level marked "Recommended": the model's `default_effort`, which the Engine also sends when
 * the pick is `auto`. On Auto (model) it is the default every effort-capable model shares, or
 * null when they differ.
 */
export function recommendedEffort(modelId: string, models: ModelInfo[]): EffortLevel | null {
  const valid = (d?: string) => (d && EFFORT_LEVELS.includes(d as EffortLevel) ? (d as EffortLevel) : null);
  if (modelId !== "auto") return valid(models.find((x) => x.id === modelId)?.default_effort);
  // Untuned models (no default) send nothing on `auto`, so they do not count.
  const defaults = new Set(
    models.filter((m) => (m.efforts ?? []).length > 0 && m.default_effort).map((m) => m.default_effort),
  );
  return defaults.size === 1 ? valid([...defaults][0]) : null;
}

/** Keep a pick valid after a model switch: an unsupported level goes back to `auto`. */
export function normalizeEffort(effort: Effort, modelId: string, models: ModelInfo[]): Effort {
  if (effort === "auto") return "auto";
  return effortOptions(modelId, models).includes(effort) ? effort : "auto";
}

type Box = { left: number; right: number; top: number; bottom: number };

/**
 * Where to put the Effort submenu (viewport coords, for `position: fixed`): beside the model
 * menu on the side with room (right first), else over the menu itself. Its bottom lines up
 * with the Effort row, then it is clamped inside the viewport.
 */
export function placeSubmenu(
  menu: Box,
  row: Box,
  size: { w: number; h: number },
  viewport: { w: number; h: number },
  gap = 8,
  margin = 8,
): { left: number; top: number; side: "right" | "left" | "over" } {
  let side: "right" | "left" | "over";
  let left: number;
  if (viewport.w - menu.right - gap - margin >= size.w) {
    side = "right";
    left = menu.right + gap;
  } else if (menu.left - gap - margin >= size.w) {
    side = "left";
    left = menu.left - gap - size.w;
  } else {
    side = "over";
    left = Math.min(Math.max(menu.right - size.w, margin), viewport.w - size.w - margin);
  }
  const maxTop = Math.max(margin, viewport.h - size.h - margin);
  const top = Math.min(Math.max(row.bottom - size.h, margin), maxTop);
  return { left: Math.max(margin, left), top, side };
}

export type ComposerPick = { model: string; effort: Effort };

export function loadPick(): ComposerPick {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { model: "auto", effort: "auto" };
    const v = JSON.parse(raw) as Partial<ComposerPick>;
    return {
      model: typeof v.model === "string" && v.model ? v.model : "auto",
      effort: isEffort(v.effort) ? v.effort : "auto",
    };
  } catch {
    return { model: "auto", effort: "auto" };
  }
}

/** A model source (provider) as the picker shows it, derived from `models.list`. */
export type ModelSource = {
  id: string;
  label: string;
  kind: string;
  available: boolean;
  reason: string;
};

/**
 * Sources in catalog order. Models with no `provider` (added in Settings as OpenRouter slugs)
 * belong to the first source, as the Engine routes ad-hoc ids there.
 */
export function modelSources(models: ModelInfo[]): ModelSource[] {
  const out: ModelSource[] = [];
  for (const m of models) {
    if (!m.provider) continue;
    let s = out.find((x) => x.id === m.provider);
    if (!s) {
      s = {
        id: m.provider,
        label: m.provider_label || m.provider,
        kind: m.provider_kind ?? "",
        available: false,
        reason: m.unavailable_reason ?? "",
      };
      out.push(s);
    }
    if (m.available !== false) {
      s.available = true;
      s.reason = "";
    }
  }
  return out;
}

export function sourceOf(m: ModelInfo, sources: ModelSource[]): string {
  return m.provider || sources[0]?.id || "";
}

/** The saved source if it still exists, else the first usable one, else the first one. */
export function resolveSource(saved: string, sources: ModelSource[]): string {
  if (sources.some((s) => s.id === saved)) return saved;
  return (sources.find((s) => s.available) ?? sources[0])?.id ?? "";
}

/**
 * The model to use after switching to `source`: keep the current one if it belongs there;
 * otherwise Auto, except on the Claude CLI (Auto never routes there), where the mid model
 * (or the first one) is picked.
 */
export function modelForSource(current: string, source: string, models: ModelInfo[]): string {
  const sources = modelSources(models);
  const inSource = models.filter((m) => sourceOf(m, sources) === source);
  if (inSource.some((m) => m.id === current)) return current;
  const kind = sources.find((s) => s.id === source)?.kind;
  if (kind !== "claude_cli") return "auto";
  return (inSource.find((m) => m.tier === "mid") ?? inSource[0])?.id ?? "auto";
}

const PREFERRED_KEY = "silence.models.preferredProvider";

/** The source the picker shows (also the provider Auto prefers). Not a secret. */
export function loadPreferredProvider(): string {
  try {
    return localStorage.getItem(PREFERRED_KEY) ?? "";
  } catch {
    return "";
  }
}

export function savePreferredProvider(provider: string) {
  try {
    localStorage.setItem(PREFERRED_KEY, provider);
  } catch {
    /* ignore */
  }
}

export function savePick(pick: ComposerPick) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(pick));
  } catch {
    /* storage blocked: the pick just resets on reload */
  }
}
