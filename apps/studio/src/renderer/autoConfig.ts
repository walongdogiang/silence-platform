import type { ModelInfo } from "./types";
import type { SessionMode } from "./modes";
import { modelName } from "./theme/modelsPrefs";

/**
 * Auto model settings, one per source (provider). Auto never reads the prompt: the Engine maps
 * mode + purpose to a slot (Plan/Review → Frontier, Agent/Ask/Debug/Multitask → Strong, titles
 * and explore sub-agents → Small), escalates on trouble, then picks the slot's model here.
 * The slot → model rules mirror `crates/router/src/auto.rs`; the Engine stays the authority.
 */
export type AutoSlot = "small" | "strong" | "frontier";
export type AutoPreset = "balanced" | "economy" | "max" | "custom";
export type AutoConfig = {
  preset: AutoPreset;
  slots?: { frontier?: string; strong?: string; small?: string };
  /** Model ids Auto may use; empty = every non-opt-in model of the source. */
  pool?: string[];
  /** Spend cap per session (USD). */
  budget_usd?: number;
  /** Main-turn slot per mode; missing = `MODE_SLOT_DEFAULT`. */
  mode_slots?: Partial<Record<SessionMode, AutoSlot>>;
};

/** Mode order of the composer menu. */
export const AUTO_MODES: SessionMode[] = ["ask", "agent", "plan"];

/** Default slot of each mode's main turn (same as the Engine's `ModeProfile.slot`). */
export const MODE_SLOT_DEFAULT: Record<SessionMode, AutoSlot> = {
  plan: "frontier",
  agent: "strong",
  ask: "strong",
};

export function modeSlot(cfg: AutoConfig, mode: SessionMode): AutoSlot {
  return cfg.mode_slots?.[mode] ?? MODE_SLOT_DEFAULT[mode];
}

/** Set a mode's slot; picking the default removes the override (keeps the config small). */
export function withModeSlot(cfg: AutoConfig, mode: SessionMode, slot: AutoSlot): AutoConfig {
  const next = { ...(cfg.mode_slots ?? {}) };
  if (slot === MODE_SLOT_DEFAULT[mode]) delete next[mode];
  else next[mode] = slot;
  const { mode_slots: _old, ...rest } = cfg;
  return Object.keys(next).length > 0 ? { ...rest, mode_slots: next } : rest;
}

export const AUTO_SLOTS: AutoSlot[] = ["frontier", "strong", "small"];

/** Preset ids in display order; labels and hints come from `i18n.ts` (`preset.<id>`). */
export const PRESETS: { id: AutoPreset }[] = [{ id: "balanced" }, { id: "economy" }, { id: "max" }, { id: "custom" }];

export const DEFAULT_AUTO: AutoConfig = { preset: "balanced" };

const STORE_KEY = "silence.auto.v1";

export function tierRank(tier: string): number {
  return ({ free: 0, fast: 1, mid: 2, strong: 3 } as Record<string, number>)[tier] ?? 2;
}

export function presetTier(preset: AutoPreset, slot: AutoSlot): string {
  if (preset === "economy") return slot === "frontier" ? "mid" : "fast";
  if (preset === "max") return slot === "small" ? "fast" : "strong";
  return slot === "frontier" ? "strong" : slot === "strong" ? "mid" : "fast";
}

/** Models Auto may use on a source: the pool if set, else every non-opt-in model. */
export function autoCandidates(cfg: AutoConfig, source: string, models: ModelInfo[]): ModelInfo[] {
  const of = models.filter((m) => m.provider === source);
  const pool = cfg.pool ?? [];
  if (pool.length > 0) {
    const pooled = of.filter((m) => pool.includes(m.id));
    if (pooled.length > 0) return pooled;
  }
  return of.filter((m) => !m.opt_in);
}

function nearest(cands: ModelInfo[], rank: number): ModelInfo | null {
  let best: ModelInfo | null = null;
  let key: [number, number] = [Infinity, 0];
  for (const m of cands) {
    const r = tierRank(m.tier);
    const k: [number, number] = [Math.abs(r - rank), -r];
    if (k[0] < key[0] || (k[0] === key[0] && k[1] < key[1])) {
      best = m;
      key = k;
    }
  }
  return best;
}

/** The model a slot resolves to on `source` (same rules as the Engine). */
export function slotModel(cfg: AutoConfig, slot: AutoSlot, source: string, models: ModelInfo[]): ModelInfo | null {
  const cands = autoCandidates(cfg, source, models);
  if (cfg.preset === "custom") {
    const id = cfg.slots?.[slot];
    const pinned = id ? cands.find((m) => m.id === id) : undefined;
    if (pinned) return pinned;
  }
  return nearest(cands, tierRank(presetTier(cfg.preset, slot)));
}

/** Family name without vendor and version: "Claude Opus 5.5" → "Opus". */
const short = (m: ModelInfo | null) => (m ? modelName(m).replace(/^Claude\s+/i, "").replace(/\s+[\d.]+$/, "") : "—");

/** Picker-style name without the vendor prefix: "Claude Opus 5.5" → "Opus 5.5" (composer spec). */
export function shortName(m: ModelInfo | null | undefined): string {
  return m ? modelName(m).replace(/^Claude\s+/i, "") : "—";
}

