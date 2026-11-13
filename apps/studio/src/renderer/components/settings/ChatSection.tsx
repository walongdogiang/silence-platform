import { useT } from "../../i18n";
import { RESPONSE_STYLES, TRANSCRIPT_VIEWS, type Prefs } from "../../prefs";
import { Segmented, SettingRow, Switch } from "./SettingRow";

/** Settings → Chat: how agent turns are shown and how chats get their names. */
export function ChatSection(props: { prefs: Prefs; onPrefs: (next: Prefs) => void }) {
  const t = useT();
  const p = props.prefs;
  const set = (patch: Partial<Prefs>) => props.onPrefs({ ...p, ...patch });
  return (
    <>
      <SettingRow id="chat-view" label={t("chat.view")} desc={t("chat.view.desc")}>
        <Segmented
          label={t("chat.view")}
          value={p.transcript}
          onChange={(transcript) => set({ transcript })}
          options={TRANSCRIPT_VIEWS.map((v) => ({ id: v, label: t(`chat.view.${v}`) }))}
        />
      </SettingRow>
      <SettingRow id="chat-style" label={t("chat.style")} desc={t("chat.style.desc")}>
        <Segmented
          label={t("chat.style")}
          value={p.responseStyle}
          onChange={(responseStyle) => set({ responseStyle })}
          options={RESPONSE_STYLES.map((v) => ({ id: v, label: t(`chat.style.${v}`) }))}
        />
      </SettingRow>
      <SettingRow id="chat-title" label={t("chat.autoTitle")} desc={t("chat.autoTitle.desc")} badge={t("set.costBadge")}>
        <Switch label={t("chat.autoTitle")} checked={p.autoTitle} onChange={(autoTitle) => set({ autoTitle })} />
      </SettingRow>
    </>
  );
}
