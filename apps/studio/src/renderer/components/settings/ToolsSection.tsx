import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { useT } from "../../i18n";
import { commandLine, hasLiteralSecret, parseEnv, splitArgs, validServerName } from "../../mcpForm";
import type { McpServerView } from "../../types";
import { SettingRow, Switch } from "./SettingRow";

type Draft = { name: string; command: string; args: string; env: string };
const EMPTY: Draft = { name: "", command: "", args: "", env: "" };

/** Run an Engine call; show its error instead of throwing. */
function useMcp(workspace: string) {
  const [servers, setServers] = useState<McpServerView[] | null>(null);
  const [err, setErr] = useState("");

  async function call<R>(method: string, params: Record<string, unknown>): Promise<R | null> {
    try {
      setErr("");
      return (await window.silence.rpc(method, { workspace, ...params })) as R;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  async function refresh() {
    const r = await call<{ servers: McpServerView[] }>("mcp.list", {});
    if (r) setServers(r.servers);
  }

  function upsert(s: McpServerView) {
    setServers((xs) => {
      const list = xs ?? [];
      return list.some((x) => x.name === s.name) ? list.map((x) => (x.name === s.name ? s : x)) : [...list, s];
    });
  }

  useEffect(() => {
    if (!workspace) return;
    setServers(null);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace]);

  return { servers, setServers, err, call, upsert };
}

function ServerRow(props: {
  s: McpServerView;
  onEnabled: (on: boolean) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const { s } = props;
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmAllow, setConfirmAllow] = useState(false);
  useEffect(() => {
    if (!confirmRemove) return;
    const tm = window.setTimeout(() => setConfirmRemove(false), 4000);
    return () => window.clearTimeout(tm);
  }, [confirmRemove]);
  const line = commandLine(s.command, s.args);

  return (
    <li className={`mcp-row ${s.status}`}>
      <div className="mcp-row-head">
        <span className={`mcp-dot ${s.status}`} aria-hidden="true" />
        <div className="mcp-row-main">
          <b>{s.name}</b>
          <code title={line}>{line}</code>
          <small>
            {t(`mcp.status.${s.status}`)}
            {s.status === "running" ? ` · ${t("mcp.toolCount", { n: s.tools.length })}` : ""}
          </small>
        </div>
        {s.status === "needs_approval" ? (
          <button type="button" className="btn-light" onClick={() => setConfirmAllow(true)}>
            {t("mcp.allow")}
          </button>
        ) : (
          <Switch label={t("mcp.enabledN", { name: s.name })} checked={s.enabled} onChange={props.onEnabled} />
        )}
        <button
          type="button"
          className={`icon-btn${confirmRemove ? " danger" : ""}`}
          aria-label={confirmRemove ? t("mcp.removeConfirm") : t("mcp.removeN", { name: s.name })}
          title={confirmRemove ? t("mcp.removeConfirm") : t("mcp.remove")}
          onClick={() => (confirmRemove ? props.onRemove() : setConfirmRemove(true))}
        >
          <X size={14} />
        </button>
      </div>
      {confirmAllow ? (
        <div className="mcp-confirm" role="alertdialog" aria-label={t("mcp.allow")}>
          <p>{t("mcp.allowExplain")}</p>
          <code>{line}</code>
          <div className="mcp-actions">
            <button type="button" className="btn-light" onClick={() => setConfirmAllow(false)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn-solid"
              onClick={() => {
                setConfirmAllow(false);
                props.onEnabled(true);
              }}
            >
              {t("mcp.allowRun")}
            </button>
          </div>
        </div>
      ) : null}
      {s.error ? <p className="perm-error" role="alert">{s.error}</p> : null}
      {s.tools.length > 0 || s.env_keys.length > 0 ? (
        <details className="mcp-details">
          <summary>{t("mcp.details")}</summary>
          {s.env_keys.length > 0 ? <p className="muted">{t("mcp.envKeys", { keys: s.env_keys.join(", ") })}</p> : null}
          <ul>
            {s.tools.map((tool) => (
              <li key={tool.name}>
                <code>{tool.name}</code>
                {tool.read_only ? <span className="set-badge">{t("mcp.readOnly")}</span> : null}
                {tool.description ? <small>{tool.description}</small> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

function AddServerForm(props: { onAdd: (d: Draft) => Promise<boolean>; onCancel: () => void }) {
  const t = useT();
  const [d, setD] = useState<Draft>(EMPTY);
  const [step, setStep] = useState<"edit" | "confirm">("edit");
  const [busy, setBusy] = useState(false);
  const args = splitArgs(d.args);
  const env = parseEnv(d.env);
  const nameOk = validServerName(d.name.trim());
  const ready = nameOk && d.command.trim() !== "" && env.bad === null;
  const field = (k: keyof Draft) => ({
    value: d[k],
    onChange: (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value }),
  });

  if (step === "confirm") {
    return (
      <div className="mcp-form mcp-confirm" role="alertdialog" aria-label={t("mcp.add")}>
        <p>{t("mcp.addExplain")}</p>
        <code>{commandLine(d.command.trim(), args)}</code>
        <div className="mcp-actions">
          <button type="button" className="btn-light" onClick={() => setStep("edit")} disabled={busy}>
            {t("mcp.back")}
          </button>
          <button
            type="button"
            className="btn-solid"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await props.onAdd(d);
              setBusy(false);
              if (!ok) setStep("edit");
            }}
          >
            {t("mcp.addRun")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="mcp-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) setStep("confirm");
      }}
    >
      <label>
        <span>{t("mcp.name")}</span>
        <input className="set-input" placeholder="github" spellCheck={false} {...field("name")} />
        {d.name && !nameOk ? <small className="perm-error">{t("mcp.nameBad")}</small> : null}
      </label>
      <label>
        <span>{t("mcp.command")}</span>
        <input className="set-input" placeholder="npx" spellCheck={false} {...field("command")} />
      </label>
      <label>
        <span>{t("mcp.args")}</span>
        <input className="set-input" placeholder="-y @modelcontextprotocol/server-github" spellCheck={false} {...field("args")} />
      </label>
      <label>
        <span>{t("mcp.env")}</span>
        <textarea className="set-input" rows={3} placeholder="GITHUB_TOKEN=${GITHUB_TOKEN}" spellCheck={false} {...field("env")} />
        {env.bad ? <small className="perm-error">{t("mcp.envBad", { line: env.bad })}</small> : null}
        {!env.bad && hasLiteralSecret(env.env) ? <small className="net-warn">{t("mcp.envPlain")}</small> : null}
      </label>
      <div className="mcp-actions">
        <button type="button" className="btn-light" onClick={props.onCancel}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="btn-solid" disabled={!ready}>
          {t("mcp.next")}
        </button>
      </div>
    </form>
  );
}

/** Settings → Tools: MCP servers of the open workspace (`.silence/mcp.json`). */
export function ToolsSection(props: { workspace: string }) {
  const t = useT();
  const { servers, setServers, err, call, upsert } = useMcp(props.workspace);
  const [adding, setAdding] = useState(false);
  const wsName = props.workspace.split(/[\\/]/).filter(Boolean).pop() ?? "";

  return (
    <>
      <SettingRow
        id="mcp-servers"
        label={t("mcp.servers")}
        desc={wsName ? t("mcp.servers.descWs", { name: wsName }) : t("mcp.servers.desc")}
        wide
      >
        {!props.workspace ? (
          <p className="muted">{t("perms.openWorkspace")}</p>
        ) : servers === null && !err ? (
          <p className="muted">{t("common.loading")}</p>
        ) : (
          <>
            {err ? <p className="perm-error" role="alert">{err}</p> : null}
            {servers && servers.length === 0 && !adding ? <p className="muted">{t("mcp.none")}</p> : null}
            {servers && servers.length > 0 ? (
              <ul className="mcp-list">
                {servers.map((s) => (
                  <ServerRow
                    key={s.name}
                    s={s}
                    onEnabled={async (enabled) => {
                      const r = await call<{ server: McpServerView }>("mcp.set_enabled", { name: s.name, enabled });
                      if (r) upsert(r.server);
                    }}
                    onRemove={async () => {
                      const r = await call("mcp.remove", { name: s.name });
                      if (r) setServers((xs) => (xs ?? []).filter((x) => x.name !== s.name));
                    }}
                  />
                ))}
              </ul>
            ) : null}
            {adding ? (
              <AddServerForm
                onCancel={() => setAdding(false)}
                onAdd={async (d) => {
                  const r = await call<{ server: McpServerView }>("mcp.add", {
                    server: {
                      name: d.name.trim(),
                      command: d.command.trim(),
                      args: splitArgs(d.args),
                      env: parseEnv(d.env).env,
                      enabled: true,
                    },
                  });
                  if (!r) return false;
                  upsert(r.server);
                  setAdding(false);
                  return true;
                }}
              />
            ) : (
              <button type="button" className="btn-light mcp-add" onClick={() => setAdding(true)}>
                <Plus size={14} aria-hidden="true" />
                {t("mcp.add")}
              </button>
            )}
          </>
        )}
      </SettingRow>
    </>
  );
}
