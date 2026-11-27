// Test cho scripts/todo-brief.mjs và scripts/todo-claims.mjs. Chạy: npm run test:todo
import { test } from "node:test";
import assert from "node:assert/strict";
import { brief, suggestModel, modelFor, modelHint } from "./todo-brief.mjs";
import { emptyBook, touchSession, claim, release, doctor, transcriptTail, isStale, holdingLine, MAX_NOW } from "./todo-claims.mjs";

const t0 = new Date("2026-11-25T10:00:00Z");
const hours = (h) => new Date(t0.getTime() + h * 36e5);

const task = (fm, body = "") => `---\n${fm}\n---\n\n${body}`;

test("suggestModel: Opus mặc định, Sonnet cho việc nhẹ", () => {
  assert.equal(suggestModel(task("type: feature\nsize: S")), "Opus");
  assert.equal(suggestModel(task("type: docs\nsize: M")), "Sonnet");
  assert.equal(suggestModel(task("type: chore\nsize: L")), "Sonnet");
  assert.equal(suggestModel(task("type: fix\nsize: S")), "Sonnet");
  assert.equal(suggestModel(task("type: fix\nsize: S", "## Câu hỏi mở\n\n- [ ] A hay B?\n")), "Opus");
  assert.equal(suggestModel(task("type: fix\nsize: M")), "Opus");
  assert.equal(suggestModel(""), "Opus");
});

test("field model/model-build ghi đè gợi ý theo type, tách pha suy nghĩ và build", () => {
  assert.equal(suggestModel(task("type: docs\nmodel: opus")), "Opus");
  assert.equal(suggestModel(task("type: feature\nmodel: Sonnet  # nhẹ")), "Sonnet");
  assert.equal(suggestModel(task("type: docs\nmodel: gpt")), "Sonnet");
  const t = task("type: feature\nmodel: opus\nmodel-build: sonnet");
  assert.equal(modelFor(t, "design"), "Opus");
  assert.equal(modelFor(t, "plan"), "Opus");
  assert.equal(modelFor(t, "build"), "Sonnet");
  assert.equal(modelFor(t, "verify"), "Sonnet");
  assert.equal(modelHint(t), "Opus, build Sonnet");
  assert.equal(modelHint(task("type: feature\nmodel-build:")), "Opus");
});

test("claim: mỗi phiên một việc, tối đa MAX_NOW, không lấy việc của phiên khác", () => {
  const b = emptyBook();
  assert.equal(claim(b, "T-001", "s1", { now: t0 }).ok, true);
  assert.equal(claim(b, "T-001", "s1", { now: t0 }).ok, true, "nhận lại việc của mình thì không sao");
  assert.match(claim(b, "T-002", "s1", { now: t0 }).msg, /đang giữ T-001/);
  assert.match(claim(b, "T-001", "s2", { now: t0 }).msg, /todo resume T-001/);
  assert.equal(claim(b, "T-002", "s2", { now: t0 }).ok, true);
  assert.equal(MAX_NOW, 2);
  assert.match(claim(b, "T-003", "s3", { now: t0 }).msg, /Đã có 2 việc/);
  assert.equal(claim(b, "T-003", "", { now: t0 }).ok, false);
  assert.equal(claim(b, "x", "s3", { now: t0 }).ok, false);
});

test("takeover: chuyển việc, giữ started, đánh dấu phiên cũ để cảnh báo", () => {
  const b = emptyBook();
  touchSession(b, { session: "new", transcript: "new.jsonl", cwd: "D:/wt9" }, t0);
  claim(b, "T-001", "old", { now: t0, worktree: "D:/wt", branch: "fix/T-001-x" });
  const r = claim(b, "T-001", "new", { takeover: true, now: hours(5) });
  assert.equal(r.ok, true);
  assert.equal(b.claims["T-001"].session, "new");
  assert.equal(b.claims["T-001"].worktree, "D:/wt", "làm tiếp trên worktree cũ");
  assert.equal(b.claims["T-001"].branch, "fix/T-001-x");
  assert.equal(b.claims["T-001"].started, t0.toISOString());
  assert.equal(b.claims["T-001"].transcript, "new.jsonl");
  assert.deepEqual(b.moved.old, { task: "T-001", to: "new", at: hours(5).toISOString() });
});

