#!/usr/bin/env node
// Live watch cho Studio + Engine (`npm run studio:watch`, hoặc `run studio watch` qua scripts/silence.ps1).
// - Renderer/main/preload: electron-vite dev lo HMR/restart như `npm run studio`.
// - Engine (crates/**, Cargo.*, config/models.yaml): build lại, rồi chạm file stamp;
//   main process (SILENCE_ENGINE_WATCH=1) thấy stamp đổi thì khởi động lại Engine.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, watch, writeFileSync } from "node:fs";
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

// --- Theo dõi Engine -------------------------------------------------------
/** Việc đang chờ: "build" (code Rust đổi) bao luôn "restart" (chỉ config đổi). */
let need = null;
let running = false;
let timer = null;

async function run() {
  if (running) return; // vòng lặp đang chạy sẽ thấy `need` mới
  running = true;
  try {
    while (need && !stopping) {
      const job = need;
      need = null;
      if (job === "restart") {
        log("config đổi → khởi động lại Engine");
        touchStamp();
        continue;
      }
      log("crates đổi → build Engine…");
      const t0 = Date.now();
      if (await buildEngine()) {
        log(`build xong (${((Date.now() - t0) / 1000).toFixed(1)}s) → khởi động lại Engine`);
        touchStamp();
      } else {
        log("\x1b[31mbuild lỗi\x1b[0m — Engine cũ vẫn chạy. Sửa code, lưu lại để build tiếp.");
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

const watchers = [];
function watchPath(target, opts, kind, filter) {
  if (!existsSync(target)) return;
  watchers.push(
    watch(target, opts, (_ev, file) => {
      if (filter(file ? String(file) : "")) schedule(kind);
    }),
  );
}

// --- Chạy -------------------------------------------------------------------
log("build Engine lần đầu…");
if (!(await buildEngine()) && !existsSync(exe)) {
  console.error(tag, "Build Engine lỗi và chưa có bản build nào để chạy.");
  process.exit(1);
}
touchStamp();

watchPath(path.join(root, "crates"), { recursive: true }, "build", (f) => /\.(rs|toml)$/.test(f));
watchPath(root, {}, "build", (f) => f === "Cargo.toml" || f === "Cargo.lock");
watchPath(path.join(root, "config"), {}, "restart", (f) => /\.ya?ml$/.test(f));

log("chạy Studio (electron-vite dev). Sửa UI → HMR; sửa crates/ → Engine tự build + restart. Ctrl+C để dừng.");
studio = spawn("npm", ["run", "dev", "--workspace", "@silence/studio"], {
  cwd: root,
  stdio: "inherit",
  shell: isWin,
  env: { ...process.env, SILENCE_ENGINE_WATCH: "1", SILENCE_ENGINE_STAMP: stamp },
});
studio.on("exit", (code) => shutdown(code ?? 0));
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
