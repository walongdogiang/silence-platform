import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("silence", {
  rpc: async (method: string, params?: unknown) => {
    const r = (await ipcRenderer.invoke("silence-rpc", method, params)) as { result?: unknown; error?: string };
    if (r.error !== undefined) throw new Error(r.error);
    return r.result;
  },
  pickFolder: () => ipcRenderer.invoke("silence-pick-folder") as Promise<string | null>,
  openExternal: (url: string) => ipcRenderer.invoke("silence-open-external", url) as Promise<boolean>,
  copyImage: (png: Uint8Array) => ipcRenderer.invoke("silence-copy-image", png) as Promise<boolean>,
  notifyPermission: (reason: string, opts?: { notify: boolean; flash: boolean }) =>
    ipcRenderer.invoke("silence-notify-permission", reason, opts) as Promise<boolean>,
  notifyDone: (title: string, opts?: { notify: boolean; flash: boolean }) =>
    ipcRenderer.invoke("silence-notify-done", title, opts) as Promise<boolean>,
  notifyTest: (title: string, body: string) => ipcRenderer.invoke("silence-notify-test", title, body) as Promise<boolean>,
  keepAwake: (on: boolean) => ipcRenderer.invoke("silence-keep-awake", on) as Promise<boolean>,
  openDataDir: () => ipcRenderer.invoke("silence-open-data-dir") as Promise<boolean>,
  credentials: {
    status: () => ipcRenderer.invoke("silence-credentials-status"),
    /** `key: ""` clears. Resolves to the new status (never the key). */
    set: (provider: string, key: string) => ipcRenderer.invoke("silence-credentials-set", provider, key),
  },
  onEvent: (cb: (payload: unknown) => void) => {
    const listener = (_: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("silence-event", listener);
    return () => ipcRenderer.removeListener("silence-event", listener);
  },
  /** Eval run progress (`eval.progress` from the Engine). */
  onEval: (cb: (payload: unknown) => void) => {
    const listener = (_: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on("silence-eval", listener);
    return () => ipcRenderer.removeListener("silence-eval", listener);
  },
  /** Show an eval result folder in the file manager (main allows evals/results only). */
  revealEval: (target: string) => ipcRenderer.invoke("silence-reveal-eval", target) as Promise<boolean>,
  /** Preview pane (main owns the WebContentsView; it re-checks every URL). */
  preview: {
    open: (url: string) => ipcRenderer.invoke("silence-preview-open", url) as Promise<boolean>,
    nav: (action: "back" | "forward" | "reload" | "stop" | "devtools") =>
      ipcRenderer.invoke("silence-preview-nav", action) as Promise<boolean>,
    layout: (rect: { x: number; y: number; width: number; height: number } | null, show: boolean) =>
      ipcRenderer.invoke("silence-preview-layout", rect, show) as Promise<boolean>,
    capture: () => ipcRenderer.invoke("silence-preview-capture") as Promise<string | null>,
    state: () => ipcRenderer.invoke("silence-preview-state"),
    onState: (cb: (state: unknown) => void) => {
      const listener = (_: unknown, s: unknown) => cb(s);
      ipcRenderer.on("silence-preview-state", listener);
      return () => ipcRenderer.removeListener("silence-preview-state", listener);
    },
    /** App shortcuts pressed while the page had focus. */
    onKey: (cb: (key: { code: string; ctrl: boolean; shift: boolean; alt: boolean }) => void) => {
      const listener = (_: unknown, k: { code: string; ctrl: boolean; shift: boolean; alt: boolean }) => cb(k);
      ipcRenderer.on("silence-preview-key", listener);
      return () => ipcRenderer.removeListener("silence-preview-key", listener);
    },
  },
  window: {
    minimize: () => ipcRenderer.invoke("win-min"),
    maximize: () => ipcRenderer.invoke("win-max"),
    close: () => ipcRenderer.invoke("win-close"),
  },
});
