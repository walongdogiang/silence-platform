import { useEffect, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useT, type MsgKey } from "../../i18n";
import mountains from "../../assets/wallpapers/mountains.png";
import {
  ACCENTS,
  DEFAULT_APPEARANCE,
  type AccentId,
  type Appearance,
  type DensityId,
  type PaletteId,
  type ThemeMode,
  type WallpaperId,
} from "../../theme/appearance";
import { CODE_FONT_SIZES, DEFAULT_CODE_FONT, type Prefs } from "../../prefs";
import { Segmented, SettingGroup, SettingRow, Switch } from "./SettingRow";

/** Palette names are theme names (not translated). */
const PALETTES: { id: PaletteId; label: string; swatch: string }[] = [
  { id: "espresso", label: "Espresso", swatch: "#1e1f21" },
  { id: "graphite", label: "Graphite", swatch: "#232426" },
  { id: "forest", label: "Forest", swatch: "#6bb57a" },
  { id: "ocean", label: "Ocean", swatch: "#5fb8a8" },
  { id: "plum", label: "Plum", swatch: "#a48bcc" },
];

const WALLS: WallpaperId[] = ["none", "aurora", "mountains", "forest", "desert", "ocean"];

const THEMES: { id: ThemeMode; label: MsgKey; icon: typeof Moon }[] = [
  { id: "dark", label: "appear.dark", icon: Moon },
  { id: "light", label: "appear.light", icon: Sun },
  { id: "auto", label: "appear.auto", icon: Monitor },
];

