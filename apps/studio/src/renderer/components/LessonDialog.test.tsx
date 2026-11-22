import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangContext, translator } from "../i18n";
import type { ChatLine } from "../models";
import { ChatPane } from "./ChatPane";
import { appliedText, LessonDialog, type LessonProposal } from "./LessonDialog";

const noop = () => {};
const en = translator("en");

const proposal: LessonProposal = {
  lesson_id: "l1",
  project: "shop",
  model: "claude-haiku-5-5",
  summary: "Run tests before saying done",
  edits: [
    { file: "profile.md", kind: "profile", before: "# Profile\n- Speak Vietnamese.\n", after: "# Profile\n- Speak Vietnamese.\n- Run tests before saying done.\n", reason: "The user asked for it.", isNew: false },
    { file: "plugin/skills/tests-first/SKILL.md", kind: "skill", before: "", after: "---\nname: tests-first\n---\nRun tests.\n", reason: "Reusable steps.", isNew: true },
  ],
  warnings: ["not allowed: permissions.yaml"],
};

const html = (initial?: Parameters<typeof LessonDialog>[0]["initial"]) =>
  renderToStaticMarkup(
    <LangContext.Provider value="en">
      <LessonDialog workspace="D:/w/shop" user="fix it" answer="done" onClose={noop} initial={initial} />
    </LangContext.Provider>,
  );

describe("LessonDialog", () => {
  it("starts with the lesson box, the model picker and a disabled Propose until there is text", () => {
    const out = html();
    expect(out).toContain("Record a lesson");
    expect(out).toContain("Nothing is written until you apply");
    expect(out).toContain('<option value="haiku" selected="">Haiku</option>');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Propose edits<\/button>/);
  });

  it("reviews each edit as a diff with a checkbox, marks new files and lists dropped edits", () => {
    const out = html({ s: "review", p: proposal, accept: new Set([0, 1]) });
    expect(out).toContain("Run tests before saying done");
    expect(out).toContain("~/.silence/profile.md");
    expect(out).toContain("~/.silence/plugin/skills/tests-first/SKILL.md");
    expect(out).toContain(">new<");
    expect(out).toContain("The user asked for it.");
    expect((out.match(/type="checkbox"/g) ?? []).length).toBe(2);
    expect(out).toContain("Dropped: not allowed: permissions.yaml");
    expect(out).toContain("Apply 2 and commit");
  });

  it("offers Save the lesson only when every edit is unticked", () => {
    expect(html({ s: "review", p: proposal, accept: new Set() })).toContain("Save the lesson only");
  });

  it("reports where the change went", () => {
    expect(appliedText({ written: ["profile.md"], lessonFile: "lessons/a.md", commit: "abc1234", pushed: true }, en)).toBe("Saved 1 file(s), committed abc1234 and pushed to GitHub.");
    expect(appliedText({ written: ["profile.md"], lessonFile: "lessons/a.md", commit: "abc1234", pushed: false, note: "x" }, en)).toContain("push did not work");
    expect(appliedText({ written: [], lessonFile: "lessons/a.md", commit: null, pushed: false }, en)).toBe("Saved 0 file(s); not committed.");
  });
});

describe("Record a lesson button", () => {
  const lines: ChatLine[] = [
    { kind: "user", text: "fix it" },
    { kind: "token", text: "Done." },
    { kind: "worked", ms: 1000, at: 1 },
  ];
  const pane = (onLesson?: () => void) =>
    renderToStaticMarkup(
      <LangContext.Provider value="en">
        <ChatPane lines={lines} plan={null} perm={null} diff={null} sessionId="s" hasSession wsName="demo" onApprovePlan={noop} onRevisePlan={noop} onAllow={noop} onDeny={noop} onApplyDiff={noop} onRejectDiff={noop} onShowDiff={noop} onLesson={onLesson} />
      </LangContext.Provider>,
    );
  it("is in the answer footer only when the core can take lessons", () => {
    expect(pane(noop)).toContain('aria-label="Record a lesson"');
    expect(pane()).not.toContain("Record a lesson");
  });
});
