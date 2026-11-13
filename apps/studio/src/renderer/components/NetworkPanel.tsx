import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { ModelInfo } from "../types";
import { isModelOn, type ModelPrefs } from "../theme/modelsPrefs";
import { ProviderSources } from "./ProviderSources";
import { AutoSettings } from "./AutoSettings";
import { ModelListTab } from "./ModelListTab";
import { useT, type MsgKey } from "../i18n";
import { DEFAULT_AUTO, autoFor, shortName, type AutoConfig } from "../autoConfig";
import { DEFAULT_SOURCE_KIND, loadDefaultSource, modelSources, saveDefaultSource } from "../effort";
import {
  NETWORK_TABS,
  defaultPrefs,
  isFreshFocus,
  loadNetworkTab,
  sameValue,
  saveNetworkTab,
  type NetworkTab,
} from "../networkTabs";

/** What App needs to warn before leaving the page with unsaved changes. */
export type NetworkGuard = { dirty: boolean; save: () => void; discard: () => void };

const TAB_LABEL: Record<NetworkTab, MsgKey> = {
  sources: "net.tab.sources",
  auto: "net.tab.auto",
  models: "net.tab.models",
};

/**
 * Settings → Model: one header with what is in use, then three tabs — Sources (keys, Claude CLI),
 * Auto (per-source routing) and Models (picker switches + add OpenRouter slug). The tab is
 * remembered; links from the composer jump to the right tab.
 *
 * Edits (default source, Auto, model switches) stay a draft until **Save**; **Cancel** drops the
 * draft; **Reset to default** puts the current tab's defaults into the draft. API keys keep their
 * own Save button on each source card (a secret is never held in a draft).
 */
