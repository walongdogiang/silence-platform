import { useCallback, useEffect, useState } from "react";
import type { ProviderStatus } from "../types";
import { CliDetails } from "./CliDetails";

type KeyStatus = { provider: string; has_key: boolean; last4: string };

const KIND_NOTE: Record<ProviderStatus["kind"], string> = {
  openai_compat: "OpenAI-compatible (OpenRouter). One key for models from many vendors.",
  anthropic: "Calls the Anthropic Messages API directly: prompt caching, effort, thinking.",
  claude_cli:
    "Uses the Claude CLI signed in on this machine. Tools still run in 5ilence (Risk Engine + diff). Personal / internal use only.",
};

/**
 * Settings → Model sources: one card per provider (status, key input). Which source is used is
 * picked in the composer's model menu (Source). Keys go to the main process
 * (`window.silence.credentials`), which stores them encrypted and forwards them to the Engine;
 * the renderer never reads a key back.
 */
export function ProviderSources(props: {
  /** Called after a key change so the model list can refresh availability. */
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<ProviderStatus[]>([]);
  const [keys, setKeys] = useState<KeyStatus[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  /** Bumped by "Check again" so the CLI details re-read too. */
  const [checks, setChecks] = useState(0);

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
      setMsg((m) => ({ ...m, [provider]: "This Studio build cannot store keys." }));
      return;
    }
    try {
      setKeys(await api.set(provider, value));
      setDraft((d) => ({ ...d, [provider]: "" }));
      setMsg((m) => ({ ...m, [provider]: value ? "Saved (encrypted on this machine)." : "Key removed." }));
      await refresh();
      props.onChanged?.();
    } catch (e) {
      setMsg((m) => ({ ...m, [provider]: e instanceof Error ? e.message : String(e) }));
    }
  }

  return (
    <section className="provider-sources">
      <header>
        <h2>Model sources</h2>
        <p>
          Set up the sources 5ilence can call. Pick the one to use under Source in the model menu;
          Auto routes only inside that source.
        </p>
      </header>
      {msg._ ? <p className="hint">{msg._}</p> : null}
      <div className="provider-cards">
        {rows.map((p) => {
          const k = keys.find((x) => x.provider === p.id);
          const isCli = p.kind === "claude_cli";
          return (
            <article key={p.id} className={`provider-card${p.available ? "" : " off"}`}>
              <div className="provider-head">
                <b>{p.label}</b>
                <span className={`provider-dot${p.available ? " ok" : ""}`}>
                  {p.available ? "Ready" : "Not available"}
                </span>
              </div>
              <p className="provider-note">{KIND_NOTE[p.kind] ?? ""}</p>
              {!p.available && p.unavailable_reason ? <p className="hint">{p.unavailable_reason}</p> : null}
              {isCli && p.cli_version ? <p className="provider-note">{p.cli_version}</p> : null}
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
                      k?.has_key ? `Saved …${k.last4}` : p.has_key ? "Using key from environment variable" : "Paste API key"
                    }
                    aria-label={`API key ${p.label}`}
                  />
                  <button type="submit" className="primary" disabled={!(draft[p.id] ?? "").trim()}>
                    Save
                  </button>
                  {k?.has_key ? (
                    <button type="button" className="ghost" onClick={() => void saveKey(p.id, "")}>
                      Remove
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
      <div className="provider-actions">
        <button
          type="button"
          className="ghost"
          onClick={() => {
            setChecks((n) => n + 1);
            void refresh();
          }}
          disabled={loading}
        >
          {loading ? "Checking…" : "Check again"}
        </button>
      </div>
    </section>
  );
}
