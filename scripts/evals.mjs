#!/usr/bin/env node
// Chạy eval thủ công ở máy local — một lệnh cho mọi việc. Hướng dẫn: evals/README.md.
//
//   npm run evals                                  # cả v0 + modes, qua Claude CLI
//   npm run evals -- --suite modes --only M01-ask-no-edit
//   npm run evals -- --source company-gateway --max-cost 0.5
//   npm run evals -- calibrate --only E01-edit-add-pow
//   npm run evals -- report
//   npm run evals -- --help
//
// Option khác (`--model`, `--only`, `--repeat`, `--retry-failed`, `--max-cost`, `--profile`…)
// được chuyển nguyên cho `silence-engine evals`.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SUITES = ["v0", "modes"];

const HELP = `Chạy eval local (mặc định qua Claude CLI đã đăng nhập).

  npm run evals -- [run] [option…]        chạy task
  npm run evals -- calibrate [option…]    ghim model rẻ nhất qua được (chỉ suite v0 mặc định)
  npm run evals -- report                 sinh lại evals/history/SUMMARY.md, không gọi model

Option của script:
  --suite v0|modes|all    bộ task (run: all; calibrate: v0)
  --source <provider>     claude-cli (mặc định) | company-gateway | claude-api
                          (mặc định lấy SILENCE_EVAL_SOURCE nếu có)
  --no-history            không ghi evals/history (mặc định có ghi)

Option khác chuyển cho Engine: --only a,b  --model <id>  --repeat N  --retry-failed
  --max-cost <usd>  --pinned <id>  --profile <tên>  --all (calibrate)
`;

function parse(argv) {
  const out = { cmd: "run", suite: "", history: true, rest: [] };
  const args = [...argv];
  if (["run", "calibrate", "report"].includes(args[0])) out.cmd = args.shift();
  while (args.length) {
    const a = args.shift();
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--suite") out.suite = args.shift() ?? "";
    else if (a.startsWith("--suite=")) out.suite = a.slice(8);
    else if (a === "--no-history") out.history = false;
    else if (a === "--history") out.history = true;
    else out.rest.push(a);
  }
  return out;
}

function suitesFor(cmd, suite) {
  const s = suite || (cmd === "calibrate" ? "v0" : "all");
  if (s === "all") return SUITES;
  if (!SUITES.includes(s)) {
    console.error(`Không có suite "${s}". Chọn: ${[...SUITES, "all"].join(", ")}`);
    process.exit(2);
  }
  return [s];
}

/** Windows: cargo qua cargo-msvc.bat (như build:engine); SILENCE_CARGO để đổi. */
function cargo() {
  if (process.env.SILENCE_CARGO) return process.env.SILENCE_CARGO;
  const bat = join(root, "scripts", "cargo-msvc.bat");
  return process.platform === "win32" && existsSync(bat) ? bat : "cargo";
}

function engine(args) {
  const cmd = cargo();
  const quoted = [cmd, ...args].map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
  // shell: .bat cần cmd.exe trên Windows.
  const r = spawnSync(quoted.join(" "), { cwd: root, stdio: "inherit", shell: true });
  return r.status ?? 1;
}

const opts = parse(process.argv.slice(2));
if (opts.help) {
  process.stdout.write(HELP);
  process.exit(0);
}

const base = ["run", "-q", "-p", "silence-engine", "--"];
if (opts.cmd === "report") process.exit(engine([...base, "evals-report", "--repo-root", "."]));

const sourceIdx = opts.rest.indexOf("--source");
const source =
  (sourceIdx >= 0 ? opts.rest[sourceIdx + 1] : "") || process.env.SILENCE_EVAL_SOURCE || "claude-cli";
const sub = opts.cmd === "calibrate" ? "evals-calibrate" : "evals";
let worst = 0;
for (const suite of suitesFor(opts.cmd, opts.suite)) {
  console.log(`\n== ${sub} · suite ${suite} · source ${source} ==`);
  const code = engine([
    ...base,
    sub,
    "--dir",
    `evals/${suite}`,
    "--repo-root",
    ".",
    ...(opts.history ? ["--history"] : []),
    ...opts.rest,
  ]);
  // Engine: 1 = có FAIL, 2 = ERROR / dừng sớm. FAIL nặng hơn.
  if (code === 1 || (code !== 0 && worst === 0)) worst = code;
}
process.exit(worst);
