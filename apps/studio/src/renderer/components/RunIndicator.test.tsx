import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangContext } from "../i18n";
import type { ChatLine } from "../models";
import { startRun } from "../runStatus";
import { ChatPane } from "./ChatPane";
import { RunIndicator } from "./RunIndicator";

const noop = () => {};

const render = (lines: ChatLine[], extra: { awaiting?: boolean; stopping?: boolean } = {}) => {
  const run = { ...startRun(Date.now() - 20_000), stopping: Boolean(extra.stopping) };
  return renderToStaticMarkup(
    <LangContext.Provider value="en">
      <ChatPane
        lines={lines}
        plan={null}
        perm={extra.awaiting ? { session_id: "s", request_id: "r", name: "bash", input: {}, reason: "" } : null}
        diff={null}
        sessionId="s"
        hasSession
        wsName="demo"
        busy
        run={run}
        onApprovePlan={noop}
        onRevisePlan={noop}
        onAllow={noop}
        onDeny={noop}
        onApplyDiff={noop}
        onRejectDiff={noop}
        onShowDiff={noop}
        onRestoreCheckpoint={noop}
        onForkChat={noop}
        onRetry={noop}
      />
    </LangContext.Provider>,
  );
};

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe("RunIndicator", () => {
  it("working / stopping vẽ sao; chờ duyệt là chấm copper đứng yên; luôn aria-hidden", () => {
    const working = renderToStaticMarkup(<RunIndicator />);
    expect(working).toContain("run-ind-star");
    expect(working).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<RunIndicator phase="stopping" />)).toContain("run-ind md stopping");
    const waiting = renderToStaticMarkup(<RunIndicator phase="awaiting_permission" />);
    expect(waiting).toContain("run-ind-dot");
    expect(waiting).not.toContain("run-ind-star");
  });

  it("lượt đang chạy: sao ở tiêu đề và ở bước cuối; chỉ bước cuối có shimmer; bước xong không icon", () => {
    const html = render([
      { kind: "user", text: "fix it" },
      { kind: "narrate", verb: "Read", detail: "a.ts" },
      { kind: "narrate", verb: "Searching", detail: "verify.yaml", at: Date.now() - 18_000 },
    ]);
    expect(count(html, /run-ind md working/g)).toBe(2);
    expect(count(html, /run-shimmer/g)).toBe(1);
    expect(html).toMatch(/msg-step-body run-shimmer"><span class="msg-step-verb">Searching/);
    expect(html).toContain('<span class="msg-step-time">18s</span>');
  });

  it("mới gửi, chỉ có Planning: Planning là bước đang chạy (sao + shimmer), không còn dòng chữ tĩnh", () => {
    const html = render([
      { kind: "user", text: "fix it" },
      { kind: "narrate", verb: "Planning next moves" },
    ]);
    expect(html).not.toContain("msg-status-brief");
    expect(html).not.toContain("msg-explored");
    expect(html).toMatch(/<li class="msg-step active"><span class="run-ind md working"/);
    expect(html).toMatch(/msg-step-body run-shimmer"><span class="msg-step-verb">Planning next moves/);
  });

  it("có bước thật thì Planning biến mất, không đứng lại trong danh sách", () => {
    const html = render([
      { kind: "user", text: "fix it" },
      { kind: "narrate", verb: "Planning next moves" },
      { kind: "narrate", verb: "Read", detail: "a.ts" },
      { kind: "narrate", verb: "Reading", detail: "b.ts" },
    ]);
    expect(html).not.toContain("Planning next moves");
    expect(count(html, /msg-step active/g)).toBe(1);
    expect(html).toMatch(/msg-step-verb">Reading/);
  });

  it("đang Thinking: không bước nào đang chạy; sao nằm ở nhãn Thinking", () => {
    const html = render([
      { kind: "user", text: "fix it" },
      { kind: "narrate", verb: "Read", detail: "a.ts" },
      { kind: "narrate", verb: "Thinking" },
    ]);
    expect(html).not.toContain("msg-step active");
    expect(html).toMatch(/msg-thought-label active"><span class="run-ind md working"/);
  });

  it("bước mới chạy dưới 3s không hiện thời gian", () => {
    const html = render([
      { kind: "user", text: "fix it" },
      { kind: "narrate", verb: "Reading", detail: "a.ts", at: Date.now() - 1_000 },
    ]);
    expect(html).not.toContain("msg-step-time");
  });

  it("chờ duyệt: chấm copper đứng yên, không shimmer (không phải lúc tự chạy)", () => {
    const html = render(
      [
        { kind: "user", text: "fix it" },
        { kind: "narrate", verb: "Running", detail: "npm test" },
      ],
      { awaiting: true },
    );
    expect(html).toContain("run-ind md awaiting_permission");
    expect(html).not.toContain("run-ind-star");
    expect(html).not.toContain("run-shimmer");
  });

  it("đang dừng: sao chậm, không shimmer", () => {
    const html = render(
      [
        { kind: "user", text: "fix it" },
        { kind: "narrate", verb: "Running", detail: "npm test" },
      ],
      { stopping: true },
    );
    expect(html).toContain("run-ind md stopping");
    expect(html).not.toContain("run-shimmer");
  });

  it("lượt đã xong không còn icon chạy", () => {
    const html = renderToStaticMarkup(
      <LangContext.Provider value="en">
        <ChatPane
          lines={[
            { kind: "user", text: "fix it" },
            { kind: "narrate", verb: "Read", detail: "a.ts" },
            { kind: "token", text: "done" },
            { kind: "worked", ms: 5000, at: Date.now() },
          ]}
          plan={null}
          perm={null}
          diff={null}
          sessionId="s"
          hasSession
          wsName="demo"
          onApprovePlan={noop}
          onRevisePlan={noop}
          onAllow={noop}
          onDeny={noop}
          onApplyDiff={noop}
          onRejectDiff={noop}
          onShowDiff={noop}
          onRestoreCheckpoint={noop}
          onForkChat={noop}
          onRetry={noop}
        />
      </LangContext.Provider>,
    );
    expect(html).not.toContain("run-ind");
  });
});
