/** Pure helpers for the app-wide tooltip (`components/TooltipLayer.tsx`). */

export type TipParts = {
  /** Main label, e.g. "Toggle Panel". */
  label: string;
  /** Keyboard shortcut split on "+", e.g. ["Ctrl", "J"]. */
  keys?: string[];
  /** Muted note, e.g. "not wired yet". */
  note?: string;
  /** Second line under the label (from `data-tip-desc`), e.g. what "Fork from here" does. */
  desc?: string;
};

const KEY_TOKEN = /^(Ctrl|Alt|Shift|Cmd|Meta|Win|Esc|Enter|Tab|Space|Del|Delete|Backspace|Home|End|F\d{1,2}|[A-Z0-9]|[←→↑↓,./;'[\]\\`=-])$/;
const TRAILING_PAREN = /\s*\(([^()]+)\)\s*$/;

/** "Ctrl+Shift+E" → ["Ctrl", "Shift", "E"]; anything that is not a key combo → null. */
export function parseKeys(s: string): string[] | null {
  const raw = s.trim();
  // "+" itself as the last key: "Ctrl++".
  const parts = raw.endsWith("++") ? [...raw.slice(0, -2).split("+"), "+"] : raw.split("+");
  if (parts.length === 0 || parts.some((p) => p === "")) return null;
  const needsModifier = parts.length === 1 && /^[A-Z0-9]$/.test(parts[0]);
  if (needsModifier) return null; // "(A)" is more likely a label than a shortcut
  return parts.every((p) => p === "+" || KEY_TOKEN.test(p)) ? parts : null;
}

/**
 * Split a `title` string into label, shortcut and note. Trailing "(Ctrl+J)" becomes `keys`;
 * a trailing parenthesis equal to one of `notes` (case-insensitive, e.g. the localized
 * "not wired yet") becomes `note`. Both may appear, in either order.
 */
export function parseTip(text: string, notes: string[] = []): TipParts {
  let label = text.trim();
  let keys: string[] | undefined;
  let note: string | undefined;
  const lower = notes.map((n) => n.trim().toLowerCase()).filter(Boolean);
  for (let i = 0; i < 2; i++) {
    const m = TRAILING_PAREN.exec(label);
    if (!m) break;
    const inner = m[1].trim();
    const k = keys ? null : parseKeys(inner);
    if (k) keys = k;
    else if (!note && lower.includes(inner.toLowerCase())) note = inner;
    else break;
    label = label.slice(0, m.index).trim();
  }
  if (!label) return { label: text.trim() };
  return { label, ...(keys ? { keys } : {}), ...(note ? { note } : {}) };
}

export type Rect = { left: number; top: number; width: number; height: number };
export type Placement = { x: number; y: number; side: "below" | "above" };

/**
 * Center the tip under the anchor (above when it does not fit below), clamped to the
 * viewport with `margin` px on each side. `prefer: "above"` flips the preference
 * (above unless it does not fit) — used by message action rows, like Claude.
 */
export function placeTip(
  anchor: Rect,
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 6,
  margin = 8,
  prefer: Placement["side"] = "below",
): Placement {
  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - gap - tip.height;
  const fitsBelow = below + tip.height <= viewport.height - margin;
  const fitsAbove = above >= margin;
  const side: Placement["side"] =
    prefer === "above" ? (fitsAbove || !fitsBelow ? "above" : "below") : fitsBelow || !fitsAbove ? "below" : "above";
  const rawX = anchor.left + anchor.width / 2 - tip.width / 2;
  const maxX = Math.max(margin, viewport.width - margin - tip.width);
  const x = Math.round(Math.min(Math.max(rawX, margin), maxX));
  const y = Math.round(side === "below" ? below : above);
  return { x, y, side };
}
