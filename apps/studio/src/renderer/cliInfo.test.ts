import { describe, expect, it } from "vitest";
import { authLabel, expiryNote, fmtUsd, isSubscriptionLogin, planLabel, shortEmail } from "./cliInfo";
import { translator } from "./i18n";

const vi = translator("vi");
const en = translator("en");

describe("cli info display", () => {
  it("labels plan and auth method", () => {
    expect(planLabel("max")).toBe("Max");
    expect(planLabel("")).toBe("—");
    expect(planLabel("custom")).toBe("Custom");
    expect(authLabel("claude.ai", "firstParty", en)).toBe("Claude account");
    expect(authLabel("api_key", "bedrock", en)).toBe("API key (Amazon Bedrock)");
    expect(authLabel("claude.ai", "firstParty", vi)).toBe("Tài khoản Claude");
    expect(isSubscriptionLogin("claude.ai")).toBe(true);
    expect(isSubscriptionLogin("api_key")).toBe(false);
  });

  it("warns when the login expires within a week", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    expect(expiryNote("2026-12-06T22:45:56Z", en, now)?.warn).toBe(false);
    expect(expiryNote("2026-11-14T12:00:00Z", en, now)?.warn).toBe(true);
    expect(expiryNote("2026-11-01T00:00:00Z", en, now)?.text).toMatch(/^Expired/);
    expect(expiryNote("2026-11-01T00:00:00Z", vi, now)?.text).toMatch(/^Đã hết hạn/);
    expect(expiryNote("", en, now)).toBeNull();
    expect(expiryNote("garbage", en, now)).toBeNull();
  });

  it("shortens emails and formats cost", () => {
    expect(shortEmail("alexander.long@x.com")).toBe("alexand…@x.com");
    expect(shortEmail("bo@x.com")).toBe("bo@x.com");
    expect(fmtUsd(0)).toBe("$0");
    expect(fmtUsd(0.004)).toBe("<$0.01");
    expect(fmtUsd(1.234)).toBe("$1.23");
  });
});
