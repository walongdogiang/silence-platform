import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, Notification, powerSaveBlocker, safeStorage, shell } from "electron";
import { doneNotice, noticeOpts, permissionNotice, shouldNotify, type Notice } from "./notify";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, unwatchFile, watchFile, writeFileSync } from "node:fs";
import { CredentialStore, MAIN_ONLY_RPC, cleanKey, isKeyedProvider } from "./credentials";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAppNavigation, isSafeExternalUrl } from "./safeUrl";
import { isPngBytes } from "./clipboardImage";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../");

let win: BrowserWindow | null = null;
let keepAwakeId: number | null = null;

/** Báo khi người dùng không nhìn cửa sổ: thông báo desktop và/hoặc nháy taskbar. */
function notifyAway(notice: Notice, opts: { notify: boolean; flash: boolean }): boolean {
  if (!shouldNotify(win)) return false;
  if (opts.flash) win?.flashFrame(true);
  if (!opts.notify || !Notification.isSupported()) return opts.flash;
  const n = new Notification(notice);
  n.on("click", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  n.show();
  return true;
}
let child: ChildProcess | null = null;
let sock: net.Socket | null = null;
let rpcBuf = "";
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
/** Created after `app.whenReady` (userData + safeStorage need the app ready). */
let credentials: CredentialStore | null = null;

function openCredentials(): CredentialStore {
  const file = path.join(app.getPath("userData"), "credentials.json");
  return new CredentialStore(
    {
      read: () => (existsSync(file) ? readFileSync(file, "utf8") : null),
      write: (text) => writeFileSync(file, text, { encoding: "utf8", mode: 0o600 }),
    },
    {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (s) => safeStorage.encryptString(s).toString("base64"),
      decrypt: (s) => safeStorage.decryptString(Buffer.from(s, "base64")),
    },
  );
}

/** Push stored keys into the Engine (after every spawn/restart). Failures only log. */
async function pushCredentials() {
  if (!credentials) return;
  for (const { provider, key } of credentials.all()) {
    try {
      await rpc("providers.set_credential", { provider, key });
    } catch (err) {
      console.warn(`[credentials] ${provider}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

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
  // Cửa sổ đã hủy thì bỏ tham chiếu, để không ai gửi IPC vào webContents đã chết.
  win.on("closed", () => {
    win = null;
  });
  // Người dùng quay lại cửa sổ thì thôi nháy taskbar.
  win.on("focus", () => win?.flashFrame(false));
  // Link trong câu trả lời của model không được thay giao diện app hay mở cửa sổ mới:
  // chặn mọi điều hướng, chỉ http(s) mới ra trình duyệt ngoài.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (isAppNavigation(url, win?.webContents.getURL() ?? "", process.env.ELECTRON_RENDERER_URL)) return;
    e.preventDefault();
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("did-fail-load", code, desc, url);
    void win?.webContents.executeJavaScript(
      `document.body.innerHTML = '<pre style="color:#eee;padding:24px;font:14px sans-serif">Failed to load UI\\n${desc}\\n${url}</pre>'`,
    );
  });
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void win.loadURL(rendererUrl);
  } else {
    void win.loadFile(path.join(here, "../renderer/index.html"));
  }
}

/** Lý do lần gần nhất Engine không chạy được; gắn vào lỗi rpc để UI thấy nguyên nhân thật. */
let engineError = "";

function sendLine(obj: unknown) {
  if (!sock) {
    const why = engineError ? `: ${engineError}` : "";
    const hint = engineWatch ? "fix the error and save so studio:watch rebuilds" : "close the app and run npm run studio again";
    throw new Error(`Engine not connected${why} - ${hint}`);
  }
  sock.write(`${JSON.stringify(obj)}\n`);
}

/** webContents còn sống (cửa sổ chưa đóng/hủy), hoặc null. */
function liveContents() {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return null;
  return win.webContents;
}

/** Gửi sự kiện lên renderer; bỏ qua nếu cửa sổ đã đóng (vd. lúc tắt app). */
function sendToRenderer(payload: unknown) {
  liveContents()?.send("silence-event", payload);
}

/** Báo lỗi Engine lên chat, kể cả khi trang đã tải xong (did-finish-load không bắn lại). */
function reportEngineError(message: string) {
  const send = () => sendToRenderer({ event: { type: "error", message: `Sidecar: ${message}` } });
  const wc = liveContents();
  if (!wc) return;
  if (wc.isLoading()) wc.once("did-finish-load", send);
  else send();
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
        sendToRenderer(msg.params);
        continue;
      }
      if (msg.method === "eval.progress") {
        liveContents()?.send("silence-eval", msg.params);
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

/* `npm run studio:watch` (scripts/studio-watch.mjs) đặt biến này. */
const engineWatch = process.env.SILENCE_ENGINE_WATCH === "1";

/** Watch mode chạy bản copy để cargo vẫn ghi đè được exe gốc (Windows khoá exe đang chạy). */
function liveBin(bin: string): string {
  if (!engineWatch) return bin;
  const ext = path.extname(bin);
  const stem = path.join(path.dirname(bin), `${path.basename(bin, ext)}.live`);
  try {
    copyFileSync(bin, `${stem}${ext}`);
    return `${stem}${ext}`;
  } catch {
    // Bản live cũ còn bị khoá (Engine cũ chưa thoát hẳn, antivirus đang quét): dùng tên khác.
    const alt = `${stem}-${Date.now()}${ext}`;
    copyFileSync(bin, alt);
    return alt;
  }
}

async function startRuntime(): Promise<void> {
  try {
    await spawnRuntime();
    engineError = "";
  } catch (err) {
    engineError = err instanceof Error ? err.message : String(err);
    throw err;
  }
}

async function spawnRuntime(): Promise<void> {
  const bin = runtimeBin();
  if (!existsSync(bin)) {
    throw new Error(`${bin} not found. Run: .\\scripts\\cargo-msvc.bat build -p silence-engine`);
  }
  // Mỗi lần spawn một token mới. Chỉ main giữ nó (không đưa cho renderer); Engine xoá biến này
  // khỏi env của chính nó ngay khi đọc, nên lệnh shell/MCP không thừa hưởng được.
  const token = randomBytes(32).toString("hex");
  const proc = spawn(
    liveBin(bin),
    ["serve", "--tcp", "127.0.0.1:0", "--config", path.join(repoRoot, "config/models.yaml")],
    {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, SILENCE_RPC_TOKEN: token },
    },
  );
  child = proc;
  let ready = "";
  let connected = false;
  await new Promise<void>((resolve, reject) => {
    const fail = (err: Error) => {
      clearTimeout(timer);
      reject(err);
    };
    const timer = setTimeout(() => fail(new Error(`Engine did not report a port within 20s: ${ready.trim()}`)), 20_000);
    proc.on("error", (err) => fail(new Error(`failed to start ${proc.spawnfile}: ${err.message}`)));
    proc.stderr!.on("data", (d: Buffer) => {
      const s = d.toString("utf8");
      process.stderr.write(s);
      if (connected) return;
      ready += s;
      // Chờ đủ cả dòng (có xuống dòng): stderr có thể bị cắt giữa chừng ("tcp=127.0.0.1" chưa tới ":cổng"),
      // khi đó Number(undefined) = NaN → "Port should be >= 0 and < 65536".
      const m = ready.match(/tcp=(\S+):(\d+)\r?\n/);
      if (m) {
        clearTimeout(timer);
        connect(`${m[1]}:${m[2]}`)
          // Engine đóng kết nối nếu request đầu tiên không phải auth.hello đúng token.
          .then(() => rpc("auth.hello", { token }))
          .then(() => {
            connected = true;
            resolve();
          })
          .catch(reject);
      }
    });
    proc.on("exit", (code) => {
      if (!connected) {
        fail(new Error(`Engine exited (code ${code}) before connecting: ${ready.trim().slice(-800)}`));
        return;
      }
      // Engine chết sau khi đã chạy (không phải do stopRuntime): báo lên UI thay vì im lặng.
      if (child !== proc) return;
      child = null;
      sock?.destroy();
      sock = null;
      for (const p of pending.values()) p.reject(new Error(`Engine exited (code ${code})`));
      pending.clear();
      engineError = `Engine exited (code ${code})`;
      console.error(`[engine] exited with code ${code}`);
      reportEngineError(engineError);
    });
  });
  await pushCredentials();
}

function stopRuntime(): Promise<void> {
  for (const p of pending.values()) p.reject(new Error("Engine is restarting"));
  pending.clear();
  sock?.destroy();
  sock = null;
  rpcBuf = "";
  const old = child;
  child = null;
  if (!old || old.exitCode != null) return Promise.resolve();
  return new Promise((resolve) => {
    old.once("exit", () => resolve());
    old.kill();
  });
}

let restarting = false;
let restartAgain = false;

/** Khởi động lại Engine sau khi studio-watch build xong. Renderer tự tạo session mới khi gặp `unknown session`. */
async function restartRuntime(): Promise<void> {
  if (restarting) {
    restartAgain = true;
    return;
  }
  restarting = true;
  try {
    do {
      restartAgain = false;
      // Log ASCII: stdout của Electron qua pipe bị lỗi font tiếng Việt trên console Windows.
      console.log("[studio:watch] engine rebuilt, restarting...");
      await stopRuntime();
      try {
        await startRuntime();
        console.log("[studio:watch] engine restarted.");
      } catch (err) {
        console.error("[studio:watch] engine restart failed:", err);
        reportEngineError(err instanceof Error ? err.message : String(err));
      }
    } while (restartAgain);
  } finally {
    restarting = false;
  }
}

function watchEngineBuild() {
  if (!engineWatch) return;
  const stamp = process.env.SILENCE_ENGINE_STAMP;
  if (!stamp) return;
  watchFile(stamp, { interval: 500 }, (cur, prev) => {
    if (cur.mtimeMs > 0 && cur.mtimeMs !== prev.mtimeMs) void restartRuntime();
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
  credentials = openCredentials();
  // RPC errors travel as `{ error }` values, not rejections: Electron prints a stack trace for every
  // rejected handler, and expected errors (e.g. `unknown session` for a chat restored from the last
  // run) are handled by the renderer. The preload turns `{ error }` back into a thrown Error.
  ipcMain.handle("silence-rpc", async (_e, method: string, params?: unknown) => {
    // Secret-carrying methods go through `silence-credentials-*` only.
    if (MAIN_ONLY_RPC.has(method)) return { error: `${method} is main-process only` };
    try {
      return { result: await rpc(method, params) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
  // Keys: renderer → main → Engine. Never returned to the renderer (only has_key + last4).
  ipcMain.handle("silence-credentials-status", () => credentials?.status() ?? []);
  ipcMain.handle("silence-credentials-set", async (_e, provider: unknown, key: unknown) => {
    if (!credentials || !isKeyedProvider(provider)) throw new Error("Invalid provider");
    const clean = cleanKey(key);
    credentials.set(provider, clean);
    await rpc("providers.set_credential", { provider, key: clean }).catch(() => undefined);
    return credentials.status();
  });
  // Renderer không đáng tin để tự kiểm URL: main kiểm lại trước khi mở.
  ipcMain.handle("silence-open-external", async (_e, url: unknown) => {
    if (typeof url !== "string" || !isSafeExternalUrl(url)) return false;
    await shell.openExternal(url);
    return true;
  });
  // Copy ảnh: ghi clipboard từ main (không phụ thuộc quyền Clipboard API của trang). Chỉ nhận PNG.
  ipcMain.handle("silence-copy-image", (_e, data: unknown) => {
    if (!isPngBytes(data)) return false;
    const img = nativeImage.createFromBuffer(Buffer.from(data));
    if (img.isEmpty()) return false;
    clipboard.writeImage(img);
    return true;
  });
  // Thông báo "cần bạn duyệt" khi cửa sổ không ở phía trước. Chỉ nhận lý do (chuỗi ngắn), không nhận lệnh.
  ipcMain.handle("silence-notify-permission", (_e, reason: unknown, opts: unknown) =>
    notifyAway(permissionNotice(reason), noticeOpts(opts)),
  );
  // "Agent xong": chỉ nhận tên chat.
  ipcMain.handle("silence-notify-done", (_e, title: unknown, opts: unknown) => notifyAway(doneNotice(title), noticeOpts(opts)));
  // Settings → Thông báo → Gửi thử: luôn hiện (kể cả khi cửa sổ đang mở) để biết Windows có chặn không.
  ipcMain.handle("silence-notify-test", (_e, title: unknown, body: unknown) => {
    if (!Notification.isSupported()) return false;
    const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 90) : "");
    new Notification({ title: text(title) || "5ilence", body: text(body) }).show();
    return true;
  });
  // Settings → Dữ liệu → Mở thư mục: main hỏi Engine đường dẫn rồi mở Explorer. Renderer không
  // truyền đường dẫn (openPath với file .exe sẽ chạy nó).
  ipcMain.handle("silence-open-data-dir", async () => {
    const r = (await rpc("engine.data_dir")) as { path?: unknown };
    const dir = typeof r?.path === "string" ? r.path : "";
    if (!dir || !existsSync(dir)) return false;
    return (await shell.openPath(dir)) === "";
  });
  // Giữ máy thức trong lúc agent chạy (Settings → Thông báo). Một blocker duy nhất.
  ipcMain.handle("silence-keep-awake", (_e, on: unknown) => {
    if (on === true && keepAwakeId === null) keepAwakeId = powerSaveBlocker.start("prevent-app-suspension");
    if (on !== true && keepAwakeId !== null) {
      powerSaveBlocker.stop(keepAwakeId);
      keepAwakeId = null;
    }
    return keepAwakeId !== null;
  });
  // Evals page: show an eval result folder. Only paths under <repo>/evals/results.
  ipcMain.handle("silence-reveal-eval", (_e, target: unknown) => {
    if (typeof target !== "string" || !target) return false;
    const base = path.resolve(repoRoot, "evals", "results");
    const full = path.resolve(target);
    const rel = path.relative(base, full);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
    shell.showItemInFolder(full);
    return true;
  });
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
    reportEngineError(err instanceof Error ? err.message : String(err));
  }
  watchEngineBuild();
});

app.on("window-all-closed", () => {
  const stamp = process.env.SILENCE_ENGINE_STAMP;
  if (stamp) unwatchFile(stamp);
  // Tắt chủ động: bỏ `child` trước khi kill để handler `exit` không coi là Engine chết bất thường.
  const old = child;
  child = null;
  sock?.destroy();
  sock = null;
  old?.kill();
  app.quit();
});
