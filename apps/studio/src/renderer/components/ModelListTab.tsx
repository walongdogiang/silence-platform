import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ModelInfo } from "../types";
import { isModelOn, modelTitle, toggleModel, type ModelPrefs } from "../theme/modelsPrefs";
import { groupModels, isFreshFocus, matchesFilter } from "../networkTabs";
import { shortName } from "../autoConfig";
import { useT } from "../i18n";

/**
 * Settings → Model → Models tab: models grouped by source with on/off switches, a filter, and a
 * collapsed form to add an OpenRouter slug.
 */
export function ModelListTab(props: {
  catalog: ModelInfo[];
  prefs: ModelPrefs;
  onPrefs: (next: ModelPrefs) => void;
  /** Scroll to + flash this model's row. `n` re-triggers. */
  focus?: { id: string; n: number } | null;
  /** Open the add form and focus it. Re-triggers when it changes. */
  focusAdd?: number;
  /** Jump to the Sources tab (set up a source that is not available). */
  onOpenSources?: () => void;
}) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const [flash, setFlash] = useState("");
  const [query, setQuery] = useState("");
  /** Open/closed per group the user toggled; default = open unless the source is unusable. */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [tier, setTier] = useState("mid");
  const [err, setErr] = useState("");

  const extrasIds = new Set(props.prefs.extras.map((e) => e.id));
  const rows = [
    ...props.catalog,
    ...props.prefs.extras.filter((e) => !props.catalog.some((c) => c.id === e.id)),
  ];
  const canAdd = props.catalog.some((m) => m.provider_kind === "openai_compat");
  const groups = groupModels(
    rows.filter((m) => matchesFilter(m, modelTitle(m), query)),
    t("models.groupOther"),
  );

  useEffect(() => {
    if (!props.focus || !isFreshFocus(props.focus.n)) return;
    setQuery("");
    const id = props.focus.id;
    const g = groupModels(rows, "").find((x) => x.models.some((m) => m.id === id));
    if (g) setOpenGroups((o) => ({ ...o, [g.id]: true }));
    const raf = window.requestAnimationFrame(() => {
      const row = listRef.current?.querySelector<HTMLElement>(`[data-model="${CSS.escape(id)}"]`);
      row?.scrollIntoView({ block: "center", behavior: "smooth" });
      row?.querySelector<HTMLElement>(".switch")?.focus({ preventScroll: true });
    });
    setFlash(id);
    const tm = window.setTimeout(() => setFlash(""), 1800);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(tm);
    };
  }, [props.focus]);

  useEffect(() => {
    if (!isFreshFocus(props.focusAdd)) return;
    setAdding(true);
    const raf = window.requestAnimationFrame(() => {
      slugRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      slugRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(raf);
  }, [props.focusAdd]);

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
    setAdding(false);
  }

  function removeExtra(id: string) {
    props.onPrefs({
      ...props.prefs,
      extras: props.prefs.extras.filter((e) => e.id !== id),
      disabled: props.prefs.disabled.filter((x) => x !== id),
    });
  }

  return (
    <div className="model-list-tab">
      <p className="net-intro">{t("models.intro")}</p>
      <div className="model-toolbar">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("models.filter")}
          aria-label={t("models.filter")}
        />
        {canAdd && !adding ? (
          <button type="button" className="ghost" onClick={() => setAdding(true)}>
            {t("models.addToggle")}
          </button>
        ) : null}
      </div>

      {adding ? (
        <form
          className="model-add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <h3>{t("models.addTitle")}</h3>
          <div className="model-add-grid">
          <label className="field">
            {t("models.slug")}
            <input
              ref={slugRef}
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
          </div>
          {err ? <p className="hint">{err}</p> : null}
          <div className="model-add-actions">
            <button type="submit" className="primary">
              {t("models.addToPicker")}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setAdding(false);
                setErr("");
              }}
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      ) : null}

      <div ref={listRef}>
        {groups.length === 0 ? <p className="hint">{t("models.noMatch")}</p> : null}
        {groups.map((g) => {
          const on = g.models.filter((m) => isModelOn(m, props.prefs)).length;
          const usable = g.models.some((m) => m.available !== false);
          const open = query.trim() ? true : (openGroups[g.id] ?? usable);
          return (
            <section key={g.id} className={`model-group${usable ? "" : " off"}${open ? " open" : ""}`}>
              <h3>
                <button
                  type="button"
                  className="model-group-head"
                  aria-expanded={open}
                  onClick={() => setOpenGroups((o) => ({ ...o, [g.id]: !open }))}
                >
                  <ChevronRight size={14} className="model-group-chevron" aria-hidden="true" />
                  {g.label}
                  <span>{t("models.groupCount", { on, total: g.models.length })}</span>
                </button>
                {!usable ? (
                  <span className="model-group-off">
                    {t("models.sourceOff")}
                    {props.onOpenSources ? (
                      <>
                        {" "}
                        <button type="button" className="link-btn" onClick={props.onOpenSources}>
                          {t("models.setUpSource")}
                        </button>
                      </>
                    ) : null}
                  </span>
                ) : null}
              </h3>
              {open ? (
                <ul className="model-switch-list">
                  {g.models.map((m) => (
                    <li key={m.id} data-model={m.id} className={flash === m.id ? "flash" : undefined}>
                      <div>
                        <b>{shortName(m)}</b>
                        <small>{m.id}</small>
                        {m.opt_in ? <small className="model-optin">{t("models.optIn")}</small> : null}
                      </div>
                      {extrasIds.has(m.id) ? (
                        <button type="button" className="ghost" onClick={() => removeExtra(m.id)}>
                          {t("common.delete")}
                        </button>
                      ) : (
                        <span />
                      )}
                      <button
                        type="button"
                        className={`switch${isModelOn(m, props.prefs) ? " on" : ""}`}
                        role="switch"
                        aria-checked={isModelOn(m, props.prefs)}
                        aria-label={t("models.enableN", { model: shortName(m) })}
                        onClick={() => props.onPrefs(toggleModel(m, props.prefs))}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
