import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import { RETENTION_DAYS, type Prefs } from "../../prefs";
import { Segmented, SettingRow } from "./SettingRow";

/** Settings → Data: how long chats are kept, wipe them, open the Engine's data folder. */
export function DataSection(props: {
  prefs: Prefs;
  onPrefs: (next: Prefs) => void;
  chatCount: number;
  onClearHistory: () => Promise<number>;
}) {
  const t = useT();
  const [dataDir, setDataDir] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let live = true;
    window.silence
      ?.rpc("engine.data_dir")
      .then((r) => live && setDataDir(String((r as { path?: string }).path ?? "")))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!confirming) return;
    const tm = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(tm);
  }, [confirming]);

  async function clear() {
    setBusy(true);
    setConfirming(false);
    try {
      const n = await props.onClearHistory();
      setNote(t("data.cleared", { n }));
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <SettingRow id="data-retention" label={t("data.retention")} desc={t("data.retention.desc")}>
        <Segmented
          label={t("data.retention")}
          value={String(props.prefs.retentionDays)}
          onChange={(v) =>
            props.onPrefs({ ...props.prefs, retentionDays: Number(v) as Prefs["retentionDays"] })
          }
          options={RETENTION_DAYS.map((d) => ({
            id: String(d),
            label: d === 0 ? t("data.forever") : t("data.days", { n: d }),
          }))}
        />
      </SettingRow>
      <SettingRow
        id="data-clear"
        label={t("data.clear")}
        desc={note ? <span role="status">{note}</span> : t("data.clear.desc", { n: props.chatCount })}
      >
        <button
          type="button"
          className={`btn-light${confirming ? " danger" : ""}`}
          disabled={busy}
          onClick={() => (confirming ? void clear() : setConfirming(true))}
        >
          {confirming ? t("data.clear.confirm") : t("data.clear.button")}
        </button>
      </SettingRow>
      <SettingRow id="data-dir" label={t("data.dir")} desc={dataDir || t("data.dir.desc")}>
        <button
          type="button"
          className="btn-light"
          disabled={!dataDir}
          onClick={() => void window.silence.openDataDir?.()}
        >
          {t("data.dir.open")}
        </button>
      </SettingRow>
    </>
  );
}
