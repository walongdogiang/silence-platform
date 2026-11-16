#!/usr/bin/env node
// Bật hook trong `.githooks/` (vd. pre-push chặn push thẳng main — docs/adr/0003-pr-watch.md).
// Chạy tự động qua `npm install` (script `prepare`). Không phải repo git thì bỏ qua;
// core.hooksPath đã trỏ chỗ khác thì chỉ cảnh báo, không ghi đè.
import { execFileSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

try {
  git("rev-parse", "--git-dir");
} catch {
  process.exit(0);
}

let current = "";
try {
  current = git("config", "--get", "core.hooksPath");
} catch {
  // chưa đặt
}

if (current === ".githooks") process.exit(0);
if (current) {
  console.warn(`install-hooks: core.hooksPath đang là "${current}", không đổi. Hook .githooks/pre-push (chặn push main) sẽ không chạy.`);
  process.exit(0);
}
git("config", "core.hooksPath", ".githooks");
console.log("install-hooks: đã bật .githooks (pre-push chặn push thẳng main).");