function Swatches<V extends string>(props: {
  value: V;
  items: { id: V; label: string; color: string }[];
  onChange: (v: V) => void;
  label: string;
}) {
  return (
    <div className="set-swatches" role="radiogroup" aria-label={props.label}>
      {props.items.map((s) => (
        <button
          key={s.id}
          type="button"
          role="radio"
          aria-checked={props.value === s.id}
          className={props.value === s.id ? "on" : undefined}
          style={{ background: s.color }}
          title={s.label}
          aria-label={s.label}
          onClick={() => props.onChange(s.id)}
        >
          {props.value === s.id ? <Check size={13} aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  );
}

/** Settings → Appearance. Every change applies at once (live preview). */
/** Code font: typed freely, saved on blur / Enter (empty = default). */
function FontInput(props: { value: string; onChange: (v: string) => void; label: string; resetLabel: string }) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const commit = () => {
    const v = draft.trim() || DEFAULT_CODE_FONT;
    setDraft(v);
    if (v !== props.value) props.onChange(v);
  };
  return (
    <>
      <input
        className="set-input"
        value={draft}
        aria-label={props.label}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        style={{ fontFamily: props.value }}
      />
      {props.value !== DEFAULT_CODE_FONT ? (
        <button type="button" className="btn-light" onClick={() => props.onChange(DEFAULT_CODE_FONT)}>
          {props.resetLabel}
        </button>
      ) : null}
    </>
  );
}

export function AppearanceSection(props: {
  value: Appearance;
  onChange: (next: Appearance) => void;
  prefs: Prefs;
  onPrefs: (next: Prefs) => void;
}) {
  const t = useT();
  const a = props.value;
  const set = (patch: Partial<Appearance>) => props.onChange({ ...a, ...patch });
  /** Second click within a few seconds confirms the reset. */
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const tm = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(tm);
  }, [confirming]);

  return (
    <>
      <SettingRow id="theme" label={t("appear.theme")} desc={t("appear.theme.desc")}>
        <Segmented
          label={t("appear.theme")}
          value={a.theme}
          onChange={(theme) => set({ theme })}
          options={THEMES.map((th) => {
            const Icon = th.icon;
            return {
              id: th.id,
              label: (
                <>
                  <Icon size={14} aria-hidden="true" />
                  {t(th.label)}
                </>
              ),
            };
          })}
        />
      </SettingRow>
      <SettingRow id="palette" label={t("appear.palette")} desc={t("appear.palette.desc")}>
        <Swatches
          label={t("appear.palette")}
          value={a.palette}
          onChange={(palette) => set({ palette })}
          items={PALETTES.map((p) => ({ id: p.id, label: p.label, color: p.swatch }))}
        />
      </SettingRow>
      <SettingRow id="accent" label={t("appear.accent")} desc={t("appear.accent.desc")}>
        <Swatches
          label={t("appear.accent")}
          value={a.accent}
          onChange={(accent) => set({ accent })}
          items={(Object.keys(ACCENTS) as AccentId[]).map((id) => ({
            id,
            label: t(`appear.accent.${id}`),
            color: ACCENTS[id].accent,
          }))}
        />
      </SettingRow>
      <SettingRow id="density" label={t("appear.density")} desc={t("appear.density.desc")}>
        <Segmented
          label={t("appear.density")}
          value={a.density}
          onChange={(density) => set({ density })}
          options={(["compact", "default", "spacious"] as DensityId[]).map((d) => ({
            id: d,
            label: t(`appear.density.${d}`),
          }))}
        />
      </SettingRow>
      <SettingRow id="background" label={t("appear.background")} desc={t("appear.background.desc")} wide>
        <div className="wall-grid set-walls" role="radiogroup" aria-label={t("appear.background")}>
          {WALLS.map((w) => (
            <button
              key={w}
              type="button"
              role="radio"
              aria-checked={a.wallpaper === w}
              className={`wall-thumb ${a.wallpaper === w ? "on" : ""}`}
              data-wall={w}
              onClick={() => set({ wallpaper: w })}
              style={w === "mountains" ? { backgroundImage: `url(${mountains})` } : undefined}
            >
              <span>{t(`appear.wall.${w}`)}</span>
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow id="blur" label={t("appear.blur")} desc={t("appear.blur.desc")}>
        <Switch label={t("appear.blur")} checked={a.blur} onChange={(blur) => set({ blur })} />
      </SettingRow>
      <SettingRow id="motion" label={t("appear.reduceMotion")} desc={t("appear.reduceMotion.desc")}>
        <Switch label={t("appear.reduceMotion")} checked={a.reduceMotion} onChange={(reduceMotion) => set({ reduceMotion })} />
      </SettingRow>
      <SettingGroup title={t("code.group")} />
      <SettingRow id="code-font" label={t("code.font")} desc={t("code.font.desc")}>
        <FontInput
          label={t("code.font")}
          resetLabel={t("code.font.reset")}
          value={props.prefs.codeFont}
          onChange={(codeFont) => props.onPrefs({ ...props.prefs, codeFont })}
        />
      </SettingRow>
      <SettingRow id="code-size" label={t("code.size")} desc={t("code.size.desc")}>
        <Segmented
          label={t("code.size")}
          value={String(props.prefs.codeFontSize)}
          onChange={(v) => props.onPrefs({ ...props.prefs, codeFontSize: Number(v) })}
          options={CODE_FONT_SIZES.map((n) => ({ id: String(n), label: String(n) }))}
        />
      </SettingRow>
      <SettingRow id="code-minimap" label={t("code.minimap")} desc={t("code.minimap.desc")}>
        <Switch
          label={t("code.minimap")}
          checked={props.prefs.minimap}
          onChange={(minimap) => props.onPrefs({ ...props.prefs, minimap })}
        />
      </SettingRow>
      <SettingRow id="appearance-reset" label={t("appear.reset")} desc={t("appear.resetDesc")}>
        <button
          type="button"
          className={`btn-light${confirming ? " danger" : ""}`}
          onClick={() => {
            if (!confirming) {
              setConfirming(true);
              return;
            }
            setConfirming(false);
            props.onChange({ ...DEFAULT_APPEARANCE, lang: a.lang });
          }}
        >
          {confirming ? t("appear.resetConfirm") : t("appear.reset")}
        </button>
      </SettingRow>
    </>
  );
}
