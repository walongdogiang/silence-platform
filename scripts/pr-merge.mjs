#!/usr/bin/env node
// Cổng merge PR cho agent: chỉ squash merge khi PR đạt chính sách trong .claude/git-policy.json.
// Chạy: node scripts/pr-merge.mjs <số-PR> [--dry-run] [--user-approved] [--session <id>]
//   --session        mã phiên đang merge; ghi vào sự kiện `merged` của sổ chung (ADR 0006) để phiên đó không tự nhận báo.
//   --dry-run        chỉ kiểm tra, không merge.
//   --user-approved  chỉ dùng khi user đã nói rõ trong chat là duyệt merge PR này (bỏ qua giới hạn rủi ro/kích thước,
//                    KHÔNG bỏ qua CI xanh, xung đột, draft, base khác main).
// Exit: 0 = đã merge (hoặc dry-run đạt) · 1 = chưa sẵn sàng/lỗi (CI chưa xanh, xung đột…) · 2 = cần hỏi user (rủi ro cao/diff lớn).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordEvent } from "./todo-claims.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Đánh giá PR theo chính sách. Trả { blockers: string[], needsUser: string[] }.
 * blockers: không merge được dù user duyệt (CI, xung đột…). needsUser: phải hỏi user.
 */
export function evaluate(pr, policy) {
  const blockers = [];
  const needsUser = [];
  if (pr.state !== "OPEN") blockers.push(`PR không ở trạng thái OPEN (${pr.state})`);
  if (pr.isDraft) blockers.push("PR đang là draft");
  if (pr.baseRefName !== "main") blockers.push(`base là ${pr.baseRefName}, không phải main`);
  if (pr.headRefName === "main") blockers.push("nhánh nguồn là main");
  if (pr.mergeable === "CONFLICTING") blockers.push("PR có xung đột merge");

  const ci = (pr.statusCheckRollup ?? []).find((c) => (c.name ?? c.context) === "ci-ok");
  if (!ci) blockers.push("chưa thấy check ci-ok");
  else if ((ci.conclusion ?? ci.state) !== "SUCCESS") blockers.push(`ci-ok chưa xanh (${ci.status ?? ""} ${ci.conclusion ?? ci.state ?? ""})`.trim());

  const files = pr.files ?? [];
  const lines = (pr.additions ?? 0) + (pr.deletions ?? 0);
  if (files.length > policy.maxFilesAutoMerge) needsUser.push(`${files.length} file > ${policy.maxFilesAutoMerge}`);
  if (lines > policy.maxLinesAutoMerge) needsUser.push(`${lines} dòng > ${policy.maxLinesAutoMerge}`);
  for (const f of files) {
    const hit = policy.highRiskPaths.find((p) => f.path.startsWith(p) || f.path.endsWith(`/${p}`) || f.path === p);
    if (hit) needsUser.push(`file rủi ro cao: ${f.path} (khớp ${hit})`);
  }
  return { blockers, needsUser };
}

function gh(args) {
  return execFileSync("gh", args, { cwd: root, encoding: "utf8" });
}

function main() {
  const argv = process.argv.slice(2);
  const num = argv.find((a) => /^\d+$/.test(a));
  const dryRun = argv.includes("--dry-run");
  const userApproved = argv.includes("--user-approved");
  if (!num) {
    console.error("Dùng: node scripts/pr-merge.mjs <số-PR> [--dry-run] [--user-approved]");
    process.exit(1);
  }
  const policy = JSON.parse(readFileSync(path.join(root, ".claude", "git-policy.json"), "utf8"));
  const pr = JSON.parse(
    gh(["pr", "view", num, "--json", "number,state,isDraft,baseRefName,headRefName,mergeable,statusCheckRollup,files,additions,deletions,title"]),
  );
  const { blockers, needsUser } = evaluate(pr, policy);

  console.log(`PR #${pr.number}: ${pr.title}`);
  if (blockers.length) {
    console.error("CHƯA MERGE ĐƯỢC:\n- " + blockers.join("\n- "));
    process.exit(1);
  }
  if (needsUser.length && !userApproved) {
    console.error("CẦN HỎI USER trước khi merge:\n- " + needsUser.join("\n- "));
    process.exit(2);
  }
  if (needsUser.length) console.log("Rủi ro đã được user duyệt:\n- " + needsUser.join("\n- "));
  if (dryRun) {
    console.log("OK (dry-run): đủ điều kiện merge.");
    return;
  }
  gh(["pr", "merge", num, "--squash", "--delete-branch"]);
  console.log("Đã squash merge và xoá nhánh.");
  try {
    const i = argv.indexOf("--session");
    const r = recordEvent(mergedEvent(pr, i >= 0 ? argv[i + 1] : null));
    if (!r.ok) console.error(`Không ghi được sự kiện merged: ${r.msg}`);
  } catch (e) {
    console.error(`Không ghi được sự kiện merged: ${e?.message ?? e}`);
  }
}

/** Sự kiện `merged` cho sổ chung (ADR 0006): mã việc lấy từ tên nhánh, không có thì từ tiêu đề. */
export function mergedEvent(pr, session = null) {
  const task = (pr.headRefName ?? "").match(/T-\d+/)?.[0] ?? (pr.title ?? "").match(/T-\d+/)?.[0];
  return {
    kind: "merged",
    session,
    pr: pr.number,
    task,
    files: (pr.files ?? []).map((f) => f.path),
    text: (pr.title ?? "").slice(0, 200),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
