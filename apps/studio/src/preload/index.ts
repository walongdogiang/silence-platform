import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("silence", {
  rpc: (method: string, params?: unknown) => ipcRenderer.invoke("silence-rpc", method, params),
  pickFolder: () => ipcRenderer.invoke("silence-pick-folder") as Promise<string | null>,
  openExternal: (url: string) => ipcRenderer.invoke("silence-open-external", url) as Promise<boolean>,
  copyImage: (png: Uint8Array) => ipcRenderer.invoke("silence-copy-image", png) as Promise<boolean>,
  notifyPermission: (reason: string) => ipcRenderer.invoke("silence-notify-permission", reason) as Promise<boolean>,
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
  window: {
    minimize: () => ipcRenderer.invoke("win-min"),
    maximize: () => ipcRenderer.invoke("win-max"),
    close: () => ipcRenderer.invoke("win-close"),
  },
});