test("release: chỉ phiên giữ việc mới trả được (khi có --session)", () => {
  const b = emptyBook();
  claim(b, "T-001", "s1", { now: t0 });
  assert.equal(release(b, "T-001", "s2").ok, false);
  assert.equal(release(b, "T-001", "s1").ok, true);
  assert.equal(b.claims["T-001"], undefined);
});

test("touchSession: cập nhật lastSeen của việc đang giữ, dọn phiên cũ không giữ việc", () => {
  const b = emptyBook();
  touchSession(b, { session: "gone" }, t0);
  touchSession(b, { session: "keep" }, t0);
  claim(b, "T-001", "keep", { now: t0 });
  touchSession(b, { session: "keep" }, hours(24 * 20));
  assert.equal(b.sessions.gone, undefined);
  assert.ok(b.sessions.keep);
  assert.equal(b.claims["T-001"].lastSeen, hours(24 * 20).toISOString());
  assert.equal(isStale(b.claims["T-001"], hours(24 * 20 + 47)), false);
  assert.equal(isStale(b.claims["T-001"], hours(24 * 20 + 49)), true);
});

test("brief: hiện phiên này, ai giữ việc ở Now, gợi ý model cho việc tiếp theo", () => {
  const md = [
    "Mã tiếp theo: T-010",
    "## Now",
    "- T-001 Việc A · [chi tiết](tasks/T-001-a.md)",
    "## Next",
    "- T-002 Việc B · blocked-by: T-001",
    "- T-003 Việc C · [chi tiết](tasks/T-003-c.md)",
  ].join("\n");
  const files = {
    "tasks/T-001-a.md": task("type: feature\nphase: build\npr: 70", "## Tiêu chí xong\n\n- [x] a\n- [ ] b\n"),
    "tasks/T-003-c.md": task("type: docs\nsize: S"),
  };
  const book = emptyBook();
  claim(book, "T-001", "other-session", { now: t0, worktree: "D:/wt" });
  const out = brief(md, (p) => files[p] ?? null, { session: "me", book, now: hours(3) });
  assert.match(out, /Phiên này: me/);
  assert.match(out, /T-001 Việc A \(pha build · tiêu chí 1\/2 · PR #70 · phiên other-se đang giữ, 3 giờ trước · model: Opus\)/);
  assert.match(out, /Sau đó: T-003 Việc C \(model: Sonnet\)/);
  const mine = brief(md, (p) => files[p] ?? null, { session: "other-session", book, now: hours(3) });
  assert.match(mine, /phiên này đang giữ/);
});

test("doctor: bắt lệch giữa mục lục, file task và sổ giữ việc", () => {
  const md = [
    "Mã tiếp theo: T-003",
    "## Now",
    "- T-001 A · [chi tiết](tasks/T-001-a.md)",
    "## Next",
    "- T-004 D · [chi tiết](tasks/T-004-missing.md)",
    "## Later",
    "- T-001 A lặp",
  ].join("\n");
  const files = { "tasks/T-001-a.md": task("status: todo") };
  const book = emptyBook();
  claim(book, "T-009", "s1", { now: t0 });
  const issues = doctor(md, book, (p) => files[p] ?? null, hours(72)).join("\n");
  assert.match(issues, /T-001 nằm ở cả Now và Later/);
  assert.match(issues, /T-004: link tasks\/T-004-missing.md không tồn tại/);
  assert.match(issues, /T-001 ở Now nhưng status: todo/);
  assert.match(issues, /Mã tiếp theo T-003 không lớn hơn/);
  assert.match(issues, /T-009 đang được phiên s1 giữ nhưng không ở Now/);
  assert.match(issues, /T-009: phiên s1 im/);
  assert.match(issues, /T-001 ở Now nhưng không phiên nào giữ/);
});

test("transcriptTail: chỉ lấy chữ của user/agent, bỏ tool và system-reminder", () => {
  const lines = [
    { type: "custom-title" },
    { type: "user", message: { content: "Làm T-001 <system-reminder>bỏ</system-reminder>" } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }, { type: "text", text: "Đã sửa X" }] } },
    { type: "user", message: { content: [{ type: "tool_result", content: "log dài" }] } },
    { type: "user", isCompactSummary: true, message: { content: "tóm tắt" } },
    { type: "assistant", message: { content: [{ type: "text", text: "y".repeat(700) }] } },
  ].map((l) => JSON.stringify(l));
  const tail = transcriptTail([...lines, "không phải json"].join("\n"), 10, 600);
  assert.deepEqual(tail.slice(0, 2), ["USER: Làm T-001", "AGENT: Đã sửa X"]);
  assert.equal(tail.length, 3);
  assert.ok(tail[2].endsWith("…") && tail[2].length < 620);
  assert.equal(transcriptTail(lines.join("\n"), 1).length, 1);
});

