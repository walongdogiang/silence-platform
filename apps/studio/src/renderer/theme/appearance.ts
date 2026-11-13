import { DEFAULT_LANG, isLang, type Lang } from "../i18n";
export type ThemeMode = "dark" | "light" | "auto";
export type PaletteId = "espresso" | "graphite" | "forest" | "ocean" | "plum";
export type AccentId = "copper" | "blue" | "teal" | "green" | "violet" | "rose";
export type DensityId = "compact" | "default" | "spacious";
export type WallpaperId = "none" | "mountains" | "aurora" | "forest" | "desert" | "ocean";

export type Appearance = {
  version: 1;
  theme: ThemeMode;
  palette: PaletteId;
  accent: AccentId;
  density: DensityId;
  wallpaper: WallpaperId;
  blur: boolean;
  reduceMotion: boolean;
  /** UI language (`i18n.ts`). */
  lang: Lang;
};

export const DEFAULT_APPEARANCE: Appearance = {
  version: 1,
  theme: "dark",
  palette: "espresso",
  accent: "copper",
  density: "default",
  wallpaper: "mountains",
  blur: false,
  reduceMotion: false,
  lang: DEFAULT_LANG,
};

const KEY = "silence.appearance.v2";

export const ACCENTS: Record<AccentId, { accent: string; hover: string; soft: string; muted: string }> = {
  copper: { accent: "#E5A05B", hover: "#F0B273", soft: "#F0D4B0", muted: "rgba(229, 160, 91, 0.12)" },
  blue: { accent: "#6EA4D8", hover: "#86B6E4", soft: "#B7D4F2", muted: "#35516E" },
  teal: { accent: "#5FB8A8", hover: "#74C8B8", soft: "#A9DDD4", muted: "#2F5E56" },
  green: { accent: "#6BB57A", hover: "#7FC48C", soft: "#B4DDBB", muted: "#355C3E" },
  violet: { accent: "#A48BCC", hover: "#B59DD8", soft: "#D3C4EA", muted: "#52446C" },
  rose: { accent: "#C97A8A", hover: "#D5909D", soft: "#E8B8C1", muted: "#6A3D47" },
};

function resolvedTheme(mode: ThemeMode): "dark" | "light" {
  if (mode !== "auto") return mode;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function loadAppearance(): Appearance {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE };
    const parsed = JSON.parse(raw) as Partial<Appearance>;
    const merged = { ...DEFAULT_APPEARANCE, ...parsed, version: 1 as const };
    return isLang(merged.lang) ? merged : { ...merged, lang: DEFAULT_LANG };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveAppearance(next: Appearance) {
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function applyAppearance(a: Appearance) {
  const root = document.documentElement;
  const theme = resolvedTheme(a.theme);
  root.dataset.theme = theme;
  root.dataset.palette = a.palette;
  root.dataset.density = a.density;
  root.dataset.wallpaper = a.wallpaper;
  root.dataset.blur = a.blur ? "on" : "off";
  root.dataset.motion = a.reduceMotion ? "reduce" : "full";
  root.lang = a.lang;
  const acc = ACCENTS[a.accent];
  root.style.setProperty("--accent", acc.accent);
  root.style.setProperty("--accent-hover", acc.hover);
  root.style.setProperty("--accent-soft", acc.soft);
  root.style.setProperty("--accent-muted", acc.muted);
}
