import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ MessageChannelMain: class {}, utilityProcess: { fork: vi.fn() } }));

const { coreEnabled, coreEntry } = await import("./core");

describe("core switch", () => {
  it("is on only for SILENCE_CORE=1", () => {
    expect(coreEnabled({ SILENCE_CORE: "1" })).toBe(true);
    expect(coreEnabled({ SILENCE_CORE: "0" })).toBe(false);
    expect(coreEnabled({})).toBe(false);
  });

  it("resolves the built utility entry of @silence/core", () => {
    expect(coreEntry().replace(/\\/g, "/")).toMatch(/packages\/core\/dist\/host\/utility\.js$/);
  });
});
