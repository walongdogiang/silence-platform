import { describe, expect, it } from "vitest";
import type { Perm } from "./models";
import { blockedStep, normalizePermMode, rememberPattern, scopeLabels, tierBadge } from "./permissionUi";
import { translator } from "./i18n";

const vi = translator("vi");
const en = translator("en");

const shell = (pattern?: string): Perm => ({
  request_id: "r",
  name: "shell",
  input: { command: "npm install zod" },
  reason: "Cài package",
  risk: { tier: "ask", reasons: [{ code: "PKG_INSTALL", title: "Cài package", detail: "…" }], pattern },
});

describe("permission card helpers", () => {
  it("badges follow the tier", () => {
    expect(tierBadge("ask", vi)).toEqual({ label: "Cần duyệt", cls: "ask" });
    expect(tierBadge("block", vi).cls).toBe("block");
    expect(tierBadge(undefined, vi).cls).toBe("ask");
  });

  it("offers session/workspace scopes only when the Engine sends a pattern", () => {
    const l = scopeLabels(shell("npm install *"), vi);
    expect(l?.session).toBe('Cho phép "npm install *" trong phiên này');
    expect(l?.workspace).toBe('Luôn cho phép "npm install *" trong workspace');
    expect(scopeLabels(shell("npm install *"), en)?.session).toBe('Allow "npm install *" for this session');
    expect(scopeLabels(shell(undefined), vi)).toBeNull();
    expect(scopeLabels(null, vi)).toBeNull();
    expect(rememberPattern(shell("npm install *"))).toBe("npm install *");
  });

  it("edit patterns are shown without shell quotes", () => {
    const p: Perm = { ...shell("src/**"), name: "edit" };
    expect(scopeLabels(p, vi)?.session).toBe("Cho phép src/** trong phiên này");
  });

  it("only ask or balanced can be chosen; anything else falls back to balanced", () => {
    expect(normalizePermMode("ask")).toBe("ask");
    expect(normalizePermMode("balanced")).toBe("balanced");
    expect(normalizePermMode("yolo")).toBe("balanced");
    expect(normalizePermMode(null)).toBe("balanced");
  });

  it("builds a Blocked step from the policy.blocked trace", () => {
    expect(blockedStep({ code: "NET_DOWNLOAD_EXEC", title: "Tải về rồi chạy ngay" })).toEqual({
      verb: "Blocked",
      detail: "Tải về rồi chạy ngay",
    });
    expect(blockedStep({ code: "X" })?.detail).toBe("X");
    expect(blockedStep({})).toBeNull();
    expect(blockedStep(null)).toBeNull();
  });
});
