import type { ReactNode } from "react";

/**
 * One Settings row: bold label + muted description on the left, the control on the right.
 * `wide` puts the control under the text (thumbnails, card pickers). `id` is the search target.
 */
export function SettingRow(props: {
  id: string;
  label: ReactNode;
  desc?: ReactNode;
  wide?: boolean;
  /** Small pill after the label, e.g. "Uses model calls". */
  badge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`set-row${props.wide ? " wide" : ""}`} data-setting={props.id}>
      <div className="set-row-text">
        <div className="set-row-label">
          {props.label}
          {props.badge ? <span className="set-badge">{props.badge}</span> : null}
        </div>
        {props.desc ? <div className="set-row-desc">{props.desc}</div> : null}
      </div>
      {props.children ? <div className="set-row-control">{props.children}</div> : null}
    </div>
  );
}

/** Segmented control (Dark | Light | Auto). */
export function Segmented<V extends string>(props: {
  value: V;
  options: { id: V; label: ReactNode }[];
  onChange: (v: V) => void;
  label: string;
}) {
  return (
    <div className="set-seg" role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={props.value === o.id}
          className={props.value === o.id ? "on" : undefined}
          onClick={() => props.onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** On/off switch (same look as the Models list). */
export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      className={`switch${props.checked ? " on" : ""}`}
      onClick={() => props.onChange(!props.checked)}
    />
  );
}

/** Small uppercase heading that splits one section into groups (e.g. Code & terminal). */
export function SettingGroup(props: { title: ReactNode }) {
  return <h3 className="set-group-title">{props.title}</h3>;
}
