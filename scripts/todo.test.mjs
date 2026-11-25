// Test cho scripts/todo-brief.mjs và scripts/todo-claims.mjs. Chạy: npm run test:todo
import { test } from "node:test";
import assert from "node:assert/strict";
import { brief, suggestModel, modelFor, modelHint } from "./todo-brief.mjs";
import { emptyBook, touchSession, claim, release, doctor, transcriptTail, isStale, MAX_NOW } from "./todo-claims.mjs";

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
