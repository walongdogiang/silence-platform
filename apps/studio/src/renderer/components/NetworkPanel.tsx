import { useEffect, useRef, useState } from "react";
import type { ModelInfo } from "../types";
import { isModelOn, modelTitle, toggleModel, type ModelPrefs } from "../theme/modelsPrefs";
import { ProviderSources } from "./ProviderSources";

export function NetworkPanel(props: {
  catalog: ModelInfo[];
  prefs: ModelPrefs;
  onPrefs: (next: ModelPrefs) => void;
  activeModel: string;
  onSourcesChanged?: () => void;
  /** Scroll to + flash this model's row (from the picker's Enable button). `n` re-triggers. */
  focus?: { id: string; n: number } | null;
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
  const extrasIds = new Set(props.prefs.extras.map((e) => e.id));
  const rows = [
    ...props.catalog,
    ...props.prefs.extras.filter((e) => !props.catalog.some((c) => c.id === e.id)),
  ];


  function add() {
    const id = slug.trim();
    if (!id.includes("/")) {
      setErr("Slug OpenRouter phải dạng vendor/model, ví dụ anthropic/claude-sonnet-5.5");
      return;
    }
    if (rows.some((m) => m.id === id)) {
      setErr("Model này đã có trong danh sách.");
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
      <header>
        <h2>Models</h2>
        <p>Chọn model hiện trong picker. Slug OpenRouter (vendor/model) — gọi qua nguồn OpenRouter.</p>
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
              {m.opt_in ? <small className="model-optin">Uses many more tokens — off by default</small> : null}
            </div>
            {extrasIds.has(m.id) ? (
              <button type="button" className="ghost" onClick={() => removeExtra(m.id)}>
                Xóa
              </button>
            ) : null}
            <button
              type="button"
              className={`switch${isModelOn(m, props.prefs) ? " on" : ""}`}
              role="switch"
              aria-checked={isModelOn(m, props.prefs)}
              aria-label={`Bật ${modelTitle(m)}`}
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
        <h3>Thêm model</h3>
        <label className="field">
          Slug OpenRouter
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="google/gemini-2.5-pro"
          />
        </label>
        <label className="field">
          Tên hiển thị
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Gemini 2.5 Pro" />
        </label>
        <label className="field">
          Tier
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="fast">Fast</option>
            <option value="high-fast">Fast+</option>
            <option value="mid">Balanced</option>
            <option value="strong">Powerful</option>
            <option value="free">Free</option>
          </select>
        </label>
        {err ? <p className="hint">{err}</p> : null}
        <button type="submit" className="primary">
          Thêm vào picker
        </button>
      </form>
      <p className="hint">
        Đang chọn:{" "}
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
