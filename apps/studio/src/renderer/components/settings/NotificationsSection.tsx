import { useState } from "react";
import { useT } from "../../i18n";
import type { Prefs } from "../../prefs";
import { SettingRow, Switch } from "./SettingRow";

/** Settings → Notifications: desktop notices, taskbar flash, keep-awake while running. */
export function NotificationsSection(props: { prefs: Prefs; onPrefs: (next: Prefs) => void }) {
  const t = useT();
  const p = props.prefs;
  const set = (patch: Partial<Prefs>) => props.onPrefs({ ...p, ...patch });
  const [test, setTest] = useState<"" | "sent" | "unsupported">("");

  async function sendTest() {
    const ok = await window.silence.notifyTest?.("5ilence", t("notif.test.body")).catch(() => false);
    setTest(ok ? "sent" : "unsupported");
  }

  return (
    <>
      <SettingRow id="notif-permission" label={t("notif.permission")} desc={t("notif.permission.desc")}>
        <Switch
          label={t("notif.permission")}
          checked={p.notifyPermission}
          onChange={(notifyPermission) => set({ notifyPermission })}
        />
      </SettingRow>
      <SettingRow id="notif-done" label={t("notif.done")} desc={t("notif.done.desc")}>
        <Switch label={t("notif.done")} checked={p.notifyDone} onChange={(notifyDone) => set({ notifyDone })} />
      </SettingRow>
      <SettingRow id="notif-flash" label={t("notif.flash")} desc={t("notif.flash.desc")}>
        <Switch label={t("notif.flash")} checked={p.flashTaskbar} onChange={(flashTaskbar) => set({ flashTaskbar })} />
      </SettingRow>
      <SettingRow id="notif-awake" label={t("notif.keepAwake")} desc={t("notif.keepAwake.desc")}>
        <Switch label={t("notif.keepAwake")} checked={p.keepAwake} onChange={(keepAwake) => set({ keepAwake })} />
      </SettingRow>
      <SettingRow
        id="notif-test"
        label={t("notif.test")}
        desc={test ? <span role="status">{t(test === "sent" ? "notif.test.sent" : "notif.test.unsupported")}</span> : t("notif.test.desc")}
      >
        <button type="button" className="btn-light" onClick={() => void sendTest()}>
          {t("notif.test.button")}
        </button>
      </SettingRow>
    </>
  );
}
