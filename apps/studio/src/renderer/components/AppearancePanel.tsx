import { Monitor, Moon, Sun, X } from "lucide-react";
import { PermissionsSection } from "./PermissionsSection";
import { LANGS, useT, type MsgKey } from "../i18n";
import type { UiPermMode } from "../permissionUi";
import mountains from "../assets/wallpapers/mountains.png";
import {
  ACCENTS,
  DEFAULT_APPEARANCE,
  type AccentId,
  type Appearance,
  type DensityId,
  type PaletteId,
  type ThemeMode,
  type WallpaperId,
} from "../theme/appearance";

const PALETTES: { id: PaletteId; label: string; swatch: string }[] = [
  { id: "espresso", label: "Espresso", swatch: "#1e1f21" },
  { id: "graphite", label: "Graphite", swatch: "#232426" },
  { id: "forest", label: "Forest", swatch: "#6bb57a" },
  { id: "ocean", label: "Ocean", swatch: "#5fb8a8" },
  { id: "plum", label: "Plum", swatch: "#a48bcc" },
];

/** Palette names above are theme names (not translated); the rest follows the UI language. */
const WALLS: WallpaperId[] = ["none", "aurora", "mountains", "forest", "desert", "ocean"];

const THEMES: { id: ThemeMode; label: MsgKey; icon: typeof Moon }[] = [
  { id: "dark", label: "appear.dark", icon: Moon },
  { id: "light", label: "appear.light", icon: Sun },
  { id: "auto", label: "appear.auto", icon: Monitor },
];

export function AppearancePanel(props: {
  open: boolean;
  value: Appearance;
  onChange: (next: Appearance) => void;
  onClose: () => void;
  workspace?: string;
  permMode: UiPermMode;
  onPermMode: (m: UiPermMode) => void;
}) {
  const t = useT();
  if (!props.open) return null;
  const a = props.value;
  const set = (patch: Partial<Appearance>) => props.onChange({ ...a, ...patch });

  return (
    <aside className="appear">
      <header>
        <h2>{t("appear.title")}</h2>
        <button type="button" className="icon-btn" onClick={props.onClose} aria-label={t("common.close")}>
          <X size={16} />
        </button>
      </header>

      <div className="appear-sec">
        <h3>{t("appear.language")}</h3>
        <div className="seg">
          {LANGS.map((l) => (
            <button key={l.id} type="button" className={a.lang === l.id ? "on" : ""} onClick={() => set({ lang: l.id })}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="appear-sec">
        <h3>{t("appear.theme")}</h3>
        <div className="seg theme">
          {THEMES.map((th) => {
            const Icon = th.icon;
            return (
              <button key={th.id} type="button" className={a.theme === th.id ? "on" : ""} onClick={() => set({ theme: th.id })}>
                <Icon size={14} />
                {t(th.label)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="appear-sec">
        <h3>{t("appear.palette")}</h3>
        <div className="dots">
          {PALETTES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={a.palette === p.id ? "on" : ""}
              style={{ background: p.swatch }}
              title={p.label}
              aria-label={p.label}
              onClick={() => set({ palette: p.id })}
            />
          ))}
        </div>
      </div>

      <div className="appear-sec">
        <h3>{t("appear.density")}</h3>
        <div className="seg">
          {(["compact", "default", "spacious"] as DensityId[]).map((d) => (
            <button key={d} type="button" className={a.density === d ? "on" : ""} onClick={() => set({ density: d })}>
              {t(`appear.density.${d}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="appear-sec">
        <h3>{t("appear.accent")}</h3>
        <div className="dots">
          {(Object.keys(ACCENTS) as AccentId[]).map((id) => (
            <button
              key={id}
              type="button"
              className={a.accent === id ? "on" : ""}
              style={{ background: ACCENTS[id].accent }}
              title={t(`appear.accent.${id}`)}
              aria-label={t(`appear.accent.${id}`)}
              onClick={() => set({ accent: id })}
            />
          ))}
        </div>
      </div>

      <div className="appear-sec">
        <h3>{t("appear.background")}</h3>
        <div className="wall-grid">
          {WALLS.map((w) => (
            <button
              key={w}
              type="button"
              className={`wall-thumb ${a.wallpaper === w ? "on" : ""}`}
              data-wall={w}
              onClick={() => set({ wallpaper: w })}
              style={w === "mountains" ? { backgroundImage: `url(${mountains})` } : undefined}
            >
              <span>{t(`appear.wall.${w}`)}</span>
            </button>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={a.blur} onChange={(e) => set({ blur: e.target.checked })} />
          {t("appear.blur")}
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={a.reduceMotion}
            onChange={(e) => set({ reduceMotion: e.target.checked })}
          />
          {t("appear.reduceMotion")}
        </label>
      </div>

      <PermissionsSection workspace={props.workspace ?? ""} mode={props.permMode} onMode={props.onPermMode} />

      <button type="button" className="ghost" onClick={() => props.onChange({ ...DEFAULT_APPEARANCE })}>
        {t("appear.reset")}
      </button>
    </aside>
  );
}
