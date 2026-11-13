import { useEffect, useRef, useState } from "react";
import type { ModelInfo } from "../types";
import { isModelOn, modelTitle, toggleModel, type ModelPrefs } from "../theme/modelsPrefs";
import { ProviderSources } from "./ProviderSources";
import { AutoSettings } from "./AutoSettings";
import { useT } from "../i18n";
import { autoFor, type AutoConfig } from "../autoConfig";
import { modelSources } from "../effort";

export function NetworkPanel(props: {
  catalog: ModelInfo[];
  prefs: ModelPrefs;
  onPrefs: (next: ModelPrefs) => void;
  activeModel: string;
  onSourcesChanged?: () => void;
  /** Scroll to + flash this model's row (from the picker's Enable button). `n` re-triggers. */
  focus?: { id: string; n: number } | null;
  /** Auto settings per source; omitted = no Auto section. */
  autoConfigs?: Record<string, AutoConfig>;
  onAutoConfig?: (source: string, next: AutoConfig) => void;
  /** Source shown first in the Auto section (the picker's). */
  activeSource?: string;
  /** USD the active chat spent (shown on the active source's tab). */
  spentUsd?: number;
  /** Scroll to the Auto section (picker → Auto settings → More settings…). `n` re-triggers. */
  focusAuto?: number;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [flash, setFlash] = useState("");
  useEffect(() => {
    if (!props.focus) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-model="${CSS.escape(props.focus.id)}"]`);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
    row?.querySelector<HTMLElement>(".switch")?.focus({ preventScroll: true });
    setFlash(props.focus.id);
    const t = window.setTimeout(() => setFlash(""), 1800);
    return () => window.clearTimeout(t);
  }, [props.focus]);
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [tier, setTier] = useState("mid");
  const [err, setErr] = useState("");
  const t = useT();
  const sources = modelSources(props.catalog);
  const [autoSrc, setAutoSrc] = useState(props.activeSource ?? "");
  const autoRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!props.focusAuto) return;
    setAutoSrc(props.activeSource ?? "");
    autoRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focusAuto]);
  const autoSource = sources.some((x) => x.id === autoSrc) ? autoSrc : (sources[0]?.id ?? "");
  // Auto picks among the models the user left on.
  const visible = props.catalog.filter((m) => isModelOn(m, props.prefs));
  const extrasIds = new Set(props.prefs.extras.map((e) => e.id));
  const rows = [
    ...props.catalog,
    ...props.prefs.extras.filter((e) => !props.catalog.some((c) => c.id === e.id)),
  ];


  function add() {
    const id = slug.trim();
    if (!id.includes("/")) {
      setErr(t("models.badSlug"));
      return;
    }
    if (rows.some((m) => m.id === id)) {
      setErr(t("models.duplicate"));
      return;
    }
    setErr("");
    const extra: ModelInfo = {
      id,
      label: label.trim() || undefined,
      api_model: id,
      tier,
      context_window: 128000,
      tools: true,
      vision: false,
    };
    props.onPrefs({ ...props.prefs, extras: [...props.prefs.extras, extra] });
    setSlug("");
    setLabel("");
  }

  function removeExtra(id: string) {
    props.onPrefs({
      ...props.prefs,
      extras: props.prefs.extras.filter((e) => e.id !== id),
      disabled: props.prefs.disabled.filter((x) => x !== id),
    });
  }

  return (
    <div className="network-page">
      <ProviderSources onChanged={props.onSourcesChanged} />
      {props.onAutoConfig && autoSource ? (
        <section className="auto-panel" ref={autoRef}>
          <header>
            <h2>{t("auto.title")}</h2>
            <p>{t("auto.intro")}</p>
          </header>
          {sources.length > 1 ? (
            <div className="auto-source-tabs" role="tablist">
              {sources.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  role="tab"
                  aria-selected={x.id === autoSource}
                  className={x.id === autoSource ? "active" : undefined}
                  onClick={() => setAutoSrc(x.id)}
                >
                  {x.label}
                </button>
              ))}
            </div>
          ) : null}
          <AutoSettings
            config={autoFor(props.autoConfigs ?? {}, autoSource)}
            onChange={(next) => props.onAutoConfig?.(autoSource, next)}
            source={autoSource}
            models={visible}
            spentUsd={autoSource === props.activeSource ? props.spentUsd : undefined}
          />
        </section>
      ) : null}
      <header>
        <h2>{t("models.title")}</h2>
        <p>{t("models.intro")}</p>
      </header>
      <ul className="model-switch-list" ref={listRef}>
        {rows.map((m) => (
          <li key={m.id} data-model={m.id} className={flash === m.id ? "flash" : undefined}>
            <div>
              <b>{modelTitle(m)}</b>
              <small>
                {m.provider_label ? `${m.provider_label} · ` : ""}
                {m.id}
              </small>
              {m.opt_in ? <small className="model-optin">{t("models.optIn")}</small> : null}
            </div>
            {extrasIds.has(m.id) ? (
              <button type="button" className="ghost" onClick={() => removeExtra(m.id)}>
                {t("common.delete")}
              </button>
            ) : null}
            <button
              type="button"
              className={`switch${isModelOn(m, props.prefs) ? " on" : ""}`}
              role="switch"
              aria-checked={isModelOn(m, props.prefs)}
              aria-label={t("models.enableN", { model: modelTitle(m) })}
              onClick={() => props.onPrefs(toggleModel(m, props.prefs))}
            />
          </li>
        ))}
      </ul>
      <form
        className="model-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <h3>{t("model.add")}</h3>
        <label className="field">
          {t("models.slug")}
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="google/gemini-2.5-pro"
          />
        </label>
        <label className="field">
          {t("models.displayName")}
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Gemini 2.5 Pro" />
        </label>
        <label className="field">
          {t("models.tier")}
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="fast">{t("models.tier.fast")}</option>
            <option value="high-fast">{t("models.tier.highFast")}</option>
            <option value="mid">{t("models.tier.mid")}</option>
            <option value="strong">{t("models.tier.strong")}</option>
            <option value="free">{t("models.tier.free")}</option>
          </select>
        </label>
        {err ? <p className="hint">{err}</p> : null}
        <button type="submit" className="primary">
          {t("models.addToPicker")}
        </button>
      </form>
      <p className="hint">
        {t("models.current")}{" "}
        {props.activeModel === "auto"
          ? "Auto"
          : modelTitle(
              rows.find((m) => m.id === props.activeModel) ?? {
                id: props.activeModel,
                tier: "",
              },
            )}
      </p>
    </div>
  );
}
