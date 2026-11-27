/** Preview tab helpers (renderer side). Main re-checks every URL; these only shape the UI. */
import { isLocalUrl } from "./procs";

export type PreviewState = {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  error: string;
};

export const EMPTY_PREVIEW: PreviewState = { url: "", title: "", loading: false, canGoBack: false, canGoForward: false, error: "" };

export function asPreviewState(v: unknown): PreviewState {
  if (!v || typeof v !== "object") return EMPTY_PREVIEW;
  const o = v as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  return {
    url: str("url"),
    title: str("title"),
    loading: o.loading === true,
    canGoBack: o.canGoBack === true,
    canGoForward: o.canGoForward === true,
    error: str("error"),
  };
}

/** What the user typed → a full URL (`localhost:5173` → `http://localhost:5173/`), or null. */
export function normalizeInput(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}

/** Loopback http(s) only (localhost, 127.0.0.1, [::1]). */
export const isPreviewable = isLocalUrl;

/** Last URL per workspace (`silence.preview.urls`). */
export const URLS_KEY = "silence.preview.urls";

export function readUrls(raw: string | null): Record<string, string> {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, u] of Object.entries(v as Record<string, unknown>)) if (typeof u === "string" && isPreviewable(u)) out[k] = u;
    return out;
  } catch {
    return {};
  }
}

/** Remember `url` for `workspace`; keeps at most 30 workspaces (latest wins). */
export function rememberUrl(all: Record<string, string>, workspace: string, url: string): Record<string, string> {
  if (!workspace || !isPreviewable(url)) return all;
  const next = { ...all };
  delete next[workspace];
  next[workspace] = url;
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - 30))) delete next[k];
  return next;
}

type Box = { left: number; top: number; right: number; bottom: number };

/** True when an overlay box covers part of the page area (the native view would hide it). */
export function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** DOM overlays the native page must not cover: dialogs, menus, toasts, lightbox, title-bar menus. */
export const OVERLAY_SELECTOR =
  '[aria-modal="true"], [role="dialog"], [role="menu"], [role="listbox"], .chrome-drop, .app-toast, .undo-toast, .lightbox, .ie, .set-backdrop, .unsaved-backdrop';
