import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("silence", {
  rpc: (method: string, params?: unknown) => ipcRenderer.invoke("silence-rpc", method, params),
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
  window: {
    minimize: () => ipcRenderer.invoke("win-min"),
    maximize: () => ipcRenderer.invoke("win-max"),
    close: () => ipcRenderer.invoke("win-close"),
  },
});
