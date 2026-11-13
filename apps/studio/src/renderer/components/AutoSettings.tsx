import { Check, Settings2 } from "lucide-react";
import { useState } from "react";
import {
  AUTO_MODES,
  AUTO_SLOTS,
  autoCandidates,
  autoSummaryShort,
  fmtUsd,
  MODE_SLOT_DEFAULT,
  modeSlot,
  poolImpact,
  PRESETS,
  slotModel,
  shortName,
  withModeSlot,
  type AutoConfig,
  type AutoPreset,
  type AutoSlot,
} from "../autoConfig";
import { useT, type T } from "../i18n";
import { MODE_LABEL } from "../modes";
import type { ModelInfo } from "../types";

/** Spend cap input. `undefined` = no cap. */
function BudgetInput(props: { value?: number; onChange: (v: number | undefined) => void; label: string; t: T }) {
  return (
    <span className="auto-budget-input">
      $
      <input
        type="number"
        min={0}
        step={0.5}
        placeholder={props.t("auto.capNone")}
        aria-label={props.label}
        value={props.value ?? ""}
        onChange={(e) => {
          const v = e.target.value.trim() === "" ? undefined : Number(e.target.value);
          props.onChange(v !== undefined && Number.isFinite(v) && v > 0 ? v : undefined);
        }}
      />
    </span>
  );
}

/** Spend cap without a dangling `budget_usd: undefined` key. */
function withBudget(cfg: AutoConfig, v: number | undefined): AutoConfig {
  const { budget_usd: _old, ...rest } = cfg;
  return v === undefined ? rest : { ...rest, budget_usd: v };
}

/** Tooltip of a preset / the Auto row: "Plan & review: Opus · Build: Sonnet · Side work: Haiku". */
export function autoTip(line: string, t: T): string {
  const [plan, build, side] = line.split(" · ");
  return plan ? t("model.autoTip", { plan, build, side }) : t("model.autoTipEmpty");
}

/**
 * Composer model menu → Auto settings: quick choices only. Per-mode slots, custom slots and the
 * pool live in Settings → Models → Auto.
 */
export function AutoQuickMenu(props: {
  config: AutoConfig;
  onChange: (next: AutoConfig) => void;
  source: string;
  models: ModelInfo[];
  /** USD this chat spent (shown next to the cap). */
  spentUsd?: number;
  onMore?: () => void;
}) {
  const t = useT();
  const cfg = props.config;
  return (
    <div className="auto-quick">
      <p className="effort-hint">{t("auto.quickHint")}</p>
      {PRESETS.map(({ id }) => {
        const line = autoSummaryShort({ ...cfg, preset: id }, props.source, props.models);
        return (
          <button
            key={id}
            type="button"
            role="menuitemradio"
            aria-checked={cfg.preset === id}
            className={`effort-item auto-preset${cfg.preset === id ? " active" : ""}`}
            title={id === "custom" ? undefined : autoTip(line, t)}
            onClick={() => props.onChange({ ...cfg, preset: id })}
          >
            <span className="effort-label auto-preset-label">
              <span>
                {t(`preset.${id}`)}
                {id === "balanced" ? <span className="effort-badge">{t("model.recommended")}</span> : null}
              </span>
              <small>{id === "custom" ? t("auto.customLine") : line}</small>
            </span>
            {cfg.preset === id ? <Check size={16} className="effort-check" /> : <span />}
          </button>
        );
      })}
      <div className="auto-quick-budget">
        <span>
          {t("auto.cap")}
          {props.spentUsd ? <small>{t("auto.used", { usd: fmtUsd(props.spentUsd) })}</small> : null}
        </span>
        <BudgetInput t={t} label={t("auto.cap")} value={cfg.budget_usd} onChange={(v) => props.onChange(withBudget(cfg, v))} />
      </div>
      {props.onMore ? (
        <button type="button" className="effort-item auto-more" onClick={props.onMore}>
          <span className="effort-label">
            <Settings2 size={13} aria-hidden="true" />
            {t("auto.more")}
          </span>
          <span />
        </button>
      ) : null}
    </div>
  );
}

