import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangContext } from "../i18n";
import type { ChatLine } from "../models";
import { ChatPane } from "./ChatPane";

const noop = () => {};

const render = (lines: ChatLine[]) =>
  renderToStaticMarkup(
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
  it("không vẽ lượt chỉ có dòng worked (Worked for — trên chat trống)", () => {
    const html = render([{ kind: "worked", ms: undefined as unknown as number, at: 0 }]);
    expect(html).not.toContain("Worked for");
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
