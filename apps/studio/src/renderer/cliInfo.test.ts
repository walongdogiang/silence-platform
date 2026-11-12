import { describe, expect, it } from "vitest";
import { authLabel, expiryNote, fmtUsd, isSubscriptionLogin, planLabel, shortEmail } from "./cliInfo";

describe("cli info display", () => {
  it("labels plan and auth method", () => {
    expect(planLabel("max")).toBe("Max");
    expect(planLabel("")).toBe("—");
    expect(planLabel("custom")).toBe("Custom");
    expect(authLabel("claude.ai", "firstParty")).toBe("Claude account");
    expect(authLabel("api_key", "bedrock")).toBe("API key (Amazon Bedrock)");
    expect(isSubscriptionLogin("claude.ai")).toBe(true);
    expect(isSubscriptionLogin("api_key")).toBe(false);
  });

  it("warns when the login expires within a week", () => {
    const now = new Date("2026-11-11T12:00:00Z");
    expect(expiryNote("2026-12-06T22:45:56Z", now)?.warn).toBe(false);
    expect(expiryNote("2026-11-14T12:00:00Z", now)?.warn).toBe(true);
    expect(expiryNote("2026-11-01T00:00:00Z", now)?.text).toMatch(/^Expired/);
    expect(expiryNote("", now)).toBeNull();
    expect(expiryNote("garbage", now)).toBeNull();
  });

  it("shortens emails and formats cost", () => {
    expect(shortEmail("alexander.long@x.com")).toBe("alexand…@x.com");
    expect(shortEmail("bo@x.com")).toBe("bo@x.com");
    expect(fmtUsd(0)).toBe("$0");
    expect(fmtUsd(0.004)).toBe("<$0.01");
    expect(fmtUsd(1.234)).toBe("$1.23");
  });
});
