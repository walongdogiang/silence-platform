import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangContext, translator } from "../i18n";
import type { ChatLine } from "../models";
import { ChatPane } from "./ChatPane";
import { checkTime, VerifyCard, verifyTitle, type VerifyLine } from "./VerifyCard";

const noop = () => {};
const en = translator("en");

const round = (r: number, ok: boolean, final: boolean): VerifyLine => ({
  kind: "verify",
  ok,
  round: r,
  final,
  source: "user",
  changed: 2,
  checks: ok
    ? [{ command: "npm test", ok: true, ms: 1200, output: "" }]
    : [
        { command: "npm test", ok: false, ms: 3400, output: "1 failed: expected 2 got 3" },
        { command: "npm run lint", ok: false, skipped: "declined", ms: 0, output: "" },
      ],
});

const html = (rounds: VerifyLine[]) =>
  renderToStaticMarkup(
    <LangContext.Provider value="en">
      <VerifyCard rounds={rounds} />
    </LangContext.Provider>,
  );

describe("VerifyCard", () => {
  it("titles each state", () => {
    expect(verifyTitle(round(0, true, true), en)).toBe("Checks passed");
    expect(verifyTitle(round(0, false, false), en)).toBe("Checks failed, the agent is fixing it (round 1 of 2)");
    expect(verifyTitle(round(2, false, true), en)).toBe("Checks still fail after 2 fix round(s)");
    expect(verifyTitle(round(1, true, true), en)).toBe("Checks passed after 1 fix round(s)");
  });

  it("lists checks with status and time; failing output is folded; skipped says why", () => {
    const out = html([round(0, false, true)]);
    expect(out).toContain("verify-fail");
    expect(out).toContain("<code>npm test</code>");
    expect(out).toContain("3.4s");
    expect(out).toContain("<details><summary>Output</summary><pre>1 failed: expected 2 got 3</pre></details>");
    expect(out).toContain("not run: you declined it");
    expect(out).toContain("2 changed file(s) · your verify.yaml");
  });

  it("folds earlier rounds under the latest", () => {
    const out = html([round(0, false, false), round(1, true, true)]);
    expect(out).toContain("Checks passed after 1 fix round(s)");
    expect(out).toContain("Earlier rounds (1)");
  });

  it("formats durations", () => {
    expect(checkTime(400)).toBe("0.4s");
    expect(checkTime(12_000)).toBe("12s");
    expect(checkTime(125_000)).toBe("2m 05s");
  });
});

describe("checks in the chat", () => {
  it("shows the card in the turn and starts the fix answer as a new paragraph", () => {
    const lines: ChatLine[] = [
      { kind: "user", text: "fix it" },
      { kind: "token", text: "Done." },
      round(0, false, false),
      { kind: "token", text: "Fixed the test." },
      round(1, true, true),
      { kind: "worked", ms: 1000, at: 1 },
    ];
    const out = renderToStaticMarkup(
      <LangContext.Provider value="en">
        <ChatPane lines={lines} plan={null} perm={null} diff={null} sessionId="s" hasSession wsName="demo" onApprovePlan={noop} onRevisePlan={noop} onAllow={noop} onDeny={noop} onApplyDiff={noop} onRejectDiff={noop} onShowDiff={noop} />
      </LangContext.Provider>,
    );
    expect(out).toContain("Checks passed after 1 fix round(s)");
    expect(out).toMatch(/<p>Done\.<\/p>\s*<p>Fixed the test\.<\/p>/);
  });
});
