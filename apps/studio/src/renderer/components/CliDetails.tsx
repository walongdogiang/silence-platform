import { useCallback, useEffect, useState } from "react";
import type { CliInfo } from "../types";
import { authLabel, expiryNote, fmtUsd, isSubscriptionLogin, planLabel } from "../cliInfo";
import { useT } from "../i18n";

const LOGIN_CMD = "claude auth login";

/**
 * Claude CLI card body (Settings → Model sources): account, install, how 5ilence runs it, usage.
 * Data from `providers.cli_info` (Engine runs `claude --version` + `claude auth status`; no model
 * call). Shown only on this machine.
 */
export function CliDetails(props: { refreshKey?: number }) {
  const t = useT();
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
  if (!info) return <p className="provider-note">{loading ? t("cli.reading") : ""}</p>;

  const a = info.account;
  const exp = a ? expiryNote(a.login_expires_at, t) : null;
  const turns = (n: number) => t(n === 1 ? "cli.turns1" : "cli.turns", { n });

  return (
    <div className="cli-details">
      <section>
        <h4>{t("cli.account")}</h4>
        {!info.installed ? (
          <p className="hint">{t("cli.notInstalled")}</p>
        ) : !a ? (
          <p className="hint">{t("cli.statusUnknown")}</p>
        ) : !a.logged_in ? (
          <div className="cli-login">
            <p className="hint">{t("cli.notSignedIn")}</p>
            <code>{LOGIN_CMD}</code>
            <button type="button" className="ghost" onClick={() => void copyLogin()}>
              {copied ? t("common.copied") : t("common.copy")}
            </button>
          </div>
        ) : (
          <dl className="cli-kv">
            <dt>{t("cli.signedInAs")}</dt>
            <dd>{a.email || "—"}</dd>
            {a.org_name ? (
              <>
                <dt>{t("cli.org")}</dt>
                <dd>{a.org_name}</dd>
              </>
            ) : null}
            <dt>{t("cli.plan")}</dt>
            <dd>{planLabel(a.plan)}</dd>
            <dt>{t("cli.method")}</dt>
            <dd>{authLabel(a.auth_method, a.api_provider, t)}</dd>
            {exp ? (
              <>
                <dt>{t("cli.login")}</dt>
                <dd className={exp.warn ? "cli-warn" : undefined}>{exp.text}</dd>
              </>
            ) : null}
          </dl>
        )}
        {a?.logged_in && isSubscriptionLogin(a.auth_method) ? (
          <p className="cli-notice">{t("cli.subscriptionNotice")}</p>
        ) : null}
      </section>

      <section>
        <h4>{t("cli.install")}</h4>
        <dl className="cli-kv">
          <dt>{t("cli.version")}</dt>
          <dd>{info.version || "—"}</dd>
          <dt>{t("cli.command")}</dt>
          <dd>
            <code>{info.program}</code>
          </dd>
          {a?.config_dir ? (
            <>
              <dt>{t("cli.configDir")}</dt>
              <dd>
                <code>{a.config_dir}</code>
              </dd>
            </>
          ) : null}
        </dl>
        <p className="provider-note">{t("cli.commandHint")}</p>
      </section>

      <section>
        <h4>{t("cli.howRuns")}</h4>
        <ul className="cli-guards">
          {info.safeguards.map(([what, flag]) => (
            <li key={flag}>
              <span>{what}</span>
              <code>{flag}</code>
            </li>
          ))}
        </ul>
        {info.models.length ? (
          <p className="provider-note">
            {t("cli.models", { list: info.models.map(([label, id]) => `${label} (${id})`).join(", ") })}
          </p>
        ) : null}
      </section>

      <section>
        <h4>{t("cli.usage")}</h4>
        <dl className="cli-kv">
          <dt>{t("cli.today")}</dt>
          <dd>
            {turns(info.usage.turns_today)} · {fmtUsd(info.usage.usd_today)}
          </dd>
          <dt>{t("cli.allTime")}</dt>
          <dd>
            {turns(info.usage.turns_total)} · {fmtUsd(info.usage.usd_total)}
          </dd>
        </dl>
        <p className="provider-note">{t("cli.usageNote")}</p>
      </section>
    </div>
  );
}
