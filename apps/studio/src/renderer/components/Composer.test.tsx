import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangContext } from "../i18n";
import { Composer } from "./Composer";

const base = {
  prompt: "",
  onPrompt: () => {},
  onSend: () => {},
  onChip: () => {},
  mode: "agent" as const,
  model: "auto",
  models: [],
  onModel: () => {},
  disabled: false,
};

// Asserts Vietnamese labels, so it renders in "vi" explicitly (the default is English).
const html = (over: { busy: boolean; prompt?: string; onStop?: () => void }) =>
  renderToStaticMarkup(
    <LangContext.Provider value="vi">
      <Composer {...base} {...over} />
    </LangContext.Provider>,
  );

describe("Composer Stop", () => {
  it("đang chạy + có onStop: hiện nút Dừng, không hiện nút gửi", () => {
    const out = html({ busy: true, onStop: () => {} });
    expect(out).toContain('aria-label="Dừng"');
    expect(out).not.toContain('title="Enter"');
  });

  it("đang chạy dù đã gõ chữ: vẫn là nút Dừng", () => {
    const out = html({ busy: true, prompt: "tiếp", onStop: () => {} });
    expect(out).toContain('aria-label="Dừng"');
    expect(out).not.toContain('title="Enter"');
  });

  it("không chạy: không có nút Dừng", () => {
    const out = html({ busy: false, prompt: "xin chào", onStop: () => {} });
    expect(out).not.toContain('aria-label="Dừng"');
    expect(out).toContain('title="Enter"');
  });
});
