import { describe, expect, it } from "vitest";
import type { Perm } from "./models";
import {
  autonomousFallbackNote,
  blockedStep,
  hostsText,
  normalizePermMode,
  permEscalation,
  permHosts,
  rememberPattern,
  sandboxReady,
  scopeLabels,
  tierBadge,
} from "./permissionUi";
import { translator } from "./i18n";

const vi = translator("vi");
const en = translator("en");

const shell = (pattern?: string): Perm => ({
  session_id: "s",
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

  it("only known modes are restored; anything else falls back to balanced", () => {
    expect(normalizePermMode("ask")).toBe("ask");
    expect(normalizePermMode("balanced")).toBe("balanced");
    expect(normalizePermMode("autonomous")).toBe("autonomous");
    expect(normalizePermMode("yolo")).toBe("balanced");
    expect(normalizePermMode(null)).toBe("balanced");
  });

  it("a host card offers host scopes, not a command pattern", () => {
    const p: Perm = {
      ...shell(undefined),
      risk: { tier: "ask", reasons: [], hosts: ["api.github.com", "x.io", "y.io"] },
    };
    expect(permHosts(p)).toEqual(["api.github.com", "x.io", "y.io"]);
    expect(hostsText(["a.io"])).toBe("a.io");
    expect(hostsText(["a.io", "b.io", "c.io", "d.io"])).toBe("a.io, b.io +2");
    expect(scopeLabels(p, vi)?.session).toBe("Cho phép api.github.com, x.io +1 trong phiên này");
    expect(scopeLabels(p, en)?.workspace).toBe("Always allow api.github.com, x.io +1 in this workspace");
    expect(permHosts(null)).toEqual([]);
  });

  it("recognises an escalation card and offers no scopes", () => {
    const p: Perm = {
      ...shell(undefined),
      name: "escalation",
      risk: { tier: "block", reasons: [], escalation: { count: 3, stop_only: true, blocked: ["Tải về rồi chạy ngay"] } },
    };
    expect(permEscalation(p)?.stop_only).toBe(true);
    expect(scopeLabels(p, vi)).toBeNull();
    expect(permEscalation(shell("npm install *"))).toBeNull();
  });

  it("explains why Autonomous runs like Balanced when the sandbox is not ready", () => {
    const ready = { state: "ready" } as const;
    expect(sandboxReady(ready)).toBe(true);
    expect(sandboxReady(null)).toBe(false);
    expect(autonomousFallbackNote("autonomous", ready, vi)).toBeNull();
    expect(autonomousFallbackNote("balanced", { state: "not_installed" }, vi)).toBeNull();
    expect(autonomousFallbackNote("autonomous", null, vi)).toBeNull();
    expect(autonomousFallbackNote("autonomous", { state: "not_installed" }, vi)).toContain("chưa cài sandbox");
    expect(autonomousFallbackNote("autonomous", { state: "degraded", reason: "firewall rule missing" }, en)).toContain(
      "firewall rule missing",
    );
    expect(autonomousFallbackNote("autonomous", { state: "unsupported" }, en)).toContain("not available");
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