// ── Sổ sự kiện chung (T-022, ADR 0006) ──
import { makeEvent, relevantFor, areasOverlap, matchArea, pushLines, PUSH_LIMIT } from "./todo-events.mjs";
import { overlaps, pullEvents } from "./todo-claims.mjs";
import { mergedEvent } from "./pr-merge.mjs";

const ev = (input, at = t0) => {
  const r = makeEvent(input, at);
  assert.ok(r.ok, r.msg);
  return r.event;
};

test("makeEvent: từ chối kind lạ, trường lạ, thiếu trường, mã sai, text dài, đường dẫn tuyệt đối", () => {
  assert.equal(makeEvent({ kind: "progress", session: "s" }).ok, false);
  assert.equal(makeEvent({ kind: "note", session: "s", to: "T-1", text: "x", diff: "…" }).ok, false);
  assert.equal(makeEvent({ kind: "note", session: "s", text: "x" }).ok, false);
  assert.equal(makeEvent({ kind: "claim", session: "s", task: "T1" }).ok, false);
  assert.equal(makeEvent({ kind: "note", session: "s", to: "bob", text: "x" }).ok, false);
  assert.equal(makeEvent({ kind: "note", session: "s", to: "T-1", text: "x".repeat(201) }).ok, false);
  assert.equal(makeEvent({ kind: "contract_changed", session: "s", areas: "D:/x", text: "x" }).ok, false);
  assert.equal(makeEvent({ kind: "merged", session: "s", pr: "abc" }).ok, false);
  const e = ev({ kind: "merged", session: "s", pr: "#77", files: ["a\\b.ts"], task: undefined });
  assert.deepEqual([e.pr, e.files, "task" in e], [77, ["a/b.ts"], false]);
});

test("areasOverlap / matchArea: theo tiền tố tĩnh và glob", () => {
  assert.ok(areasOverlap("packages/protocol/**", "packages/**"));
  assert.ok(areasOverlap(["scripts/todo-claims.mjs"], "scripts/*.mjs"));
  assert.ok(!areasOverlap("apps/studio/**", "crates/**"));
  assert.ok(matchArea("packages/protocol/src/a.ts", ["packages/protocol/**"]));
  assert.ok(matchArea("scripts/x.mjs", ["scripts/*.mjs"]));
  assert.ok(!matchArea("scripts/sub/x.mjs", ["scripts/*.mjs"]));
  assert.ok(matchArea("docs/adr/0006.md", ["docs/adr"]));
  assert.ok(!matchArea("docs/adrx.md", ["docs/adr"]));
});

