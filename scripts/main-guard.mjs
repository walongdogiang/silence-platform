#!/usr/bin/env node
// Lớp 4 bảo vệ main (docs/adr/0003-pr-watch.md): sau mỗi lần push vào main, kiểm từng commit mới
// có đi qua một PR đã merge với CI xanh không. Không chặn được (repo không có branch protection),
// nhưng không để lọt im lặng: vi phạm → mở issue nhãn `main-guard` + job đỏ.
//
// Chạy trong .github/workflows/main-guard.yml. Chạy tay để thử (không mở issue):
//   DRY_RUN=1 REPO=owner/name BEFORE=<sha> AFTER=<sha> node scripts/main-guard.mjs
// Env: REPO, BEFORE, AFTER, FORCED ("true"), BASE (mặc định main), DRY_RUN, GH_TOKEN (Actions).
import { execFileSync } from "node:child_process";

const env = process.env;
const repo = env.REPO;
const base = env.BASE || "main";
const after = env.AFTER;
const before = env.BEFORE || "";
const forced = env.FORCED === "true";
const dryRun = !!env.DRY_RUN;
if (!repo || !after) {
  console.error("main-guard: thiếu REPO hoặc AFTER");
  process.exit(2);
}

/** `gh api` → JSON. `--paginate` gộp mảng của nhiều trang. */
function api(path, ...args) {
  const out = execFileSync("gh", ["api", "-H", "Accept: application/vnd.github+json", path, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.trim() ? JSON.parse(out) : null;
}

const short = (sha) => sha.slice(0, 7);
const ZERO = /^0+$/;

// Kết luận check coi là đạt. Đang chạy (`status` khác completed) lúc kiểm cũng là không đạt:
// nghĩa là PR được merge trước khi CI xong.
const OK_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

/** Commit mới trên main của lần push này (cũ → mới). */
function pushedCommits() {
  if (!before || ZERO.test(before) || forced) return [{ sha: after, message: "" }];
  const cmp = api(`repos/${repo}/compare/${before}...${after}`);
  return (cmp?.commits ?? []).map((c) => ({ sha: c.sha, message: c.commit.message.split("\n")[0] }));
}

/** PR đã merge vào `base` chứa commit này (squash/merge/rebase đều được GitHub gắn). */
function mergedPr(sha) {
  const prs = api(`repos/${repo}/commits/${sha}/pulls`) ?? [];
  return prs.find((p) => p.merged_at && p.base?.ref === base) ?? null;
}

/**
 * Check/status chưa đạt trên head commit của PR lúc merge. Bỏ qua context của 5ilence (`5ilence/*`)
 * và mọi check bắt đầu SAU lúc merge: đó không phải CI của PR (ví dụ `cache-cleanup` chạy khi PR
 * đóng) và còn đang chạy khi main-guard kiểm, sẽ thành báo động giả.
 */
function isAfterMerge(startedAt, mergedAt) {
  return Boolean(startedAt && mergedAt && Date.parse(startedAt) > Date.parse(mergedAt));
}

function failingChecks(headSha, mergedAt) {
  const bad = [];
  const runs = (api(`repos/${repo}/commits/${headSha}/check-runs?per_page=100`)?.check_runs ?? []).filter((r) => !isAfterMerge(r.started_at, mergedAt));
  for (const r of runs) {
    if (r.status !== "completed") bad.push(`${r.name}: chưa chạy xong (${r.status})`);
    else if (!OK_CONCLUSIONS.has(r.conclusion)) bad.push(`${r.name}: ${r.conclusion}`);
  }
  const statuses = (api(`repos/${repo}/commits/${headSha}/status`)?.statuses ?? []).filter((st) => !isAfterMerge(st.created_at, mergedAt));
  for (const s of statuses) {
    if (s.context.startsWith("5ilence/")) continue;
    if (s.state !== "success") bad.push(`${s.context}: ${s.state}`);
  }
  return { bad, total: runs.length + statuses.length };
}

const violations = [];
if (forced) {
  violations.push({ sha: after, why: `force-push vào \`${base}\` (viết lại lịch sử, trước đó là ${short(before)})` });
}

const checkedPrs = new Map();
for (const c of pushedCommits()) {
  const pr = mergedPr(c.sha);
  if (!pr) {
    violations.push({ sha: c.sha, why: `push thẳng vào \`${base}\`, không qua pull request${c.message ? ` (“${c.message}”)` : ""}` });
    continue;
  }
  if (!checkedPrs.has(pr.number)) checkedPrs.set(pr.number, failingChecks(pr.head.sha, pr.merged_at));
  const { bad, total } = checkedPrs.get(pr.number);
  if (bad.length) {
    violations.push({ sha: c.sha, why: `PR #${pr.number} được merge khi CI chưa xanh: ${bad.join("; ")}` });
  } else {
    console.log(`ok ${short(c.sha)} ← PR #${pr.number} (${total} check đạt)`);
  }
}

if (!violations.length) {
  console.log(`main-guard: ${short(after)} ok`);
  process.exit(0);
}

const lines = violations.map((v) => `- \`${short(v.sha)}\`: ${v.why}`);
console.error(`main-guard: ${violations.length} vi phạm\n${lines.join("\n")}`);
if (dryRun) process.exit(1);

// Một issue cho mỗi lần push (khoá theo AFTER) để chạy lại job không mở trùng.
const title = `main-guard: ${short(after)} vào ${base} không qua PR xanh`;
const open = api(`repos/${repo}/issues?state=open&labels=main-guard&per_page=100`) ?? [];
if (!open.some((i) => i.title === title)) {
  try {
    api(`repos/${repo}/labels`, "-f", "name=main-guard", "-f", "color=B60205", "-f", "description=Thay đổi vào main không qua PR xanh");
  } catch {
    // nhãn đã có
  }
  const body = [
    `Lần push vào \`${base}\` tới \`${after}\` có thay đổi không đi qua pull request đã merge với CI xanh:`,
    "",
    ...lines,
    "",
    `Run: ${env.RUN_URL || "(chạy tay)"}`,
    "",
    "Repo không có branch protection nên GitHub không chặn được việc này; workflow `main-guard` chỉ phát hiện sau khi đã xảy ra (docs/adr/0003-pr-watch.md, lớp 4).",
    "Việc cần làm: xem lại các commit trên, chạy CI cho `main`, revert nếu cần, rồi đóng issue.",
  ].join("\n");
  api(`repos/${repo}/issues`, "-f", `title=${title}`, "-f", `body=${body}`, "-f", "labels[]=main-guard");
}
process.exit(1);
