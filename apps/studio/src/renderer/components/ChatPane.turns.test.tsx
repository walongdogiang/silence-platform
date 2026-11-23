import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangContext } from "../i18n";
import type { ChatLine, Perm } from "../models";
import { ChatPane } from "./ChatPane";

const noop = () => {};

const render = (lines: ChatLine[], perm: Perm | null = null) =>
  renderToStaticMarkup(
    <LangContext.Provider value="en">
      <ChatPane
        lines={lines}
        plan={null}
        perm={perm}
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

describe("ChatPane turns", () => {
  it("docks the permission card outside the scrolling log, right above the composer", () => {
    const perm: Perm = {
      session_id: "s",
      request_id: "r",
      name: "Bash",
      reason: "",
      input: { command: "npm test" },
      risk: { tier: "auto", reasons: [], level: "safe", codes: ["BUILD_TEST"] },
    };
    const html = render([{ kind: "user", text: "hi" }], perm);
    const dock = html.indexOf('<div class="perm-dock">');
    expect(dock).toBeGreaterThan(-1);
    // The dock comes after the whole scroll area (rail included), not inside its viewport.
    expect(dock).toBeGreaterThan(html.lastIndexOf("soft-scroll-rail"));
    expect(html.slice(html.indexOf("soft-scroll-viewport"), dock)).not.toContain("perm-card");
  });

  it("không vẽ lượt chỉ có dòng worked (Worked for — trên chat trống)", () => {
    const html = render([{ kind: "worked", ms: undefined as unknown as number, at: 0 }]);
    expect(html).not.toContain("Worked for");
  });

  it("tin user cũ không có `at`: giờ gửi suy ra từ worked.at − worked.ms; câu trả lời có giờ riêng", () => {
    const done = Date.now() - 60 * 60_000;
    const html = render([
      { kind: "user", text: "draw a dog" },
      { kind: "token", text: "ok" },
      { kind: "worked", ms: 28 * 60_000, at: done },
    ]);
    const user = html.split('class="msg-user"')[1].split("msg-agent-meta")[0];
    expect(user).toContain("<time");
    expect(user).toContain(`dateTime="${new Date(done - 28 * 60_000).toISOString()}"`);
    expect(html.split('class="msg-ai-foot"')[1]).toContain(`dateTime="${new Date(done).toISOString()}"`);
  });

  it("lượt đã ghim: nút ghim bật, có mục lục chương với Session start + tên chương", () => {
    const lines: ChatLine[] = [
      { kind: "user", text: "first" },
      { kind: "token", text: "a" },
      { kind: "worked", ms: 1000, at: Date.now() },
      { kind: "user", text: "icon fork", chapter: "Icon fork" },
      { kind: "token", text: "b" },
      { kind: "worked", ms: 1000, at: Date.now() },
    ];
    const html = renderToStaticMarkup(
      <LangContext.Provider value="en">
        <ChatPane
          lines={lines}
          plan={null}
          perm={null}
          diff={null}
          sessionId="s"
          hasSession
          wsName="demo"
          onApprovePlan={noop}
          onAllow={noop}
          onDeny={noop}
          onApplyDiff={noop}
          onRejectDiff={noop}
          onShowDiff={noop}
          onPinChapter={noop}
        />
      </LangContext.Provider>,
    );
    expect(html).toContain('aria-label="Chapters"');
    expect(html).toContain("Session start");
    expect(html).toContain('aria-label="Unpin chapter" aria-pressed="true"');
    expect(html).toContain('aria-label="Pin as chapter" aria-pressed="false"');
    expect(html).toContain('data-turn="1"');
  });

  it("lỗi chưa phân loại: hiện lý do thật và nút thử lại", () => {
    const html = render([
      { kind: "user", text: "draw a cat" },
      { kind: "error", message: "Error: model not found: haiku-x" },
    ]);
    expect(html).toContain("draw a cat");
    expect(html).toContain("model not found: haiku-x");
    expect(html).toContain("Retry</button>");
  });
});