test("relevantFor: merge đụng vùng → cần rebase; phiên gây ra không tự nhận; note tới đúng việc/master", () => {
  const events = [
    ev({ kind: "merged", session: "B", pr: 5, task: "T-2", files: ["packages/protocol/a.ts"] }, hours(1)),
    ev({ kind: "merged", session: "B", pr: 6, task: "T-2", files: ["apps/x.ts"] }, hours(2)),
    ev({ kind: "note", session: "B", to: "T-1", text: "đổi tên hàm foo" }, hours(3)),
    ev({ kind: "note", session: "B", to: "master", text: "T-2 xong" }, hours(4)),
    ev({ kind: "merged", session: "A", pr: 7, task: "T-1", files: ["packages/protocol/b.ts"] }, hours(5)),
  ];
  const a = relevantFor(events, { session: "A", task: "T-1", areas: ["packages/protocol/**"] }, t0.toISOString());
  assert.deepEqual(a.items.map((i) => i.ev.pr ?? i.ev.text), ["đổi tên hàm foo", 5]);
  assert.match(a.items[1].why, /rebase/);
  assert.equal(a.others, 2); // PR #6 không đụng vùng; note --to master không phải của A
  assert.equal(a.last, hours(5).toISOString());
  const m = relevantFor(events, { session: "M", isMaster: true }, t0.toISOString());
  assert.ok(m.items.some((i) => i.ev.text === "T-2 xong"));
  assert.equal(relevantFor(events, { session: "A", task: "T-1" }, a.last).items.length, 0);
});

test("pullEvents: chỉ báo một lần nhờ con trỏ; touchSession giữ con trỏ; in ≤ PUSH_LIMIT dòng + dòng đếm", () => {
  const book = emptyBook();
  touchSession(book, { session: "A" }, t0);
  claim(book, "T-1", "A", { areas: ["scripts/**"], now: t0 });
  const events = [1, 2, 3, 4, 5].map((h) => ev({ kind: "note", session: "B", to: "all", text: `n${h}` }, hours(h)));
  const first = pullEvents(book, events, "A", hours(6));
  assert.equal(first.length, PUSH_LIMIT + 1);
  assert.match(first.at(-1), /\+2 sự kiện khác/);
  touchSession(book, { session: "A" }, hours(7));
  assert.deepEqual(pullEvents(book, events, "A", hours(7)), []);
  assert.deepEqual(pushLines({ items: [], others: 9 }), []);
});

test("overlaps: claim --areas trùng vùng việc khác → cảnh báo, vẫn nhận", () => {
  const book = emptyBook();
  assert.ok(claim(book, "T-1", "A", { areas: ["packages/protocol/**"], now: t0 }).ok);
  assert.ok(claim(book, "T-2", "B", { areas: "packages/**", now: t0 }).ok);
  assert.equal(overlaps(book, "T-2", book.claims["T-2"].areas).length, 1);
  assert.equal(overlaps(book, "T-2", ["apps/**"]).length, 0);
});

test("mergedEvent: mã việc từ nhánh rồi tiêu đề, files từ PR, hợp schema", () => {
  const e = mergedEvent({ number: 9, headRefName: "feat/T-022-x", title: "feat: y (T-099)", files: [{ path: "scripts/a.mjs" }] }, "S");
  assert.deepEqual([e.task, e.files, e.session], ["T-022", ["scripts/a.mjs"], "S"]);
  assert.equal(mergedEvent({ number: 9, headRefName: "fix/x", title: "fix: y (T-099)" }).task, "T-099");
  assert.ok(makeEvent(mergedEvent({ number: 9, headRefName: "fix/x", title: "fix" })).ok);
});

test("brief: hiện master và sự kiện từ lần trước", () => {
  const book = emptyBook();
  book.master = { session: "M", since: t0.toISOString() };
  const out = brief("## Now\n\n## Next\n", () => null, { session: "A", book, events: ["[todo] gửi bạn: x"], now: t0 });
  assert.match(out, /Master: phiên M/);
  assert.match(out, /Từ lần trước — gửi bạn: x/);
});

// ── Sửa sau review (T-022, phương án a) ──
import { mergeEventsFromCommits, nextTaskId, contractFiles } from "./todo-events.mjs";
import { reserveId } from "./todo-claims.mjs";

