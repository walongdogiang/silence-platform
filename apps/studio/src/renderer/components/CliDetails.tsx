import { useCallback, useEffect, useState } from "react";
import type { CliInfo } from "../types";
import { authLabel, expiryNote, fmtUsd, isSubscriptionLogin, planLabel } from "../cliInfo";

const LOGIN_CMD = "claude auth login";

/**
 * Claude CLI card body (Settings → Model sources): account, install, how 5ilence runs it, usage.
 * Data from `providers.cli_info` (Engine runs `claude --version` + `claude auth status`; no model
 * call). Shown only on this machine.
 */
export function CliDetails(props: { refreshKey?: number }) {
  const [info, setInfo] = useState<CliInfo | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!window.silence) return;
    setLoading(true);
    setErr("");
    try {
      setInfo((await window.silence.rpc("providers.cli_info")) as CliInfo);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, props.refreshKey]);

  async function copyLogin() {
    try {
      await navigator.clipboard.writeText(LOGIN_CMD);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: the command is visible anyway */
    }
  }

  if (err) return <p className="hint">{err}</p>;
  if (!info) return <p className="provider-note">{loading ? "Reading Claude CLI…" : ""}</p>;

  const a = info.account;
  const exp = a ? expiryNote(a.login_expires_at) : null;

  return (
    <div className="cli-details">
      <section>
        <h4>Account</h4>
        {!info.installed ? (
          <p className="hint">Claude CLI is not installed. Install Claude Code, then click Check again.</p>
        ) : !a ? (
          <p className="hint">Could not read the sign-in status (`claude auth status`).</p>
        ) : !a.logged_in ? (
          <div className="cli-login">
            <p className="hint">Not signed in. Run this in a terminal, then click Check again:</p>
            <code>{LOGIN_CMD}</code>
            <button type="button" className="ghost" onClick={() => void copyLogin()}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : (
          <dl className="cli-kv">
            <dt>Signed in as</dt>
            <dd>{a.email || "—"}</dd>
            {a.org_name ? (
              <>
                <dt>Organization</dt>
                <dd>{a.org_name}</dd>
              </>
            ) : null}
            <dt>Plan</dt>
            <dd>{planLabel(a.plan)}</dd>
            <dt>Sign-in method</dt>
            <dd>{authLabel(a.auth_method, a.api_provider)}</dd>
            {exp ? (
              <>
                <dt>Login</dt>
                <dd className={exp.warn ? "cli-warn" : undefined}>{exp.text}</dd>
              </>
            ) : null}
          </dl>
        )}
        {a?.logged_in && isSubscriptionLogin(a.auth_method) ? (
          <p className="cli-notice">
            This uses your personal Claude subscription. Personal / internal use only — do not ship 5ilence to
            others signed in this way.
          </p>
        ) : null}
      </section>

      <section>
        <h4>Install</h4>
        <dl className="cli-kv">
          <dt>Version</dt>
          <dd>{info.version || "—"}</dd>
          <dt>Command</dt>
          <dd>
            <code>{info.program}</code>
          </dd>
          {a?.config_dir ? (
            <>
              <dt>Config folder</dt>
              <dd>
                <code>{a.config_dir}</code>
              </dd>
            </>
          ) : null}
        </dl>
        <p className="provider-note">Change the command with the SILENCE_CLAUDE_CLI environment variable.</p>
      </section>

      <section>
        <h4>How 5ilence runs it</h4>
        <ul className="cli-guards">
          {info.safeguards.map(([what, flag]) => (
            <li key={flag}>
              <span>{what}</span>
              <code>{flag}</code>
            </li>
          ))}
        </ul>
        {info.models.length ? (
          <p className="provider-note">Models: {info.models.map(([label, id]) => `${label} (${id})`).join(", ")}</p>
        ) : null}
      </section>

      <section>
        <h4>Usage</h4>
        <dl className="cli-kv">
          <dt>Today</dt>
          <dd>
            {info.usage.turns_today} turn{info.usage.turns_today === 1 ? "" : "s"} · {fmtUsd(info.usage.usd_today)}
          </dd>
          <dt>All time</dt>
          <dd>
            {info.usage.turns_total} turn{info.usage.turns_total === 1 ? "" : "s"} · {fmtUsd(info.usage.usd_total)}
          </dd>
        </dl>
        <p className="provider-note">
          Cost as the CLI reports it for turns run from 5ilence. Remaining subscription quota is not readable from
          the CLI — check it with /usage inside Claude Code.
        </p>
      </section>
    </div>
  );
}