/** "Opus · Sonnet · Haiku" (Frontier · Strong · Small): fits one menu line. */
export function autoSummaryShort(cfg: AutoConfig, source: string, models: ModelInfo[]): string {
  const ms = AUTO_SLOTS.map((slot) => slotModel(cfg, slot, source, models));
  return ms.every((m) => !m) ? "" : ms.map(short).join(" · ");
}

/**
 * What a new pool changes: each slot whose model moves, with its new model (the UI writes
 * "Frontier → Sonnet 5.5"). Empty when nothing changes or the pool would be empty.
 */
export function poolImpact(
  cfg: AutoConfig,
  source: string,
  models: ModelInfo[],
  nextPool: string[],
): { slot: AutoSlot; model: string }[] {
  if (nextPool.length === 0) return [];
  const next = { ...cfg, pool: nextPool };
  const out: { slot: AutoSlot; model: string }[] = [];
  for (const slot of AUTO_SLOTS) {
    const a = slotModel(cfg, slot, source, models);
    const b = slotModel(next, slot, source, models);
    if (a?.id !== b?.id) out.push({ slot, model: shortName(b) });
  }
  return out;
}

export function isAutoConfig(v: unknown): v is AutoConfig {
  if (!v || typeof v !== "object") return false;
  const p = (v as AutoConfig).preset;
  return PRESETS.some((x) => x.id === p);
}

/** Saved Auto settings per source id. Not a secret. */
export function loadAuto(): Record<string, AutoConfig> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, AutoConfig> = {};
    for (const [k, c] of Object.entries(v ?? {})) if (isAutoConfig(c)) out[k] = c;
    return out;
  } catch {
    return {};
  }
}

export function saveAuto(all: Record<string, AutoConfig>) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* storage blocked: settings reset on reload */
  }
}

/**
 * What the Engine gets: models switched off in Settings never enter Auto's pool. With an empty
 * pool and some models off, the pool becomes the source's models that are still on.
 */
export function engineConfig(cfg: AutoConfig, source: string, visible: ModelInfo[], catalog: ModelInfo[]): AutoConfig {
  const on = new Set(visible.filter((m) => m.provider === source).map((m) => m.id));
  const pool = (cfg.pool ?? []).filter((id) => on.has(id));
  if (pool.length > 0) return { ...cfg, pool };
  const defaults = catalog.filter((m) => m.provider === source && !m.opt_in);
  if (defaults.every((m) => on.has(m.id))) return { ...cfg, pool: [] };
  const left = defaults.filter((m) => on.has(m.id)).map((m) => m.id);
  return { ...cfg, pool: left.length > 0 ? left : [] };
}

export function autoFor(all: Record<string, AutoConfig>, source: string): AutoConfig {
  return all[source] ?? DEFAULT_AUTO;
}

/** Short model name for "Auto · Sonnet" on the picker trigger and the turn chip. */
export function autoModelLabel(id: string, models: ModelInfo[]): string {
  const m = models.find((x) => x.id === id);
  return m ? shortName(m) : id;
}

/** Route purposes that are side calls (not the main turn). */
export function isSideRoute(taskClass: string): boolean {
  return taskClass === "title" || taskClass.startsWith("subagent:");
}

/** Spend of the current session split by Auto slot (from `cost` events). */
export type SlotSpend = { usd: number; baseline: number; bySlot: Record<AutoSlot, number> };

export const EMPTY_SPEND: SlotSpend = { usd: 0, baseline: 0, bySlot: { frontier: 0, strong: 0, small: 0 } };

export function addSpend(
  s: SlotSpend,
  ev: { usd: number; slot?: string; baseline_usd?: number },
): SlotSpend {
  const slot = AUTO_SLOTS.includes(ev.slot as AutoSlot) ? (ev.slot as AutoSlot) : null;
  return {
    usd: s.usd + ev.usd,
    baseline: s.baseline + (ev.baseline_usd && ev.baseline_usd > 0 ? ev.baseline_usd : ev.usd),
    bySlot: slot ? { ...s.bySlot, [slot]: s.bySlot[slot] + ev.usd } : s.bySlot,
  };
}

export function fmtUsd(v: number): string {
  if (v === 0) return "$0";
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

const SPEND_KEY = "silence.auto.spend.v1";

function isSpend(v: unknown): v is SlotSpend {
  const s = v as SlotSpend;
  return Boolean(s) && typeof s.usd === "number" && typeof s.baseline === "number" && typeof s.bySlot === "object";
}

/**
 * Spend per chat thread. Kept here (not only in the Engine) so the Auto cap survives an Engine
 * restart or a new live session for the same thread: the UI re-sends it with
 * `session.carry_spend` before each turn.
 */
export function loadSpend(): Record<string, SlotSpend> {
  try {
    const v = JSON.parse(localStorage.getItem(SPEND_KEY) ?? "{}") as Record<string, unknown>;
    const out: Record<string, SlotSpend> = {};
    for (const [k, x] of Object.entries(v ?? {})) if (isSpend(x)) out[k] = x;
    return out;
  } catch {
    return {};
  }
}

/** Keep the 200 most recent threads only (`keep` = live thread ids, newest first). */
export function saveSpend(all: Record<string, SlotSpend>, keep?: string[]) {
  try {
    const ids = keep ? keep.slice(0, 200) : Object.keys(all);
    const out: Record<string, SlotSpend> = {};
    for (const id of ids) if (all[id]) out[id] = all[id];
    localStorage.setItem(SPEND_KEY, JSON.stringify(out));
  } catch {
    /* storage blocked */
  }
}