test("mergeEventsFromCommits: bắt merge không qua pr-merge, bỏ PR đã ghi, bỏ commit không có (#n)", () => {
  const known = [ev({ kind: "merged", session: "S", pr: 77, files: ["a.ts"] })];
  const commits = [
    { sha: "aaaaaaa", subject: "feat: x (T-021) (#77)", files: ["a.ts"] },
    { sha: "bbbbbbb", subject: "fix: y (#79)", files: ["packages/protocol/p.ts"] },
    { sha: "ccccccc", subject: "chore: push thẳng", files: ["b.ts"] },
    { sha: "ddddddd", subject: "fix: y lại (#79)", files: [] },
  ];
  const out = mergeEventsFromCommits(commits, known, t0);
  assert.deepEqual(out.map((e) => [e.pr, e.sha, e.session]), [[79, "bbbbbbb", null]]);
});

test("relevantFor: merge đụng hợp đồng chung → báo mọi phiên; cùng PR ghi hai lần chỉ báo một lần", () => {
  const events = [
    ev({ kind: "merged", session: "B", pr: 79, files: ["packages/protocol/p.ts"] }, hours(1)),
    ev({ kind: "merged", session: null, pr: 79, sha: "bbbbbbb", files: ["packages/protocol/p.ts"] }, hours(2)),
    ev({ kind: "merged", session: null, pr: 80, files: ["apps/studio/x.tsx"] }, hours(3)),
  ];
  const r = relevantFor(events, { session: "A", task: "T-1", areas: [] }, t0.toISOString());
  assert.equal(r.items.length, 1);
  assert.match(r.items[0].why, /hợp đồng chung đổi \(packages\/protocol\/p\.ts\)/);
  assert.equal(r.others, 1);
  assert.deepEqual(contractFiles(["AGENTS.md", "docs/AGENTS.md", "scripts/x.mjs"]), ["AGENTS.md", "scripts/x.mjs"]);
});

test("nextTaskId / reserveId: không trùng khi README local cũ hơn main, nhánh có mã lớn hơn, hai phiên giữ liên tiếp", () => {
  const stale = "Mã tiếp theo: T-022\n- T-020 a";
  const main = "Mã tiếp theo: T-023\n- T-020 a";
  assert.equal(nextTaskId({ readmeLocal: stale }), "T-022");
  assert.equal(nextTaskId({ readmeLocal: stale, readmeMain: main }), "T-023");
  assert.equal(nextTaskId({ readmeLocal: stale, readmeMain: main, refNames: "origin/feat/T-030-x" }), "T-031");
  const book = emptyBook();
  assert.equal(reserveId(book, "A", { readmeLocal: stale, readmeMain: main }, t0), "T-023");
  assert.equal(reserveId(book, "B", { readmeLocal: stale, readmeMain: main }, t0), "T-024");
  assert.equal(book.reserved["T-024"].session, "B");
});

// ── T-020: chủ worktree theo chat ──
import { guardGit } from "./todo-owner.mjs";

test("tái hiện sự cố 25/11: chat B đổi nhánh rồi chat A commit trong cùng worktree → chặn", () => {
  const book = emptyBook();
  const W = "D:/vuhieu/5ilence-wt2";
  book.sessions.A = { chat: "chatA", lastSeen: t0.toISOString() };
  book.sessions.B = { chat: "chatB", lastSeen: t0.toISOString() };
  book.worktrees = { [W.toLowerCase()]: { chat: "chatA", session: "A", path: W, lastSeen: t0.toISOString(), state: "running" } };
  const b = guardGit(book, { session: "B", targets: [{ op: "switch", wt: W }] }, hours(0.2));
  assert.equal(b.decision, "deny");
  assert.match(b.reason, /chat/);
});

import { chatIdFromTranscript, ensureChat, parseGitCommand, normPath, setOwner, strayWorktrees, worktreesHome } from "./todo-owner.mjs";

