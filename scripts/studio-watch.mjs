#!/usr/bin/env node
// Live watch for Studio + Engine (`npm run studio:watch`, or `run sw` via scripts/silence.ps1).
// - Renderer/main/preload: electron-vite dev handles HMR/restart just like `npm run studio`.
// - Engine (crates/**, Cargo.*, config/*.yaml): rebuild, then touch a stamp file;
//   the main process (SILENCE_ENGINE_WATCH=1) restarts the Engine when the stamp changes.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, watch, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const stamp = path.join(root, "target", "debug", ".silence-engine-watch-stamp");
const exe = path.join(root, "target", "debug", isWin ? "silence-engine.exe" : "silence-engine");
const tag = "\x1b[36m[studio:watch]\x1b[0m";
const log = (...a) => console.log(tag, ...a);

function buildArgs() {
  return isWin
    ? { cmd: path.join(root, "scripts", "cargo-msvc.bat"), args: ["build", "-p", "silence-engine"] }
    : { cmd: "cargo", args: ["build", "-p", "silence-engine"] };
}

function touchStamp() {
  mkdirSync(path.dirname(stamp), { recursive: true });
  writeFileSync(stamp, String(Date.now()));
}

function buildEngine() {
  return new Promise((resolve) => {
    const { cmd, args } = buildArgs();
    const p = spawn(cmd, args, { cwd: root, stdio: "inherit", shell: isWin });
    p.on("exit", (code) => resolve(code === 0));
    p.on("error", (err) => {
      console.error(tag, err);
      resolve(false);
    });
  });
}

let studio = null;
let stopping = false;

function killTree(p) {
  if (!p || p.exitCode != null) return;
  if (isWin) spawnSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], { stdio: "ignore" });
  else p.kill("SIGTERM");
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const w of watchers) w.close();
  killTree(studio);
  process.exit(code);
}

// --- Engine watching ---------------------------------------------------------
/** Pending job: "build" (Rust code changed) supersedes "restart" (only config changed). */
let need = null;
let running = false;
let timer = null;

async function run() {
  if (running) return; // the running loop will pick up the new `need`
  running = true;
  try {
    while (need && !stopping) {
      const job = need;
      need = null;
      if (job === "restart") {
        log("config changed -> restarting Engine");
        touchStamp();
        continue;
      }
      log("crates changed -> building Engine...");
      const t0 = Date.now();
      if (await buildEngine()) {
        log(`build done (${((Date.now() - t0) / 1000).toFixed(1)}s) -> restarting Engine`);
        touchStamp();
      } else {
        log("\x1b[31mbuild failed\x1b[0m - the old Engine keeps running. Fix the code and save to rebuild.");
      }
    }
  } finally {
    running = false;
  }
}

function schedule(kind) {
  if (need !== "build") need = kind;
  clearTimeout(timer);
  timer = setTimeout(() => void run(), 300);
}

// fs.watch on Windows also fires when a file is only *read* (last-access time changes):
// the Engine reading config/models.yaml at startup used to trigger a bogus restart, which
// dropped in-flight sessions ("unknown session"). Only act when mtime/size really changed.
const startedAt = Date.now();
const seen = new Map();
function reallyChanged(full) {
  let sig;
  try {
    const st = statSync(full);
    if (st.isDirectory()) return false;
    sig = `${st.mtimeMs}:${st.size}`;
    if (!seen.has(full) && st.mtimeMs < startedAt) {
      seen.set(full, sig); // untouched since we started: first event is just an access
      return false;
    }
  } catch {
    sig = "deleted";
  }
  if (seen.get(full) === sig) return false;
  seen.set(full, sig);
  return true;
}

const watchers = [];
function watchPath(target, opts, kind, filter) {
  if (!existsSync(target)) return;
  watchers.push(
    watch(target, opts, (_ev, file) => {
      const name = file ? String(file) : "";
      if (filter(name) && reallyChanged(path.join(target, name))) schedule(kind);
    }),
  );
}

// --- Main --------------------------------------------------------------------
const exeMtime = () => {
  try {
    return statSync(exe).mtimeMs;
  } catch {
    return 0;
  }
};

if (!existsSync(exe)) {
  // No Engine binary yet: Studio cannot start without one, so wait for the first build.
  log("initial Engine build...");
  if (!(await buildEngine())) {
    console.error(tag, "Engine build failed and there is no previous build to run.");
    process.exit(1);
  }
  touchStamp();
} else {
  // Start Studio right away and let cargo check in parallel (saves the ~5-8s no-op build on
  // every launch). Restart the Engine only if cargo actually produced a new binary.
  const before = exeMtime();
  log("checking Engine build in the background...");
  void buildEngine().then((ok) => {
    if (!ok) log("\x1b[31minitial Engine build failed\x1b[0m - running the previous build. Fix the code and save to rebuild.");
    else if (exeMtime() !== before) {
      log("Engine binary updated -> restarting Engine");
      touchStamp();
    } else log("Engine is up to date.");
  });
}

watchPath(path.join(root, "crates"), { recursive: true }, "build", (f) => /\.(rs|toml)$/.test(f));
watchPath(root, {}, "build", (f) => f === "Cargo.toml" || f === "Cargo.lock");
watchPath(path.join(root, "config"), {}, "restart", (f) => /\.ya?ml$/.test(f));

log("starting Studio (electron-vite dev). Edit UI -> HMR; edit crates/ -> Engine rebuilds + restarts. Ctrl+C to stop.");
studio = spawn("npm", ["run", "dev", "--workspace", "@silence/studio"], {
  cwd: root,
  stdio: "inherit",
  shell: isWin,
  env: { ...process.env, SILENCE_ENGINE_WATCH: "1", SILENCE_ENGINE_STAMP: stamp },
});
studio.on("exit", (code) => shutdown(code ?? 0));
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
