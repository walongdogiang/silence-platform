import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../");

let win: BrowserWindow | null = null;
let child: ChildProcess | null = null;
let sock: net.Socket | null = null;
let rpcBuf = "";
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function runtimeBin(): string {
  if (process.env.SILENCE_ENGINE) return process.env.SILENCE_ENGINE;
  if (process.env.SILENCE_RUNTIME) return process.env.SILENCE_RUNTIME;
  const exe = process.platform === "win32" ? "silence-engine.exe" : "silence-engine";
  return path.join(repoRoot, "target", "debug", exe);
}

function preloadScript(): string {
  for (const name of ["index.cjs", "index.js", "index.mjs"]) {
    const candidate = path.join(here, "../preload", name);
    if (existsSync(candidate)) return candidate;
  }
  return path.join(here, "../preload/index.cjs");
}

function appIcon(): string | undefined {
  const candidates = [
    path.join(repoRoot, "apps/studio/resources/icon.png"),
    path.join(repoRoot, "apps/studio/src/renderer/assets/logo.png"),
  ];
  return candidates.find((p) => existsSync(p));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1536,
    height: 1024,
    minWidth: 1100,
    minHeight: 720,
    title: "5ilence Studio",
    backgroundColor: "#171819",
    show: true,
    frame: false,
    autoHideMenuBar: true,
    icon: appIcon(),
    webPreferences: {
      preload: preloadScript(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("did-fail-load", code, desc, url);
    void win?.webContents.executeJavaScript(
      `document.body.innerHTML = '<pre style="color:#eee;padding:24px;font:14px sans-serif">Không tải được UI\\n${desc}\\n${url}</pre>'`,
    );
  });
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void win.loadURL(rendererUrl);
  } else {
    void win.loadFile(path.join(here, "../renderer/index.html"));
  }
}

function sendLine(obj: unknown) {
  if (!sock) throw new Error("Engine chưa kết nối — đóng app, chạy lại npm run studio");
  sock.write(`${JSON.stringify(obj)}\n`);
}

function rpc(method: string, params?: unknown): Promise<unknown> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      sendLine({ jsonrpc: "2.0", id, method, params: params ?? {} });
    } catch (err) {
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`rpc timeout: ${method}`));
      }
    }, 120_000);
  });
}

function onData(chunk: Buffer) {
  rpcBuf += chunk.toString("utf8");
  let idx: number;
  while ((idx = rpcBuf.indexOf("\n")) >= 0) {
    const line = rpcBuf.slice(0, idx).trim();
    rpcBuf = rpcBuf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line) as {
        id?: number;
        method?: string;
        result?: unknown;
        error?: { message: string };
        params?: unknown;
      };
      if (msg.method === "session.event") {
        win?.webContents.send("silence-event", msg.params);
        continue;
      }
      if (msg.id != null && pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result);
      }
    } catch (err) {
      console.warn("bad rpc line", err);
    }
  }
}

async function startRuntime(): Promise<void> {
  const bin = runtimeBin();
  if (!existsSync(bin)) {
    throw new Error(`Không thấy ${bin}. Chạy: .\\scripts\\cargo-msvc.bat build -p silence-engine`);
  }
  child = spawn(
    bin,
    ["serve", "--tcp", "127.0.0.1:0", "--config", path.join(repoRoot, "config/models.yaml")],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    },
  );
  let ready = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`runtime start timeout: ${ready}`)), 20_000);
    child!.stderr!.on("data", (d: Buffer) => {
      const s = d.toString("utf8");
      ready += s;
      process.stderr.write(s);
      const m = ready.match(/tcp=([^\s]+)/);
      if (m) {
        clearTimeout(timer);
        connect(m[1]).then(resolve).catch(reject);
      }
    });
    child!.on("exit", (code) => {
      if (!sock) {
        clearTimeout(timer);
        reject(new Error(`runtime exited ${code}: ${ready}`));
      }
    });
  });
}

function connect(addr: string): Promise<void> {
  const [host, port] = addr.split(":");
  return new Promise((resolve, reject) => {
    sock = net.connect({ host, port: Number(port) }, () => resolve());
    sock.on("data", onData);
    sock.on("error", reject);
  });
}

/* Windows overlay scrollbar bỏ border-radius — dùng classic để CSS bo tròn có hiệu lực */
app.commandLine.appendSwitch("disable-features", "OverlayScrollbar");

app.whenReady().then(async () => {
  ipcMain.handle("win-min", () => win?.minimize());
  ipcMain.handle("win-max", () => {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle("win-close", () => win?.close());
  ipcMain.handle("silence-rpc", (_e, method: string, params?: unknown) => rpc(method, params));
  ipcMain.handle("silence-pick-folder", async () => {
    const res = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (res.canceled || !res.filePaths[0]) return null;
    return res.filePaths[0];
  });
  createWindow();
  try {
    await startRuntime();
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    win?.webContents.once("did-finish-load", () => {
      win?.webContents.send("silence-event", {
        event: { type: "error", message: `Sidecar: ${message}` },
      });
    });
  }
});

app.on("window-all-closed", () => {
  child?.kill();
  sock?.destroy();
  app.quit();
});