test("mã chat: chung tin đầu = một chat; fork = chat mới; transcript hỏng = không biết", () => {
  const tr = '{"type":"custom-title","sessionId":"s1"}\n{"type":"user","uuid":"root-1","sessionId":"s1"}\n{"uuid":"x2"}';
  assert.equal(chatIdFromTranscript(tr), "root-1");
  assert.equal(chatIdFromTranscript('{"uuid":'), null);
  const book = emptyBook();
  const read = () => tr;
  assert.equal(ensureChat(book, { session: "s1", transcript: "a" }, read), "root-1");
  assert.equal(ensureChat(book, { session: "s2", transcript: "b" }, read), "root-1"); // mở lại
  assert.equal(ensureChat(book, { session: "s3", transcript: "c", source: "fork" }, read), "s3");
  assert.equal(ensureChat(book, { session: "s4", transcript: "d" }, () => ""), null);
});

test("parseGitCommand: chỉ lệnh đổi trạng thái; thư mục từ -C, cd, Set-Location, cwd", () => {
  const cwd = "D:\\vuhieu\\5ilence";
  assert.deepEqual(parseGitCommand("git status && git log -3 && git diff", cwd), []);
  assert.deepEqual(parseGitCommand('cd /d/vuhieu/5ilence-worktrees/T-020 && git add a && git commit -F "m.txt"', cwd), [
    { op: "commit", dir: "D:/vuhieu/5ilence-worktrees/T-020" },
  ]);
  assert.deepEqual(parseGitCommand("git -C ../5ilence-wt2 switch fix/x", cwd), [{ op: "switch", dir: "D:/vuhieu/5ilence-wt2" }]);
  assert.deepEqual(parseGitCommand("Set-Location 'D:\\vuhieu\\x'; git push -u origin feat/a", cwd), [{ op: "push", dir: "D:/vuhieu/x" }]);
  assert.deepEqual(parseGitCommand("git -c core.x=1 worktree remove D:/a", cwd), [{ op: "worktree remove", dir: "D:/a" }]);
  assert.deepEqual(parseGitCommand("git worktree list; echo git commit", cwd), []);
  assert.equal(normPath("d:\\A\\b\\"), "D:/A/b");
});

test("guardGit: cùng chat mở lại cho chạy; chủ im ≥ 2 giờ → hỏi; không biết chat → hỏi; lệnh không đụng worktree có chủ → cho chạy", () => {
  const W = "D:/w/T-1";
  const mk = () => {
    const b = emptyBook();
    b.sessions = { A: { chat: "c1" }, A2: { chat: "c1" }, B: { chat: "c2" }, U: {} };
    b.worktrees = { [W.toLowerCase()]: { path: W, chat: "c1", session: "A", lastSeen: t0.toISOString() } };
    return b;
  };
  const t = [{ op: "commit", wt: W }];
  assert.equal(guardGit(mk(), { session: "A2", targets: t }, hours(1)).decision, "allow");
  assert.equal(guardGit(mk(), { session: "B", targets: t }, hours(1.9)).decision, "deny");
  assert.equal(guardGit(mk(), { session: "B", targets: t }, hours(2.1)).decision, "ask");
  assert.equal(guardGit(mk(), { session: "U", targets: t }, hours(1)).decision, "ask");
  assert.equal(guardGit(mk(), { session: "B", targets: [{ op: "commit", wt: "D:/w/other" }, { op: "push", wt: null }] }, hours(1)).decision, "allow");
});

test("setOwner: không cướp chủ khi chưa được phép; chuyển chủ thì báo chat cũ và chuyển việc đang giữ", () => {
  const book = emptyBook();
  book.sessions = { A: { chat: "c1" }, B: { chat: "c2" } };
  book.claims["T-1"] = { session: "A", worktree: "D:\\w\\T-1", lastSeen: t0.toISOString() };
  assert.ok(setOwner(book, { session: "A", wt: "D:/w/T-1", branch: "feat/T-1" }, t0).took);
  assert.equal(setOwner(book, { session: "B", wt: "d:/W/t-1" }, hours(1)).took, false);
  const r = setOwner(book, { session: "B", wt: "D:/w/T-1", transfer: true }, hours(3));
  assert.equal(r.from.session, "A");
  assert.equal(book.worktrees["d:/w/t-1"].chat, "c2");
  assert.equal(book.worktrees["d:/w/t-1"].branch, "feat/T-1");
  assert.equal(book.moved.A.to, "B");
  assert.equal(book.claims["T-1"].session, "B");
});

