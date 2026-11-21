import { useCallback, useEffect, useState } from "react";
import { useT, type T } from "../../i18n";
import { SettingRow } from "./SettingRow";

/** `profile.status` from the core (roadmap 1.7). `available: false` = the core is not running. */
export type ProfileFile = { path: string; lines: number; loaded: boolean };
export type ProfileStatus = {
  available?: false;
  home?: string;
  profile?: ProfileFile | null;
  project?: (ProfileFile & { name: string }) | null;
  projectName?: string;
  plugin?: { path: string; name?: string; skills: string[]; loaded: boolean } | null;
  warnings?: string[];
};

type Load = { state: "loading" } | { state: "ok"; status: ProfileStatus } | { state: "error"; message: string };

/** One line of description for a profile file: where it is and whether the agent gets it. */
export function fileText(t: T, f: ProfileFile | null | undefined, expected: string): string {
  if (!f) return t("profile.missing", { path: expected });
  if (!f.loaded) return t(f.lines ? "profile.notLoaded" : "profile.empty", { path: f.path });
  return t("profile.loaded", { path: f.path, n: f.lines });
}

const join = (home: string, ...parts: string[]) => [home.replace(/[\\/]+$/, ""), ...parts].join(home.includes("\\") ? "\\" : "/");

/**
 * Settings → Profile: what `~/.silence` gives every chat (profile, project profile, personal
 * plugin) and any warning. Read-only: the files are edited in `~/.silence` itself.
 */
export function ProfileView(props: { load: Load; workspace: string; onReload?: () => void }) {
  const t = useT();
  const reload = props.onReload ? (
    <button type="button" className="btn-light" onClick={props.onReload} disabled={props.load.state === "loading"}>
      {t("profile.reload")}
    </button>
  ) : null;

  if (props.load.state === "loading") return <SettingRow id="profile-main" label={t("profile.main")} desc={t("profile.loading")} />;
  if (props.load.state === "error") {
    return (
      <SettingRow id="profile-main" label={t("profile.main")} desc={<span role="status">{props.load.message}</span>}>
        {reload}
      </SettingRow>
    );
  }
  const s = props.load.status;
  if (s.available === false || !s.home) {
    return <SettingRow id="profile-main" label={t("profile.main")} desc={t("profile.coreOff")} />;
  }
  const home = s.home;
  const name = s.project?.name ?? s.projectName;
  const plugin = s.plugin;
  return (
    <>
      <SettingRow id="profile-main" label={t("profile.main")} desc={fileText(t, s.profile, join(home, "profile.md"))}>
        {reload}
      </SettingRow>
      <SettingRow
        id="profile-project"
        label={name ? t("profile.project", { name }) : t("profile.projectNone")}
        desc={
          name
            ? fileText(t, s.project, join(home, "projects", name, "profile.md"))
            : t("profile.projectNoWorkspace")
        }
      />
      <SettingRow
        id="profile-plugin"
        label={t("profile.plugin")}
        desc={
          !plugin
            ? t("profile.missing", { path: join(home, "plugin") })
            : !plugin.loaded
              ? t("profile.pluginNotLoaded", { path: plugin.path })
              : t("profile.pluginLoaded", {
                  name: plugin.name ?? "",
                  skills: plugin.skills.length ? plugin.skills.join(", ") : t("profile.noSkills"),
                })
        }
      />
      {s.warnings?.length ? (
        <SettingRow
          id="profile-warnings"
          label={t("profile.warnings")}
          desc={
            <ul role="status">
              {s.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          }
        />
      ) : null}
      <p className="set-row-desc">{t("profile.note", { workspace: props.workspace || "—" })}</p>
    </>
  );
}

export function ProfileSection(props: { workspace: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const fetchStatus = useCallback(() => {
    let live = true;
    setLoad({ state: "loading" });
    window.silence
      ?.rpc("profile.status", props.workspace ? { workspace: props.workspace } : {})
      .then((r) => live && setLoad({ state: "ok", status: r as ProfileStatus }))
      .catch((e: unknown) => live && setLoad({ state: "error", message: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [props.workspace]);
  useEffect(() => fetchStatus(), [fetchStatus]);
  return <ProfileView load={load} workspace={props.workspace} onReload={() => void fetchStatus()} />;
}
