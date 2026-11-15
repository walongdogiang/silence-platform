import { useEffect, useMemo, useState } from "react";
import { fmtUsd } from "../autoConfig";
import { PER_TASK } from "../evalConfig";
import { ciMonthlyCap, parseCap, sameSettings } from "../evalSettings";
import { useT } from "../i18n";
import type { EvalSettings, EvalSettingsInfo } from "../types";

type CapKey = "smoke" | "nightly" | "v0" | "modes" | "auto";
type Caps = Record<CapKey, string>;

function rpc<R>(method: string, params?: unknown): Promise<R> {
  return window.silence.rpc(method, params) as Promise<R>;
}

const capsOf = (s: EvalSettings): Caps => ({
  smoke: String(s.profiles.smoke.max_cost),
  nightly: String(s.profiles.nightly.max_cost),
  v0: String(s.profiles.weekly.v0_max_cost),
  modes: String(s.profiles.weekly.modes_max_cost),
  auto: String(s.profiles.weekly.auto_max_cost),
});

/**
 * Tab **Cấu hình** của trang Evals (`evals/config.yaml`, RPC `eval.config.get/set`):
 * - nguồn model khi chạy trên máy (tab Chạy, `npm run evals`, các profile, calibrate);
 * - trần chi của profile smoke / nightly / weekly (cùng bước trên máy và trên CI);
 * - CI trên GitHub Actions: tắt sẵn, nguồn riêng (không có Claude CLI).
 * Không bao giờ nhập hay ghi khoá API. Lưu xong gọi `onSaved` để tab Chạy cập nhật nguồn mặc định.
 */