test("strayWorktrees + worktreesHome: thư mục không còn là worktree, chủ im lâu không giữ việc", () => {
  assert.equal(worktreesHome("D:/vuhieu/5ilence"), "D:/vuhieu/5ilence-worktrees");
  const book = emptyBook();
  book.worktrees = {
    "d:/h/t-1": { path: "D:/h/T-1", chat: "c1", lastSeen: t0.toISOString() },
    "d:/h/t-2": { path: "D:/h/T-2", chat: "c2", lastSeen: t0.toISOString() },
  };
  book.claims["T-2"] = { session: "x", worktree: "D:\\h\\T-2" };
  const out = strayWorktrees({ dirs: ["D:/h/T-1", "D:/h/T-2", "D:/h/old"], listed: ["D:/h/T-1", "D:/h/T-2"], book, now: hours(3) });
  assert.deepEqual(out.map((o) => o.path), ["D:/h/old", "D:/h/T-1"]);
});

test("claim: cùng chat mở lại nhận lại việc không cần takeover; takeover từ chat khác còn hoạt động bị từ chối trừ --force", () => {
  const book = emptyBook();
  book.sessions = { A: { chat: "c1" }, A2: { chat: "c1" }, B: { chat: "c2" } };
  assert.ok(claim(book, "T-1", "A", { now: t0 }).ok);
  const r = claim(book, "T-1", "A2", { now: hours(0.1) });
  assert.ok(r.ok);
  assert.match(r.msg, /cùng chat/);
  assert.equal(book.claims["T-1"].session, "A2");
  assert.equal(book.moved.A, undefined);
  assert.equal(claim(book, "T-1", "B", { takeover: true, now: hours(1) }).ok, false);
  assert.ok(claim(book, "T-1", "B", { takeover: true, force: true, now: hours(1) }).ok);
  assert.equal(book.moved.A2.to, "B");
  const b2 = emptyBook();
  b2.sessions = { A: { chat: "c1" }, B: { chat: "c2" } };
  claim(b2, "T-1", "A", { now: t0 });
  assert.ok(claim(b2, "T-1", "B", { takeover: true, now: hours(3) }).ok);
});

import { handle, gitTargets } from "./todo-hook.mjs";

