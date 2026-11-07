import { Monitor, Moon, Sun, X } from "lucide-react";
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

const WALLS: { id: WallpaperId; label: string }[] = [
  { id: "none", label: "None" },
  { id: "aurora", label: "Aurora" },
  { id: "mountains", label: "Mountains" },
  { id: "forest", label: "Forest" },
  { id: "desert", label: "Desert" },
  { id: "ocean", label: "Ocean" },
];

const THEMES: { id: ThemeMode; label: string; icon: typeof Moon }[] = [
  { id: "dark", label: "Dark", icon: Moon },
  { id: "light", label: "Light", icon: Sun },
  { id: "auto", label: "Auto", icon: Monitor },
];

export function AppearancePanel(props: {
  open: boolean;
  value: Appearance;
  onChange: (next: Appearance) => void;
  onClose: () => void;
}) {
  if (!props.open) return null;
  const a = props.value;
  const set = (patch: Partial<Appearance>) => props.onChange({ ...a, ...patch });

  return (
    <aside className="appear">
      <header>
        <h2>Appearance</h2>
        <button type="button" className="icon-btn" onClick={props.onClose} aria-label="Đóng">
          <X size={16} />
        </button>
      </header>

      <div className="appear-sec">
        <h3>Theme</h3>
        <div className="seg theme">
          {THEMES.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.id} type="button" className={a.theme === t.id ? "on" : ""} onClick={() => set({ theme: t.id })}>
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="appear-sec">
        <h3>Color Palette</h3>
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
        <h3>UI Density</h3>
        <div className="seg">
          {(["compact", "default", "spacious"] as DensityId[]).map((d) => (
            <button key={d} type="button" className={a.density === d ? "on" : ""} onClick={() => set({ density: d })}>
              {d}
            </button>
          ))}
        </div>
      </div>

      <div className="appear-sec">
        <h3>Accent Color</h3>
        <div className="dots">
          {(Object.keys(ACCENTS) as AccentId[]).map((id) => (
            <button
              key={id}
              type="button"
              className={a.accent === id ? "on" : ""}
              style={{ background: ACCENTS[id].accent }}
              title={id}
              aria-label={id}
              onClick={() => set({ accent: id })}
            />
          ))}
        </div>
      </div>

      <div className="appear-sec">
        <h3>Background</h3>
        <div className="wall-grid">
          {WALLS.map((w) => (
            <button
              key={w.id}
              type="button"
              className={`wall-thumb ${a.wallpaper === w.id ? "on" : ""}`}
              data-wall={w.id}
              onClick={() => set({ wallpaper: w.id })}
              style={w.id === "mountains" ? { backgroundImage: `url(${mountains})` } : undefined}
            >
              <span>{w.label}</span>
            </button>
          ))}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={a.blur} onChange={(e) => set({ blur: e.target.checked })} />
          Show Wallpaper Blur
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={a.reduceMotion}
            onChange={(e) => set({ reduceMotion: e.target.checked })}
          />
          Reduce Motion
        </label>
      </div>

      <button type="button" className="ghost" onClick={() => props.onChange({ ...DEFAULT_APPEARANCE })}>
        Reset to default
      </button>
    </aside>
  );
}
