import { useCallback, useEffect, useState } from "react";
import { DEFAULT_SOURCE_KIND, loadDefaultSource, saveDefaultSource } from "../effort";
import { useT, type MsgKey } from "../i18n";
import type { ProviderStatus } from "../types";
import { CliDetails } from "./CliDetails";

type KeyStatus = { provider: string; has_key: boolean; last4: string };

const KIND_NOTE: Record<ProviderStatus["kind"], MsgKey> = {
  openai_compat: "src.note.openai_compat",
  claude_api: "src.note.claude_api",
  claude_cli: "src.note.claude_cli",
};

/**
 * Settings → Model → Sources tab: the default source Studio starts on (Claude CLI unless set here),
 * then one card per provider (status, key input). The composer's Source row switches for the
 * current run only. Keys go to the main process
 * (`window.silence.credentials`), which stores them encrypted and forwards them to the Engine;
 * the renderer never reads a key back.
 */
export function ProviderSources(props: {
  /** Called after a key change so the model list can refresh availability. */
  onChanged?: () => void;
  /**
   * Controlled default source (Settings → Model keeps it as a draft until Save). Omitted = this
   * component reads and saves it itself.
   */
  defaultSource?: string;
  /** Called when the user picks another default source (instead of saving when controlled). */
  onDefaultChange?: (provider: string) => void;
}) {
  const t = useT();
  const [rows, setRows] = useState<ProviderStatus[]>([]);
  const [keys, setKeys] = useState<KeyStatus[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  /** Bumped by "Check again" so the CLI details re-read too. */
  const [checks, setChecks] = useState(0);
  const [ownDefault, setOwnDefault] = useState(() => loadDefaultSource());
  const controlled = props.defaultSource !== undefined;
  const defaultSource = controlled ? props.defaultSource! : ownDefault;
  /** Unset (or a source the catalog dropped) = the Claude CLI. */
  const shownDefault = rows.some((p) => p.id === defaultSource)
    ? defaultSource
    : (rows.find((p) => p.kind === DEFAULT_SOURCE_KIND)?.id ?? "");

  const refresh = useCallback(async () => {
    if (!window.silence) return;
    setLoading(true);
    try {
      const r = (await window.silence.rpc("providers.status")) as { providers: ProviderStatus[] };
      setRows(r.providers ?? []);
      setKeys((await window.silence.credentials?.status()) ?? []);
    } catch (e) {
      setMsg({ _: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function saveKey(provider: string, value: string) {
    const api = window.silence?.credentials;
    if (!api) {
      setMsg((m) => ({ ...m, [provider]: t("src.noKeyStore") }));
      return;
    }
    try {
      setKeys(await api.set(provider, value));
      setDraft((d) => ({ ...d, [provider]: "" }));
      setMsg((m) => ({ ...m, [provider]: value ? t("src.saved") : t("src.removed") }));
      await refresh();
      props.onChanged?.();
    } catch (e) {
      setMsg((m) => ({ ...m, [provider]: e instanceof Error ? e.message : String(e) }));
    }
  }

  return (
    <section className="provider-sources">
      <p className="net-intro">{t("src.intro")}</p>
      {msg._ ? <p className="hint">{msg._}</p> : null}
      <div className="provider-top">
        {rows.length > 0 ? (
          <label className="provider-default">
            <span>{t("src.default")}</span>
            <select
              value={shownDefault}
              onChange={(e) => {
                if (!controlled) {
                  setOwnDefault(e.target.value);
                  saveDefaultSource(e.target.value);
                }
                props.onDefaultChange?.(e.target.value);
              }}
            >
              {rows.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.available ? p.label : `${p.label} (${t("src.notAvailable")})`}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className="ghost"
          onClick={() => {
            setChecks((n) => n + 1);
            void refresh();
          }}
          disabled={loading}
        >
          {loading ? t("src.checking") : t("src.checkAgain")}
        </button>
      </div>
      {rows.length > 0 ? <p className="provider-default-hint">{t("src.defaultHint")}</p> : null}
      <div className="provider-cards">
        {rows.map((p) => {
          const k = keys.find((x) => x.provider === p.id);
          const isCli = p.kind === "claude_cli";
          return (
            <article key={p.id} className={`provider-card${p.available ? "" : " off"}`}>
              <div className="provider-head">
                <b>{p.label}</b>
                <span className={`provider-dot${p.available ? " ok" : ""}`}>
                  {p.available ? t("src.ready") : t("src.notAvailable")}
                </span>
              </div>
              <p className="provider-note">{KIND_NOTE[p.kind] ? t(KIND_NOTE[p.kind]) : ""}</p>
              {!p.available && p.unavailable_reason ? (
                <p className="provider-note provider-reason">
                  {/* Engine reason is English; the common "no key" case gets a localized line. */}
                  {p.needs_key && !p.has_key ? t("src.needsKey") : p.unavailable_reason}
                </p>
              ) : null}
              {p.needs_key ? (
                <form
                  className="provider-key"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = (draft[p.id] ?? "").trim();
                    if (v) void saveKey(p.id, v);
                  }}
                >
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={draft[p.id] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                    placeholder={
                      k?.has_key ? t("src.savedKey", { last4: k.last4 }) : p.has_key ? t("src.envKey") : t("src.pasteKey")
                    }
                    aria-label={`API key ${p.label}`}
                  />
                  <button type="submit" className="primary" disabled={!(draft[p.id] ?? "").trim()}>
                    {t("common.save")}
                  </button>
                  {k?.has_key ? (
                    <button type="button" className="ghost" onClick={() => void saveKey(p.id, "")}>
                      {t("common.remove")}
                    </button>
                  ) : null}
                </form>
              ) : null}
              {msg[p.id] ? <p className="hint">{msg[p.id]}</p> : null}
              {isCli ? <CliDetails refreshKey={checks} /> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