test("hook: pre trả deny/ask đúng khuôn docs; post ghi chủ; sửa file không cướp chủ; stop = chờ user", () => {
  const deps = {
    mainRootOf: () => "D:/r/main",
    toplevelOf: (d) => (String(d).replaceAll("\\", "/").startsWith("D:/r/wt/T-1") ? "D:/r/wt/T-1" : String(d).startsWith("D:/r/main") ? "D:/r/main" : null),
    branchOf: () => "feat/T-1",
  };
  const book = emptyBook();
  const tr = { A: '{"uuid":"c1"}', B: '{"uuid":"c2"}' };
  const inp = (s, extra) => ({ session_id: s, transcript_path: s, cwd: "D:/r/main", ...extra });
  book.sessions = { A: { chat: "c1" }, B: { chat: "c2" } };
  // A commit trong worktree → thành chủ
  handle("post", inp("A", { tool_name: "Bash", tool_input: { command: "cd D:/r/wt/T-1 && git commit -m x" } }), book, deps, t0);
  assert.equal(book.worktrees["d:/r/wt/t-1"].chat, "c1");
  // B định switch trong đó → deny, khuôn hookSpecificOutput
  const pre = handle("pre", inp("B", { tool_name: "Bash", tool_input: { command: "git -C D:/r/wt/T-1 switch main" } }), book, deps, hours(0.5));
  assert.deepEqual(Object.keys(pre.output.hookSpecificOutput).sort(), ["hookEventName", "permissionDecision", "permissionDecisionReason"]);
  assert.equal(pre.output.hookSpecificOutput.permissionDecision, "deny");
  // lệnh git trong thư mục chính / lệnh đọc → không ra gì
  assert.equal(handle("pre", inp("B", { tool_name: "Bash", tool_input: { command: "git commit -m y" } }), book, deps, hours(0.5)).output, undefined);
  assert.equal(handle("pre", inp("B", { tool_name: "Bash", tool_input: { command: "git -C D:/r/wt/T-1 log" } }), book, deps, hours(0.5)).output, undefined);
  // B sửa file trong worktree của A → không cướp chủ
  handle("post", inp("B", { tool_name: "Edit", tool_input: { file_path: "D:\r\wt\T-1\a.ts" } }), book, deps, hours(0.6));
  assert.equal(book.worktrees["d:/r/wt/t-1"].chat, "c1");
  // A trả lời xong → chờ user
  handle("stop", inp("A", {}), book, deps, hours(0.7));
  assert.equal(book.worktrees["d:/r/wt/t-1"].state, "waiting");
  // 3 giờ sau B được user cho phép (ask) → post chuyển chủ
  assert.equal(handle("pre", inp("B", { tool_name: "Bash", tool_input: { command: "git -C D:/r/wt/T-1 switch main" } }), book, deps, hours(4)).output.hookSpecificOutput.permissionDecision, "ask");
  handle("post", inp("B", { tool_name: "Bash", tool_input: { command: "git -C D:/r/wt/T-1 switch main" } }), book, deps, hours(4));
  assert.equal(book.worktrees["d:/r/wt/t-1"].chat, "c2");
  assert.equal(book.moved.A.to, "B");
  assert.deepEqual(gitTargets("git worktree remove D:/r/wt/T-1", "D:/r/main", deps), [{ op: "worktree remove", wt: "D:/r/wt/T-1" }]);
  void tr;
  // Chủ ghi qua Write (không qua lệnh git) vẫn có nhánh
  const b3 = emptyBook();
  b3.sessions = { C: { chat: "c3" } };
  handle("post", inp("C", { tool_name: "Write", tool_input: { file_path: "D:/r/wt/T-1/b.txt" } }), b3, deps, t0);
  assert.equal(b3.worktrees["d:/r/wt/t-1"].chat, "c3");
  assert.equal(b3.worktrees["d:/r/wt/t-1"].branch, "feat/T-1");
});

test("hook: JSON hỏng / thiếu session → exit 0, không in gì", async () => {
  const { spawnSync } = await import("node:child_process");
  for (const stdin of ["{hỏng", "", '{"tool_name":"Bash"}']) {
    const r = spawnSync(process.execPath, ["scripts/todo-hook.mjs", "pre"], { input: stdin, encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  }
});

import { strayLine } from "./todo-brief.mjs";

test("strayLine: một dòng hỏi user, không có thì im", () => {
  assert.equal(strayLine([]), null);
  assert.match(strayLine([{ path: "D:/h/old", why: "không còn là worktree" }]), /old \(không còn là worktree\).*không tự xoá/);
});

test("holdingLine: nhắc việc phiên đang giữ kèm tên từ mục lục; không giữ việc thì null", () => {
  const book = emptyBook();
  assert.equal(holdingLine(book, "s1", ""), null);
  assert.ok(claim(book, "T-072", "s1", { now: t0 }).ok);
  const readme = "## Next\n\n- T-072 Dòng trạng thái cuối lượt · [chi tiết](tasks/T-072.md) · blocked-by: T-071\n";
  assert.equal(holdingLine(book, "s1", readme), "[todo] Phiên này đang giữ T-072: Dòng trạng thái cuối lượt. Cuối lượt: dòng 🏁/⏳/⛔ (CLAUDE.md → Kết thúc lượt).");
  assert.match(holdingLine(book, "s1", ""), /^\[todo\] Phiên này đang giữ T-072\. /);
  assert.equal(holdingLine(book, "s2", readme), null);
});
