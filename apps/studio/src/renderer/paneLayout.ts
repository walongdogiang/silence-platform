/** Pane column width (`silence.shell.paneWidth`): default, limits, storage. */
export const PANE_DEFAULT = 520;
export const PANE_MIN = 360;
/** At most this share of the window, so the chat never disappears while resizing. */
export const PANE_MAX_SHARE = 0.7;

export function clampPaneWidth(width: number, windowWidth: number): number {
  const max = Math.max(PANE_MIN, Math.floor(windowWidth * PANE_MAX_SHARE));
  if (!Number.isFinite(width)) return PANE_DEFAULT;
  return Math.round(Math.min(max, Math.max(PANE_MIN, width)));
}

export function loadPaneWidth(raw: string | null, windowWidth: number): number {
  const n = raw ? Number(raw) : NaN;
  return clampPaneWidth(Number.isFinite(n) ? n : PANE_DEFAULT, windowWidth);
}