export function EvalsSettingsPanel(props: { onSaved: (s: EvalSettings) => void }) {
  const t = useT();
  const [info, setInfo] = useState<EvalSettingsInfo | null>(null);
  const [saved, setSaved] = useState<EvalSettings | null>(null);
  const [source, setSource] = useState("");
  const [ci, setCi] = useState<EvalSettings["ci"] | null>(null);
  const [caps, setCaps] = useState<Caps>({ smoke: "", nightly: "", v0: "", modes: "", auto: "" });
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = (i: EvalSettingsInfo, s: EvalSettings) => {
    setInfo(i);
    setSaved(s);
    setSource(s.source);
    setCi(s.ci);
    setCaps(capsOf(s));
  };

  useEffect(() => {
    rpc<EvalSettingsInfo>("eval.config.get")
      .then((i) => apply(i, i.settings))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const max = info?.max_cap_usd;
  const parsed = useMemo(() => {
    const out = {} as Record<CapKey, number | null>;
    for (const k of Object.keys(caps) as CapKey[]) out[k] = parseCap(caps[k], max);
    return out;
  }, [caps, max]);
  const valid = Object.values(parsed).every((v) => v !== null);
  const draft: EvalSettings | null =
    valid && ci && source
      ? {
          source,
          profiles: {
            smoke: { max_cost: parsed.smoke as number },
            nightly: { max_cost: parsed.nightly as number },
            weekly: {
              v0_max_cost: parsed.v0 as number,
              modes_max_cost: parsed.modes as number,
              auto_max_cost: parsed.auto as number,
            },
          },
          ci,
        }
      : null;
  const dirty = draft !== null && saved !== null && !sameSettings(draft, saved);

  if (!info || !ci) {
    return <p className={error ? "evals-error" : "evals-muted"}>{error || t("evals.loading")}</p>;
  }

  const touch = () => setNote("");
  const capInput = (k: CapKey, label: string, disabled = false) => (
    <label>
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={caps[k]}
        disabled={disabled}
        aria-invalid={parsed[k] === null}
        className={parsed[k] === null ? "evals-invalid" : undefined}
        onChange={(e) => {
          touch();
          setCaps((c) => ({ ...c, [k]: e.target.value }));
        }}
      />
    </label>
  );
  const status = (s: EvalSettingsInfo["sources"][number]) =>
    s.ready ? <span className="evals-ok">{t("evals.cfg.ready")}</span> : <span className="evals-warn">{s.reason}</span>;
  const ciSources = info.sources.filter((s) => !s.cli);
  const ciSource = info.sources.find((s) => s.id === ci.source);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await rpc("eval.config.set", draft);
      setSaved(draft);
      props.onSaved(draft);
      setNote(t("evals.cfg.saved", { path: info!.path }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="evals-ci" aria-label={t("evals.page.settings")}>
      <p className="evals-muted">{t("evals.cfg.intro", { path: info.path })}</p>

      <fieldset className="evals-ci-block">
        <legend>{t("evals.cfg.local")}</legend>
        <p className="evals-muted">{t("evals.cfg.localHint")}</p>
        <div className="evals-ci-sources" role="radiogroup" aria-label={t("evals.cfg.local")}>
          {info.sources.map((s) => (
            <label key={s.id} className={`evals-ci-source${source === s.id ? " on" : ""}`}>
              <input type="radio" name="eval-local-source" checked={source === s.id} onChange={() => { touch(); setSource(s.id); }} />
              <span className="evals-ci-source-name">{s.label}</span>
              <span className="evals-ci-source-meta">
                {s.env ? (
                  <>
                    <code>{s.env}</code> ·{" "}
                  </>
                ) : null}
                {status(s)}
              </span>
            </label>
          ))}
          <label className={`evals-ci-source${source === PER_TASK ? " on" : ""}`}>
            <input type="radio" name="eval-local-source" checked={source === PER_TASK} onChange={() => { touch(); setSource(PER_TASK); }} />
            <span className="evals-ci-source-name">{t("evals.sourceOwn")}</span>
            <span className="evals-ci-source-meta">{t("evals.cfg.perTaskHint")}</span>
          </label>
        </div>
      </fieldset>

      <fieldset className="evals-ci-block">
        <legend>{t("evals.cfg.profiles")}</legend>
        <p className="evals-muted">{t("evals.cfg.profilesHint")}</p>
        <div className="evals-cfg-profile">
          <b>smoke</b> <code>npm run evals:smoke</code>
          <p className="evals-muted">{t("evals.cfg.smokeHint")}</p>
          <div className="evals-form">{capInput("smoke", t("evals.cfg.cap"))}</div>
        </div>
        <div className="evals-cfg-profile">
          <b>nightly</b> <code>npm run evals:nightly</code>
          <p className="evals-muted">{t("evals.cfg.nightlyHint")}</p>
          <div className="evals-form">{capInput("nightly", t("evals.cfg.cap"))}</div>
        </div>
        <div className="evals-cfg-profile">
          <b>weekly</b> <code>npm run evals:weekly</code>
          <p className="evals-muted">{t("evals.cfg.weeklyHint")}</p>
          <div className="evals-form">
            {capInput("v0", t("evals.cfg.capV0"))}
            {capInput("modes", t("evals.cfg.capModes"))}
            {capInput("auto", t("evals.cfg.capAuto"))}
          </div>
        </div>
      </fieldset>

      <fieldset className="evals-ci-block">
        <legend>{t("evals.cfg.ci")}</legend>
        <label className="evals-check">
          <input type="checkbox" checked={ci.enabled} onChange={(e) => { touch(); setCi({ ...ci, enabled: e.target.checked }); }} />
          <span>{t("evals.cfg.ciEnabled")}</span>
        </label>
        {!ci.enabled ? (
          <p className="evals-muted">{t("evals.cfg.ciOff")}</p>
        ) : (
          <>
            <div className="evals-ci-sources" role="radiogroup" aria-label={t("evals.cfg.ciSource")}>
              {ciSources.map((s) => (
                <label key={s.id} className={`evals-ci-source${ci.source === s.id ? " on" : ""}`}>
                  <input type="radio" name="eval-ci-source" checked={ci.source === s.id} onChange={() => { touch(); setCi({ ...ci, source: s.id }); }} />
                  <span className="evals-ci-source-name">{s.label}</span>
                  <span className="evals-ci-source-meta">
                    <code>{s.env}</code>
                  </span>
                </label>
              ))}
            </div>
            {ciSource ? <p className="evals-muted">{t("evals.cfg.secretNote", { env: ciSource.env })}</p> : null}
            <label className="evals-check">
              <input type="checkbox" checked={ci.nightly} onChange={(e) => { touch(); setCi({ ...ci, nightly: e.target.checked }); }} />
              <span>{t("evals.cfg.ciNightly")}</span>
            </label>
            <label className="evals-check">
              <input type="checkbox" checked={ci.weekly} onChange={(e) => { touch(); setCi({ ...ci, weekly: e.target.checked }); }} />
              <span>{t("evals.cfg.ciWeekly")}</span>
            </label>
            {draft ? <p className="evals-estimate">{t("evals.cfg.monthly", { usd: fmtUsd(ciMonthlyCap(draft)) })}</p> : null}
          </>
        )}
        <p className="evals-muted">{t("evals.cfg.cliNote")}</p>
      </fieldset>

      {!valid ? <p className="evals-warn">{t("evals.cfg.invalid", { max: fmtUsd(info.max_cap_usd) })}</p> : null}
      {error ? <p className="evals-error">{error}</p> : null}
      {note ? <p className="evals-ok">{note}</p> : null}

      <div className="evals-ci-actions">
        <button type="button" className="evals-run" disabled={!dirty || busy} onClick={() => void save()}>
          {t("evals.cfg.save")}
        </button>
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={() => {
            if (saved) apply(info, saved);
            setNote("");
            setError("");
          }}
        >
          {t("evals.cfg.undo")}
        </button>
        {!info.exists && !dirty ? <span className="evals-muted">{t("evals.cfg.noFile")}</span> : null}
      </div>
    </section>
  );
}
