import { LANGS, useT, type Lang } from "../../i18n";
import type { Appearance } from "../../theme/appearance";
import { DEFAULT_SOURCE_KIND, loadDefaultSource, type ModelSource } from "../../effort";
import type { Prefs } from "../../prefs";
import { Segmented, SettingRow, Switch } from "./SettingRow";
import { MAX_CONCURRENT } from "../../prefs";

/** Settings → General: language, where the default source lives, startup. Reset lives in Appearance. */
export function GeneralSection(props: {
  appearance: Appearance;
  onAppearance: (next: Appearance) => void;
  sources: ModelSource[];
  onOpenSources: () => void;
  prefs: Prefs;
  onPrefs: (next: Prefs) => void;
}) {
  const t = useT();
  const a = props.appearance;
  const saved = loadDefaultSource();
  const def =
    props.sources.find((s) => s.id === saved) ??
    props.sources.find((s) => s.kind === DEFAULT_SOURCE_KIND) ??
    props.sources[0];

  return (
    <>
      <SettingRow id="lang" label={t("appear.language")} desc={t("set.lang.desc")}>
        <Segmented<Lang>
          label={t("appear.language")}
          value={a.lang}
          onChange={(lang) => props.onAppearance({ ...a, lang })}
          options={LANGS.map((l) => ({ id: l.id, label: l.label }))}
        />
      </SettingRow>
      <SettingRow id="default-source" label={t("src.default")} desc={t("set.defaultSource.desc")}>
        <span className="set-value">
          {def ? def.label : "—"}
          {def && !def.available ? <span className="net-warn"> ({t("src.notAvailable")})</span> : null}
        </span>
        <button type="button" className="btn-light" onClick={props.onOpenSources}>
          {t("set.change")}
        </button>
      </SettingRow>
      <SettingRow id="max-concurrent" label={t("gen.concurrent")} desc={t("gen.concurrent.desc")}>
        <Segmented
          label={t("gen.concurrent")}
          value={String(props.prefs.maxConcurrent)}
          onChange={(v) => props.onPrefs({ ...props.prefs, maxConcurrent: Number(v) })}
          options={MAX_CONCURRENT.map((n) => ({ id: String(n), label: String(n) }))}
        />
      </SettingRow>
      <SettingRow id="restore-tabs" label={t("gen.restore")} desc={t("gen.restore.desc")}>
        <Switch
          label={t("gen.restore")}
          checked={props.prefs.restoreSession}
          onChange={(restoreSession) => props.onPrefs({ ...props.prefs, restoreSession })}
        />
      </SettingRow>
    </>
  );
}