export function NetworkPanel(props: {
  catalog: ModelInfo[];
  prefs: ModelPrefs;
  onPrefs: (next: ModelPrefs) => void;
  activeModel: string;
  onSourcesChanged?: () => void;
  /** Open Models, scroll to + flash this model's row (picker's Enable button). `n` re-triggers. */
  focus?: { id: string; n: number } | null;
  /** Auto settings per source; omitted = no Auto tab. */
  autoConfigs?: Record<string, AutoConfig>;
  onAutoConfig?: (source: string, next: AutoConfig) => void;
  /** Source shown first in the Auto tab (the picker's). */
  activeSource?: string;
  /** USD the active chat spent (shown on the active source's tab). */
  spentUsd?: number;
  /** Open the Auto tab (picker → Auto settings → More settings…). Re-triggers when it changes. */
  focusAuto?: number;
  /** Open Models with the add form (picker → Add models). Re-triggers when it changes. */
  focusAdd?: number;
  /** Open the Sources tab (picker → Source → Set up). Re-triggers when it changes. */
  focusSources?: number;
  /** Inside the Settings dialog: no page title (the dialog shows it), no own scroll. */
  embedded?: boolean;
  /** Switch to this tab (Settings search / General → Change). Re-triggers when `n` changes. */
  focusTab?: { tab: NetworkTab; n: number } | null;
  /** Filled every render with the draft state; cleared on unmount. */
  guardRef?: MutableRefObject<NetworkGuard | null>;
}) {
  const t = useT();
  const sources = modelSources(props.catalog);
  const hasAuto = Boolean(props.onAutoConfig) && sources.length > 0;
  const [tab, setTabState] = useState<NetworkTab>(() => loadNetworkTab());
  const shownTab: NetworkTab = tab === "auto" && !hasAuto ? "sources" : tab;
  const [autoSrc, setAutoSrc] = useState(props.activeSource ?? "");
  const [savedDefault, setSavedDefault] = useState(() => loadDefaultSource());
  /** Drafts: `null` / missing key = unchanged. */
  const [draftDefault, setDraftDefault] = useState<string | null>(null);
  const [draftAuto, setDraftAuto] = useState<Record<string, AutoConfig>>({});
  const [draftPrefs, setDraftPrefs] = useState<ModelPrefs | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const prefs = draftPrefs ?? props.prefs;
  const defaultSource = draftDefault ?? savedDefault;
  const autoOf = (src: string) => draftAuto[src] ?? autoFor(props.autoConfigs ?? {}, src);
  const dirtyTabs: Record<NetworkTab, boolean> = {
    sources: draftDefault !== null,
    auto: Object.keys(draftAuto).length > 0,
    models: draftPrefs !== null,
  };
  const dirty = dirtyTabs.sources || dirtyTabs.auto || dirtyTabs.models;

  function editDefault(v: string) {
    setDraftDefault(v === savedDefault ? null : v);
  }
  function editAuto(src: string, next: AutoConfig) {
    const saved = autoFor(props.autoConfigs ?? {}, src);
    setDraftAuto((d) => {
      const { [src]: _old, ...rest } = d;
      return sameValue(next, saved) ? rest : { ...rest, [src]: next };
    });
  }
  function editPrefs(next: ModelPrefs) {
    setDraftPrefs(sameValue(next, props.prefs) ? null : next);
  }
  function cancel() {
    setDraftDefault(null);
    setDraftAuto({});
    setDraftPrefs(null);
  }
  function save() {
    if (!dirty) return;
    if (draftDefault !== null) {
      saveDefaultSource(draftDefault);
      setSavedDefault(draftDefault);
    }
    for (const [src, cfg] of Object.entries(draftAuto)) props.onAutoConfig?.(src, cfg);
    if (draftPrefs) props.onPrefs(draftPrefs);
    cancel();
    setSavedFlash(true);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setSavedFlash(false), 2000);
  }
  function resetTab() {
    if (shownTab === "sources") editDefault("");
    else if (shownTab === "auto") editAuto(autoSource, DEFAULT_AUTO);
    else editPrefs(defaultPrefs(props.prefs));
  }
  if (props.guardRef) props.guardRef.current = { dirty, save, discard: cancel };
  useEffect(() => {
    const ref = props.guardRef;
    return () => {
      if (ref) ref.current = null;
    };
  }, [props.guardRef]);

  const resetTip: Record<NetworkTab, MsgKey> = {
    sources: "net.resetTip.sources",
    auto: "net.resetTip.auto",
    models: "net.resetTip.models",
  };

  function setTab(next: NetworkTab) {
    setTabState(next);
    saveNetworkTab(next);
  }

  useEffect(() => {
    if (isFreshFocus(props.focus?.n)) setTab("models");
  }, [props.focus]);
  useEffect(() => {
    if (isFreshFocus(props.focusAdd)) setTab("models");
  }, [props.focusAdd]);
  useEffect(() => {
    if (isFreshFocus(props.focusSources)) setTab("sources");
  }, [props.focusSources]);
  useEffect(() => {
    if (props.focusTab && isFreshFocus(props.focusTab.n)) setTab(props.focusTab.tab);
  }, [props.focusTab]);
  useEffect(() => {
    if (!isFreshFocus(props.focusAuto)) return;
    setAutoSrc(props.activeSource ?? "");
    setTab("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focusAuto]);

  const autoSource = sources.some((x) => x.id === autoSrc) ? autoSrc : (sources[0]?.id ?? "");
  // Auto picks among the models the user left on.
  const visible = props.catalog.filter((m) => isModelOn(m, prefs));
  const rows = [...props.catalog, ...prefs.extras.filter((e) => !props.catalog.some((c) => c.id === e.id))];
  const onCount = rows.filter((m) => isModelOn(m, prefs)).length;

  const def =
    sources.find((s) => s.id === defaultSource) ?? sources.find((s) => s.kind === DEFAULT_SOURCE_KIND) ?? sources[0];
  const active = sources.find((s) => s.id === props.activeSource) ?? def;
  const sourcesWarn = Boolean(def && !def.available);
  const modelName =
    props.activeModel === "auto"
      ? "Auto"
      : (() => {
          const m = rows.find((x) => x.id === props.activeModel);
          return m ? shortName(m) : props.activeModel;
        })();

  return (
    <div
      className={`network-page${props.embedded ? " in-dialog" : ""}`}
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          save();
        }
      }}
    >
      <header className="net-head">
        {props.embedded ? null : <h2>{t("net.title")}</h2>}
        <p className="net-status">
          {t("net.status.model")} <b>{modelName}</b>
          {active ? (
            <>
              {" · "}
              {t("net.status.source")} <b>{active.label}</b>
              {!active.available ? <span className="net-warn"> ({t("src.notAvailable")})</span> : null}
            </>
          ) : null}
        </p>
      </header>

      <div className="network-tabs" role="tablist" aria-label={t("net.title")}>
        {NETWORK_TABS.filter((id) => id !== "auto" || hasAuto).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`net-tab-${id}`}
            aria-selected={shownTab === id}
            aria-controls={`net-panel-${id}`}
            className={shownTab === id ? "active" : undefined}
            onClick={() => setTab(id)}
          >
            {t(TAB_LABEL[id])}
            {id === "models" ? <span className="net-count">{onCount}</span> : null}
            {dirtyTabs[id] ? (
              <span className="net-unsaved" title={t("net.tabUnsaved")} aria-label={t("net.tabUnsaved")}>
                •
              </span>
            ) : null}
            {id === "sources" && sourcesWarn ? (
              <span className="net-dot" title={t("net.defaultUnavailable")} aria-label={t("net.defaultUnavailable")} />
            ) : null}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`net-panel-${shownTab}`} aria-labelledby={`net-tab-${shownTab}`}>
        {shownTab === "sources" ? (
          <ProviderSources onChanged={props.onSourcesChanged} defaultSource={defaultSource} onDefaultChange={editDefault} />
        ) : null}

        {shownTab === "auto" && hasAuto ? (
          <section className="auto-panel">
            <p className="net-intro">{t("auto.intro")}</p>
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
              config={autoOf(autoSource)}
              onChange={(next) => editAuto(autoSource, next)}
              source={autoSource}
              models={visible}
              spentUsd={autoSource === props.activeSource ? props.spentUsd : undefined}
              offModels={props.catalog.filter((m) => !isModelOn(m, prefs))}
              onOpenModels={() => setTab("models")}
            />
          </section>
        ) : null}

        {shownTab === "models" ? (
          <ModelListTab
            catalog={props.catalog}
            prefs={prefs}
            onPrefs={editPrefs}
            focus={props.focus}
            focusAdd={props.focusAdd}
            onOpenSources={() => setTab("sources")}
          />
        ) : null}
      </div>

      <div className={`net-actions${dirty ? " dirty" : ""}`} role="region" aria-label={t("net.actions")}>
        <button type="button" className="btn-light" onClick={resetTab} title={t(resetTip[shownTab])}>
          <RotateCcw size={14} aria-hidden="true" />
          {t("net.reset")}
        </button>
        {/* No visible status text (the buttons show it); screen readers still hear it. */}
        <span className="sr-only" aria-live="polite">
          {dirty ? t("net.unsaved") : savedFlash ? t("net.saved") : ""}
        </span>
        <button type="button" className="btn-light" onClick={cancel} disabled={!dirty}>
          {t("common.cancel")}
        </button>
        <button type="button" className="btn-solid" onClick={save} disabled={!dirty} title="Ctrl+S">
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}
