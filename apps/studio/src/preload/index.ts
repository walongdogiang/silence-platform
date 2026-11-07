import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("silence", {
  rpc: (method: string, params?: unknown) => ipcRenderer.invoke("silence-rpc", method, params),
  pickFolder: () => ipcRenderer.invoke("silence-pick-folder") as Promise<string | null>,
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
