/** Agent's headless browser as the Studio shows it (Browser tab). Spec: docs/frontend/layout.md → Browser. */

export type BrowserView = { url: string; title: string; frame?: string; errors: number; failed: number };

type BrowserEvent = { url: string; title: string; frame?: string; errors: number; failed: number };

/** From a `browser` event: empty `url` = the agent closed the browser. A frame-less event keeps the last frame. */
export function applyBrowser(prev: BrowserView | null, ev: BrowserEvent): BrowserView | null {
  if (!ev.url) return null;
  const frame = ev.frame && /^data:image\/(jpeg|png);base64,/.test(ev.frame) ? ev.frame : prev?.frame;
  return { url: ev.url, title: ev.title, frame, errors: ev.errors || 0, failed: ev.failed || 0 };
}

/** Address without the scheme, for the header. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
