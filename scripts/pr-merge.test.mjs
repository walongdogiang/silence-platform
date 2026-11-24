// Test cho evaluate() trong scripts/pr-merge.mjs. Chạy: npm run test:pr-merge
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluate } from "./pr-merge.mjs";

const policy = JSON.parse(readFileSync(new URL("../.claude/git-policy.json", import.meta.url), "utf8"));

const okPr = (over = {}) => ({
  state: "OPEN",
  isDraft: false,
  baseRefName: "main",
  headRefName: "feat/t-1-x",
  mergeable: "MERGEABLE",
  statusCheckRollup: [{ name: "ci-ok", status: "COMPLETED", conclusion: "SUCCESS" }],
  files: [{ path: "apps/studio/src/a.ts" }],
  additions: 10,
  deletions: 5,
  ...over,
});

test("PR sạch: không chặn, không cần hỏi", () => {
  assert.deepEqual(evaluate(okPr(), policy), { blockers: [], needsUser: [] });
});

test("blockers: đã merge/đóng, draft, base khác main, nguồn là main, xung đột", () => {
  assert.equal(evaluate(okPr({ state: "MERGED" }), policy).blockers.length, 1);
  assert.equal(evaluate(okPr({ isDraft: true }), policy).blockers.length, 1);
  assert.equal(evaluate(okPr({ baseRefName: "dev" }), policy).blockers.length, 1);
  assert.equal(evaluate(okPr({ headRefName: "main" }), policy).blockers.length, 1);
  assert.equal(evaluate(okPr({ mergeable: "CONFLICTING" }), policy).blockers.length, 1);
});

test("ci-ok: thiếu, đang chạy, đỏ đều chặn; check khác xanh không thay được", () => {
  assert.equal(evaluate(okPr({ statusCheckRollup: [] }), policy).blockers.length, 1);
  assert.equal(evaluate(okPr({ statusCheckRollup: undefined }), policy).blockers.length, 1);
  const pending = [{ name: "ci-ok", status: "IN_PROGRESS", conclusion: "" }];
  assert.equal(evaluate(okPr({ statusCheckRollup: pending }), policy).blockers.length, 1);
  const red = [{ name: "ci-ok", status: "COMPLETED", conclusion: "FAILURE" }];
  assert.equal(evaluate(okPr({ statusCheckRollup: red }), policy).blockers.length, 1);
  const other = [{ name: "engine", status: "COMPLETED", conclusion: "SUCCESS" }];
  assert.equal(evaluate(okPr({ statusCheckRollup: other }), policy).blockers.length, 1);
});

test("ngưỡng file/dòng: đúng ngưỡng thì qua, vượt thì hỏi user", () => {
  const files = (n) => Array.from({ length: n }, (_, i) => ({ path: `apps/studio/src/f${i}.ts` }));
  assert.equal(evaluate(okPr({ files: files(policy.maxFilesAutoMerge) }), policy).needsUser.length, 0);
  assert.equal(evaluate(okPr({ files: files(policy.maxFilesAutoMerge + 1) }), policy).needsUser.length, 1);
  const atLimit = okPr({ additions: policy.maxLinesAutoMerge, deletions: 0 });
  assert.equal(evaluate(atLimit, policy).needsUser.length, 0);
  const over = okPr({ additions: policy.maxLinesAutoMerge, deletions: 1 });
  assert.equal(evaluate(over, policy).needsUser.length, 1);
});

test("đường dẫn rủi ro cao phải hỏi user, kể cả khi diff nhỏ", () => {
  for (const p of [
    "AGENTS.md",
    "CLAUDE.md",
    "docs/security/risk-catalog.md",
    ".github/workflows/ci.yml",
    ".githooks/pre-push",
    ".claude/settings.json",
    ".claude/git-policy.json",
    ".claude/skills/task-git/SKILL.md",
    "scripts/pr-merge.mjs",
    "package-lock.json",
    "Cargo.lock",
    "crates/sandbox/src/lib.rs",
  ]) {
    const r = evaluate(okPr({ files: [{ path: p }] }), policy);
    assert.equal(r.needsUser.length, 1, `${p} phải bị coi là rủi ro cao`);
    assert.deepEqual(r.blockers, []);
  }
});

test("file thường không bị coi là rủi ro (kể cả tên gần giống)", () => {
  for (const p of ["docs/security-notes.md", "crates/runtime/src/lib.rs", "README.md", "apps/studio/AGENTS.mdx"]) {
    assert.equal(evaluate(okPr({ files: [{ path: p }] }), policy).needsUser.length, 0, p);
  }
});

test("lockfile trong thư mục con vẫn bị coi là rủi ro", () => {
  const r = evaluate(okPr({ files: [{ path: "apps/studio/package-lock.json" }] }), policy);
  assert.equal(r.needsUser.length, 1);
});

test("blockers và needsUser độc lập: CI đỏ + file rủi ro báo cả hai", () => {
  const red = [{ name: "ci-ok", status: "COMPLETED", conclusion: "FAILURE" }];
  const r = evaluate(okPr({ statusCheckRollup: red, files: [{ path: "AGENTS.md" }] }), policy);
  assert.equal(r.blockers.length, 1);
  assert.equal(r.needsUser.length, 1);
});
