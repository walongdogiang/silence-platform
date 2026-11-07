import { useState } from "react";
import type { ModelInfo } from "../types";
import { modelTitle, speedLabel, type ModelPrefs } from "../theme/modelsPrefs";

export function NetworkPanel(props: {
  catalog: ModelInfo[];
  prefs: ModelPrefs;
  onPrefs: (next: ModelPrefs) => void;
  activeModel: string;
}) {
  const [slug, setSlug] = useState("");
  const [label, setLabel] = useState("");
  const [tier, setTier] = useState("mid");
  const [err, setErr] = useState("");
  const extrasIds = new Set(props.prefs.extras.map((e) => e.id));
  const rows = [
    ...props.catalog,
    ...props.prefs.extras.filter((e) => !props.catalog.some((c) => c.id === e.id)),
  ];

  function enabled(id: string) {
    return !props.prefs.disabled.includes(id);
  }

  function toggle(id: string) {
    const disabled = enabled(id)
      ? [...props.prefs.disabled, id]
      : props.prefs.disabled.filter((x) => x !== id);
    props.onPrefs({ ...props.prefs, disabled });
  }

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
      extras: props.prefs.extras.filter((e) => e.id !== id),
      disabled: props.prefs.disabled.filter((x) => x !== id),
    });
  }

  return (
    <div className="network-page">
      <header>
        <h2>Models</h2>
        <p>Chọn model hiện trong picker. Slug OpenRouter (vendor/model) — gọi qua SILENCE_API_KEY.</p>
      </header>
      <ul className="model-switch-list">
        {rows.map((m) => (
          <li key={m.id}>
            <div>
              <b>{modelTitle(m)}</b>
              <small>
                {m.id}
                {m.tier ? ` · ${speedLabel(m.tier)}` : ""}
              </small>
            </div>
            {extrasIds.has(m.id) ? (
              <button type="button" className="ghost" onClick={() => removeExtra(m.id)}>
                Xóa
              </button>
            ) : null}
            <button
              type="button"
              className={`switch${enabled(m.id) ? " on" : ""}`}
              role="switch"
              aria-checked={enabled(m.id)}
              aria-label={`Bật ${modelTitle(m)}`}
              onClick={() => toggle(m.id)}
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
            <option value="high-fast">High Fast</option>
            <option value="mid">Medium</option>
            <option value="strong">High</option>
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
