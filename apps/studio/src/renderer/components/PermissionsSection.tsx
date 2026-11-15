import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useT, type T } from "../i18n";
import { PERM_MODES, sandboxReady, type UiPermMode } from "../permissionUi";
import type { NetworkList, SandboxStatus } from "../types";
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

/** Một dòng trạng thái sandbox (đọc từ `sandbox.status`). */
export function sandboxStateText(s: SandboxStatus | null, t: T): string {
  if (!s) return t("sandbox.state.checking");
  switch (s.state) {
    case "ready":
      return t("sandbox.state.ready");
    case "not_installed":
      return t("sandbox.state.notInstalled");
    case "degraded":
      return t("sandbox.state.degraded", { reason: s.reason });
    default:
      return t("sandbox.state.unsupported");
  }
}

/** Chế độ quyền: Thận trọng / Cân bằng / Tự chủ (Tự chủ chỉ chọn được khi sandbox Ready). */
function PermissionModePicker(props: { mode: UiPermMode; onMode: (m: UiPermMode) => void; sandbox: SandboxStatus | null }) {
  const t = useT();
  const ready = sandboxReady(props.sandbox);
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
      <label
        className={`perm-mode${props.mode === "autonomous" ? " on" : ""}${ready ? "" : " disabled"}`}
        title={ready ? undefined : t("perms.autonomousTip")}
      >
        <input
          type="radio"
          name="perm-mode"
          checked={props.mode === "autonomous"}
          disabled={!ready && props.mode !== "autonomous"}
          onChange={() => props.onMode("autonomous")}
        />
        <span>
          <strong>{t("perms.autonomous")}</strong>
          <em>{t("perms.autonomousDesc")}</em>
        </span>
      </label>
    </div>
  );
}

/** Trạng thái sandbox + nút cài / sửa (một lần UAC). */
function SandboxControls(props: {
  status: SandboxStatus | null;
  onRefresh: () => Promise<void>;
  onSetup: () => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const s = props.status;
  const canSetup = s?.state === "not_installed" || s?.state === "degraded";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(t("sandbox.installFailed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sbx-controls">
      <p className={`sbx-state ${s?.state ?? "checking"}`} role="status">
        {sandboxStateText(s, t)}
      </p>
      <div className="row">
        {canSetup ? (
          <button type="button" className="primary" disabled={busy} onClick={() => void run(props.onSetup)}>
            {busy ? t("sandbox.installing") : s?.state === "degraded" ? t("sandbox.repair") : t("sandbox.install")}
          </button>
        ) : null}
        <button type="button" className="ghost" disabled={busy} onClick={() => void run(props.onRefresh)}>
          {t("sandbox.refresh")}
        </button>
      </div>
      {canSetup ? <p className="muted">{t("sandbox.installHint")}</p> : null}
      {err ? (
        <p className="perm-error" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}

/** Host đã thêm cho workspace (`.silence/network.json`) + registry có sẵn; gỡ qua Engine. */
function NetworkHosts(props: { workspace: string }) {
  const t = useT();
  const [net, setNet] = useState<NetworkList | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!props.workspace) return;
    let live = true;
    setErr("");
    window.silence
      .rpc("network.list", { workspace: props.workspace })
      .then((r) => live && setNet(r as NetworkList))
      .catch((e) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [props.workspace]);

  async function revoke(host: string) {
    try {
      const r = (await window.silence.rpc("network.revoke", { workspace: props.workspace, host })) as { allow: string[] };
      setNet((n) => (n ? { ...n, allow: r.allow } : n));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  if (!props.workspace) return <p className="muted">{t("perms.openWorkspace")}</p>;
  if (err) return <p className="perm-error" role="alert">{err}</p>;
  if (!net) return <p className="muted">{t("common.loading")}</p>;
  return (
    <>
      <p className="muted">{t("sandbox.net.defaults", { hosts: net.defaults.join(", ") })}</p>
      {net.allow.length === 0 ? (
        <p className="muted">{t("sandbox.net.none")}</p>
      ) : (
        <ul className="perm-list">
          {net.allow.map((h) => (
            <li key={h}>
              <span>
                <strong>{h}</strong>
              </span>
              <button type="button" className="icon-btn" aria-label={t("sandbox.net.revoke", { host: h })} title={t("perms.revoke")} onClick={() => void revoke(h)}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Chế độ quyền + sandbox + quyền đã "Nhớ" của workspace (đọc/xoá qua Engine; file .silence/permissions.json). */
export function PermissionsSection(props: {
  workspace: string;
  mode: UiPermMode;
  onMode: (m: UiPermMode) => void;
  sandbox: SandboxStatus | null;
  onRefreshSandbox: () => Promise<void>;
  onSetupSandbox: () => Promise<void>;
}) {
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
        <PermissionModePicker mode={props.mode} onMode={props.onMode} sandbox={props.sandbox} />
      </SettingRow>
      <SettingRow id="perm-sandbox" label={t("sandbox.title")} desc={t("sandbox.desc")} wide>
        <SandboxControls status={props.sandbox} onRefresh={props.onRefreshSandbox} onSetup={props.onSetupSandbox} />
      </SettingRow>
      <SettingRow id="perm-network" label={t("sandbox.net.title")} desc={t("sandbox.net.desc")} wide>
        <NetworkHosts workspace={props.workspace} />
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