/** Three-way slot switch (Frontier / Strong / Small); a dot marks the mode's default. */
function SlotSwitch(props: { value: AutoSlot; fallback?: AutoSlot; onChange: (s: AutoSlot) => void; label: string; t: T }) {
  const { t } = props;
  return (
    <span className="slot-switch" role="radiogroup" aria-label={props.label}>
      {AUTO_SLOTS.map((s) => (
        <button
          key={s}
          type="button"
          role="radio"
          aria-checked={props.value === s}
          className={props.value === s ? "on" : undefined}
          title={s === props.fallback ? t("auto.defaultMark", { slot: t(`slot.${s}`) }) : t(`slot.${s}`)}
          onClick={() => props.onChange(s)}
        >
          {t(`slot.${s}`)}
          {s === props.fallback ? <i className="slot-default-dot" aria-hidden="true" /> : null}
        </button>
      ))}
    </span>
  );
}

/** Settings → Models → Auto: everything for one source. */
export function AutoSettings(props: {
  config: AutoConfig;
  onChange: (next: AutoConfig) => void;
  /** Provider id these settings belong to. */
  source: string;
  /** Models the user can see (switched-off ones already removed). */
  models: ModelInfo[];
  /** USD the active chat spent (only when this is the active source). */
  spentUsd?: number;
  /** Models switched off in the Models tab: listed greyed out in the pool so the link is visible. */
  offModels?: ModelInfo[];
  /** Jump to the Models tab (picker switches). */
  onOpenModels?: () => void;
}) {
  const t = useT();
  const cfg = props.config;
  const ofSource = props.models.filter((m) => m.provider === props.source);
  const offOfSource = (props.offModels ?? []).filter((m) => m.provider === props.source);
  const pool = cfg.pool ?? [];
  const cands = autoCandidates(cfg, props.source, props.models);
  const set = (patch: Partial<AutoConfig>) => props.onChange({ ...cfg, ...patch });
  const [impact, setImpact] = useState<string>("");
  const inPool = (m: ModelInfo) => (pool.length > 0 ? pool.includes(m.id) : !m.opt_in);

  const togglePool = (id: string) => {
    // An empty pool means "every model": the first untick starts from that full list.
    const base = pool.length > 0 ? pool : ofSource.filter((m) => !m.opt_in).map((m) => m.id);
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    if (next.length === 0) {
      setImpact(t("auto.poolEmpty"));
      return;
    }
    const moved = poolImpact(cfg, props.source, props.models, next);
    setImpact(
      moved.length > 0
        ? t("auto.poolAfter", { list: moved.map((x) => `${t(`slot.${x.slot}`)} → ${x.model}`).join(" · ") })
        : "",
    );
    const all = ofSource.filter((m) => !m.opt_in).map((m) => m.id);
    const same = next.length === all.length && all.every((x) => next.includes(x));
    set({ pool: same ? [] : next });
  };

  return (
    <div className="auto-settings">
      <div className="auto-presets" role="radiogroup" aria-label={t("auto.preset")}>
        {PRESETS.map(({ id }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={cfg.preset === id}
            className={`auto-preset-card${cfg.preset === id ? " on" : ""}`}
            onClick={() => set({ preset: id as AutoPreset })}
          >
            <b>
              {t(`preset.${id}`)}
              {id === "balanced" ? <span className="effort-badge">{t("model.recommended")}</span> : null}
            </b>
            <small>{t(`preset.${id}.hint`)}</small>
            <small className="auto-preset-line">
              {autoSummaryShort({ ...cfg, preset: id }, props.source, props.models)}
            </small>
          </button>
        ))}
      </div>

      <div className="auto-section auto-budget">
        <span>
          {t("auto.capChat")}
          <small>{props.spentUsd ? t("auto.capChatUsed", { usd: fmtUsd(props.spentUsd) }) : t("auto.capChatNone")}</small>
        </span>
        <BudgetInput
          t={t}
          label={t("auto.capChat")}
          value={cfg.budget_usd}
          onChange={(v) => props.onChange(withBudget(cfg, v))}
        />
      </div>

      {cfg.preset === "custom" ? (
        <div className="auto-section">
          <p className="auto-section-title">{t("auto.slotModels")}</p>
          {AUTO_SLOTS.map((slot) => {
            const resolved = slotModel({ ...cfg, preset: "balanced" }, slot, props.source, props.models);
            const value = cfg.slots?.[slot] && cands.some((m) => m.id === cfg.slots?.[slot]) ? cfg.slots[slot] : "";
            return (
              <label key={slot} className="auto-row">
                <span className="auto-row-name">{t(`slot.${slot}`)}</span>
                <select
                  className="auto-select"
                  value={value}
                  onChange={(e) => set({ slots: { ...cfg.slots, [slot]: e.target.value } })}
                >
                  <option value="">{t("auto.default", { model: shortName(resolved) })}</option>
                  {cands.map((m) => (
                    <option key={m.id} value={m.id}>
                      {shortName(m)}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      ) : null}

      <div className="auto-section">
        <p className="auto-section-title">{t("auto.table")}</p>
        <div className="auto-table" role="table">
          {AUTO_MODES.map((mode) => {
            const slot = modeSlot(cfg, mode);
            return (
              <div key={mode} className="auto-row" role="row">
                <span className="auto-row-name" role="cell">
                  {MODE_LABEL[mode]}
                </span>
                <SlotSwitch
                  t={t}
                  label={t("auto.slotOf", { mode: MODE_LABEL[mode] })}
                  value={slot}
                  fallback={MODE_SLOT_DEFAULT[mode]}
                  onChange={(s) => props.onChange(withModeSlot(cfg, mode, s))}
                />
                <span className="auto-row-model" role="cell">
                  {shortName(slotModel(cfg, slot, props.source, props.models))}
                </span>
              </div>
            );
          })}
          <div className="auto-row fixed" role="row">
            <span className="auto-row-name" role="cell">
              {t("auto.sideWork")}
              <small>{t("auto.sideWorkSub")}</small>
            </span>
            <span className="auto-row-fixed" role="cell">
              {t("auto.fixedSmall")}
            </span>
            <span className="auto-row-model" role="cell">
              {shortName(slotModel(cfg, "small", props.source, props.models))}
            </span>
          </div>
        </div>
        <p className="auto-note">{t("auto.note")}</p>
      </div>

      {ofSource.length > 1 || offOfSource.length > 0 ? (
        <div className="auto-section">
          <p className="auto-section-title">{t("auto.pool")}</p>
          <p className="auto-note auto-pool-hint">
            {t("auto.poolHint")}{" "}
            {props.onOpenModels ? (
              <button type="button" className="link-btn" onClick={props.onOpenModels}>
                {t("auto.poolOpenModels")}
              </button>
            ) : null}
          </p>
          {ofSource.map((m) => (
            <label key={m.id} className="auto-pool-row" title={m.opt_in ? t("auto.poolCostly") : undefined}>
              <input type="checkbox" checked={inPool(m)} onChange={() => togglePool(m.id)} />
              <span>{shortName(m)}</span>
            </label>
          ))}
          {offOfSource.map((m) => (
            <label key={m.id} className="auto-pool-row off" title={t("auto.poolOffInModels")}>
              <input type="checkbox" checked={false} disabled />
              <span>{shortName(m)}</span>
              <small>{t("auto.poolOffInModels")}</small>
            </label>
          ))}
          {impact ? <p className="auto-impact">{impact}</p> : null}
        </div>
      ) : null}

    </div>
  );
}
