import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useT, type T } from "../i18n";
import { PERM_MODES, type UiPermMode } from "../permissionUi";
import { SettingRow } from "./settings/SettingRow";

/** "edit:src/**" → { tool: "edit", scope: "src/**" }; "shell" → tool-wide. */
function describe(entry: string, t: T) {
  const i = entry.indexOf(":");
  if (i < 0) return { tool: entry, scope: t("perms.anyCall") };
  const tool = entry.slice(0, i);
  const glob = entry.slice(i + 1);
  // shell: mẫu lệnh (`npm install *`); file tool: glob thư mục.
  if (tool === "shell") return { tool, scope: t("perms.command", { glob }) };
  return { tool, scope: glob === "*" ? t("perms.rootOnly") : glob };
}

/** Chế độ quyền: Cân bằng hoặc Thận trọng. Tự chủ chờ sandbox chặn mạng nên chưa chọn được. */
function PermissionModePicker(props: { mode: UiPermMode; onMode: (m: UiPermMode) => void }) {
  const t = useT();
  return (
    <div className="perm-modes" role="radiogroup" aria-label={t("perms.modeLabel")}>
      {PERM_MODES.map((m) => (
        <label key={m.id} className={`perm-mode${props.mode === m.id ? " on" : ""}`}>
          <input
            type="radio"
            name="perm-mode"
            checked={props.mode === m.id}
            onChange={() => props.onMode(m.id)}
          />
          <span>
            <strong>{t(m.label)}</strong>
            <em>{t(m.desc)}</em>
          </span>
        </label>
      ))}
      <label className="perm-mode disabled" title={t("perms.autonomousTip")}>
        <input type="radio" name="perm-mode" disabled />
        <span>
          <strong>{t("perms.autonomous")}</strong>
          <em>{t("perms.autonomousDesc")}</em>
        </span>
      </label>
    </div>
  );
}

/** Chế độ quyền + quyền đã "Nhớ" của workspace (đọc/xoá qua Engine; file .silence/permissions.json). */
export function PermissionsSection(props: { workspace: string; mode: UiPermMode; onMode: (m: UiPermMode) => void }) {
  const t = useT();
  const [entries, setEntries] = useState<string[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!props.workspace) return;
    let live = true;
    setErr("");
    window.silence
      .rpc("permissions.list", { workspace: props.workspace })
      .then((r) => live && setEntries((r as { allow: string[] }).allow))
      .catch((e) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [props.workspace]);

  async function revoke(entry: string) {
    try {
      const r = (await window.silence.rpc("permissions.revoke", {
        workspace: props.workspace,
        entry,
      })) as { allow: string[] };
      setEntries(r.allow);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const wsName = props.workspace.split(/[\/]/).filter(Boolean).pop() ?? "";

  return (
    <>
      <SettingRow id="perm-mode" label={t("perms.mode")} desc={t("perms.mode.desc")} wide>
        <PermissionModePicker mode={props.mode} onMode={props.onMode} />
      </SettingRow>
      <SettingRow
        id="perm-remembered"
        label={t("perms.remembered")}
        desc={wsName ? t("perms.remembered.descWs", { name: wsName }) : t("perms.remembered.desc")}
        wide
      >
        {!props.workspace ? (
          <p className="muted">{t("perms.openWorkspace")}</p>
        ) : err ? (
          <p className="perm-error" role="alert">{err}</p>
        ) : entries === null ? (
          <p className="muted">{t("common.loading")}</p>
        ) : entries.length === 0 ? (
          <p className="muted">{t("perms.none")}</p>
        ) : (
          <ul className="perm-list">
            {entries.map((e) => {
              const d = describe(e, t);
              return (
                <li key={e}>
                  <span>
                    <strong>{d.tool}</strong> · {d.scope}
                  </span>
                  <button type="button" className="icon-btn" aria-label={t("perms.revokeN", { entry: e })} title={t("perms.revoke")} onClick={() => void revoke(e)}>
                    <X size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </SettingRow>
    </>
  );
}
