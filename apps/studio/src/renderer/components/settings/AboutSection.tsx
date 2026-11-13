import { useEffect, useState } from "react";
import { useT } from "../../i18n";
import type { ProviderStatus } from "../../types";
import { SettingRow } from "./SettingRow";

/** Injected from apps/studio/package.json by electron.vite.config (undefined in unit tests). */
const STUDIO_VERSION = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";

/** Settings → About: versions and whether the Engine answers. No new RPC: reuses `providers.status`. */
export function AboutSection() {
  const t = useT();
  const [engine, setEngine] = useState<"checking" | "ok" | "down">("checking");
  const [cli, setCli] = useState("");
  const [n, setN] = useState(0);

  useEffect(() => {
    let live = true;
    setEngine("checking");
    (async () => {
      try {
        const r = (await window.silence.rpc("providers.status")) as { providers: ProviderStatus[] };
        if (!live) return;
        setEngine("ok");
        setCli(r.providers?.find((p) => p.kind === "claude_cli")?.cli_version ?? "");
      } catch {
        if (live) setEngine("down");
      }
    })();
    return () => {
      live = false;
    };
  }, [n]);

  return (
    <>
      <SettingRow id="about" label="5ilence Studio" desc={t("about.studioDesc")}>
        <span className="set-value">{STUDIO_VERSION}</span>
      </SettingRow>
      <SettingRow id="about-engine" label={t("about.engine")} desc={t("about.engineDesc")}>
        <span className={`set-status ${engine}`}>
          {engine === "checking" ? t("src.checking") : engine === "ok" ? t("about.engineOk") : t("about.engineDown")}
        </span>
        <button type="button" className="btn-light" onClick={() => setN((x) => x + 1)} disabled={engine === "checking"}>
          {t("src.checkAgain")}
        </button>
      </SettingRow>
      <SettingRow id="about-cli" label="Claude CLI" desc={t("about.cliDesc")}>
        <span className="set-value">{cli || "—"}</span>
      </SettingRow>
    </>
  );
}
