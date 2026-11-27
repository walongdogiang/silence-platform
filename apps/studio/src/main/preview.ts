import { type BrowserWindow, type IpcMain, type Rectangle, WebContentsView, session, shell } from "electron";
import { forwardedShortcut } from "./previewKeys";
import { isLoopbackUrl, isSafeExternalUrl, previewNavDecision } from "./safeUrl";

/** What the renderer shows above the page (address, title, buttons). */
export type PreviewState = {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Main-frame load error, e.g. "ERR_CONNECTION_REFUSED". Empty when the page loaded. */
  error: string;
};

/** In-memory session (no `persist:`): cookies and storage go away when the app quits, never shared with the UI. */
const PARTITION = "preview";

/**
 * One `WebContentsView` per window for the Preview tab. The renderer only draws the toolbar and a
 * placeholder; it sends bounds and commands over `silence-preview-*`, and main re-checks every URL.
 */
export function installPreview(ipc: IpcMain, getWin: () => BrowserWindow | null) {
  let view: WebContentsView | null = null;
  let owner: BrowserWindow | null = null;
  let visible = false;
  let bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  let lastError = "";

  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on("will-download", (e) => e.preventDefault());

  function send(state: PreviewState) {
    const w = getWin();
    if (w && !w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send("silence-preview-state", state);
  }

  function state(): PreviewState {
    const wc = view?.webContents;
    if (!wc || wc.isDestroyed()) return { url: "", title: "", loading: false, canGoBack: false, canGoForward: false, error: "" };
    const url = wc.getURL();
    return {
      url,
      title: wc.getTitle() === url ? "" : wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      error: lastError,
    };
  }

  function push() {
    send(state());
  }

  function apply() {
    if (!view) return;
    const show = visible && bounds.width > 0 && bounds.height > 0 && !lastError;
    view.setVisible(show);
    if (show) view.setBounds(bounds);
  }

  /** Off-loopback navigation from inside the page: never in the pane; http(s) goes to the system browser. */
  function routeAway(url: string) {
    if (previewNavDecision(url) === "external" && isSafeExternalUrl(url)) void shell.openExternal(url);
  }

  function ensure(): WebContentsView | null {
    const w = getWin();
    if (!w || w.isDestroyed()) return null;
    if (view && owner === w && !view.webContents.isDestroyed()) return view;
    view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        navigateOnDragDrop: false,
        spellcheck: false,
      },
    });
    owner = w;
    w.contentView.addChildView(view);
    view.setVisible(false);
    const wc = view.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      if (previewNavDecision(url) === "allow") void wc.loadURL(url);
      else routeAway(url);
      return { action: "deny" };
    });
    const guard = (e: { preventDefault: () => void }, url: string) => {
      if (previewNavDecision(url) === "allow") return;
      e.preventDefault();
      routeAway(url);
    };
    wc.on("will-navigate", (e) => guard(e, e.url));
    wc.on("will-redirect", (e) => guard(e, e.url));
    wc.on("will-frame-navigate", (e) => {
      if (e.isMainFrame) guard(e, e.url);
    });
    wc.on("before-input-event", (e, input) => {
      if (input.type === "keyDown" && input.code === "F12" && !input.control && !input.alt && !input.shift) {
        e.preventDefault();
        wc.toggleDevTools();
        return;
      }
      if (!forwardedShortcut(input)) return;
      e.preventDefault();
      const target = getWin();
      if (target && !target.isDestroyed()) {
        target.webContents.focus();
        target.webContents.send("silence-preview-key", { code: input.code, ctrl: input.control, shift: input.shift, alt: input.alt });
      }
    });
    wc.on("did-start-loading", () => {
      lastError = "";
      apply();
      push();
    });
    wc.on("did-stop-loading", push);
    wc.on("did-navigate", push);
    wc.on("did-navigate-in-page", push);
    wc.on("page-title-updated", push);
    wc.on("did-fail-load", (_e, code, desc, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3 = aborted (e.g. a new navigation started)
      lastError = desc || `ERR_${code}`;
      apply();
      push();
    });
    wc.on("render-process-gone", (_e, details) => {
      lastError = `RENDERER_${details.reason.toUpperCase()}`;
      apply();
      push();
    });
    w.on("closed", () => {
      if (owner === w) {
        view = null;
        owner = null;
      }
    });
    return view;
  }

  ipc.handle("silence-preview-open", async (_e, raw: unknown) => {
    if (typeof raw !== "string" || !isLoopbackUrl(raw)) return false;
    const v = ensure();
    if (!v) return false;
    lastError = "";
    try {
      await v.webContents.loadURL(raw);
    } catch {
      // did-fail-load already recorded the reason.
    }
    push();
    return true;
  });
  ipc.handle("silence-preview-nav", (_e, action: unknown) => {
    const wc = view?.webContents;
    if (!wc || wc.isDestroyed()) return false;
    if (action === "back" && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (action === "forward" && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
    else if (action === "reload") {
      lastError = "";
      wc.reload();
    } else if (action === "stop") wc.stop();
    else if (action === "devtools") wc.toggleDevTools();
    else return false;
    return true;
  });
  ipc.handle("silence-preview-layout", (_e, rect: unknown, show: unknown) => {
    if (rect && typeof rect === "object") {
      const r = rect as Record<string, unknown>;
      const n = (k: string) => (typeof r[k] === "number" && Number.isFinite(r[k]) ? Math.max(0, Math.round(r[k] as number)) : 0);
      bounds = { x: n("x"), y: n("y"), width: n("width"), height: n("height") };
    }
    visible = show === true;
    apply();
    return true;
  });
  /** PNG of the page, shown under DOM overlays while the native view is hidden. */
  ipc.handle("silence-preview-capture", async () => {
    const wc = view?.webContents;
    if (!wc || wc.isDestroyed() || !visible || lastError) return null;
    try {
      const img = await wc.capturePage();
      return img.isEmpty() ? null : img.toDataURL();
    } catch {
      return null;
    }
  });
  ipc.handle("silence-preview-state", () => state());
}
