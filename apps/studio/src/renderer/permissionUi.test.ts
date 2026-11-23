import { describe, expect, it } from "vitest";
import type { Perm } from "./models";
import {
  alwaysAllowText,
  blockedStep,
  permKeyAction,
  permLayout,
  permTarget,
  scopeHint,
  effectivePermMode,
  hostsText,
  normalizePermMode,
  PERM_MODES,
  permEscalation,
  permHosts,
  permModeAvailable,
  rememberPattern,
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

  it("restores the four modes and maps legacy values (old read-only ask = Auto + Ask work mode)", () => {
    for (const m of ["auto", "manual", "accept_edits", "bypass"]) expect(normalizePermMode(m)).toBe(m);
    expect(normalizePermMode("ask")).toBe("auto");
    expect(PERM_MODES.map((m) => m.id)).toEqual(["auto", "manual", "accept_edits", "bypass"]);
    expect(normalizePermMode("balanced")).toBe("auto");
    expect(normalizePermMode("autonomous")).toBe("auto");
    expect(normalizePermMode("allowlist")).toBe("manual");
    expect(normalizePermMode("yolo")).toBe("auto");
    expect(normalizePermMode(null)).toBe("auto");
  });

  it("Bypass needs the core and the Settings switch; otherwise Auto runs", () => {
    expect(permModeAvailable("manual", false, false)).toBe(true);
    expect(permModeAvailable("bypass", true, false)).toBe(false);
    expect(permModeAvailable("bypass", true, true)).toBe(true);
    expect(permModeAvailable("bypass", false, true)).toBe(false);
    expect(effectivePermMode("bypass", true, false)).toBe("auto");
    expect(effectivePermMode("accept_edits", false, false)).toBe("accept_edits");
  });

  it("one line (C) only for a short low-risk command with a rule", () => {
    const base: Perm = { session_id: "s", request_id: "r", name: "Bash", reason: "", input: { command: "npm install zod" }, risk: { tier: "ask", reasons: [], level: "caution", codes: ["PKG_INSTALL"], allow_rule: "Bash(npm install:*)" } };
    const r = base.risk!;
    expect(permLayout(base)).toBe("compact");
    expect(permLayout({ ...base, risk: { ...r, level: "danger" } })).toBe("full");
    expect(permLayout({ ...base, risk: { ...r, allow_rule: undefined } })).toBe("full");
    expect(permLayout({ ...base, risk: { ...r, codes: ["PKG_INSTALL", "NET_ACCESS"] } })).toBe("full");
    expect(permLayout({ ...base, risk: { ...r, hosts: ["x.dev"] } })).toBe("full");
    expect(permLayout({ ...base, risk: { ...r, countdown_s: 30 } })).toBe("full");
    expect(permLayout({ ...base, input: { command: "a\nb" } })).toBe("full");
    expect(permLayout({ ...base, input: { command: "x".repeat(81) } })).toBe("full");
    expect(permLayout({ ...base, preview: { path: "a.py", before: "", after: "x" } })).toBe("full");
    expect(permLayout({ ...base, input: { path: "a" } })).toBe("full");
    expect(permLayout({ ...base, risk: { tier: "ask", reasons: [] } })).toBe("full"); // Rust Engine card
  });

  it("scope hint: a repo verify command is approved as that command, not saved as a rule", () => {
    const en = translator("en");
    expect(scopeHint({ source: "agent", allow_rule: "Bash(npm test:*)" }, en)).toBe("Saves the rule Bash(npm test:*) in this project's permissions.yaml");
    expect(scopeHint({ source: "verify", allow_rule: "python -m compileall -q ." }, en)).toBe("Approves exactly this command for this repo's checks; no permission rule is saved");
    expect(scopeHint({ source: "verify", allow_rule: "x" }, translator("vi"))).not.toContain("permissions.yaml");
  });

  it("names the target for the receipt line", () => {
    const p: Perm = { session_id: "s", request_id: "r", name: "Bash", reason: "", input: { command: "  npm   test\nsecond" } };
    expect(permTarget(p)).toBe("npm test");
    expect(permTarget({ ...p, input: {}, preview: { path: "src/a.py", before: "", after: "" } })).toBe("src/a.py");
    expect(permTarget({ ...p, name: "mcp__db__query", input: { sql: "x" } })).toBe("mcp__db__query");
    expect(permTarget({ ...p, input: { command: "x".repeat(100) } })).toHaveLength(72);
  });

  it("keys: Enter allows (not red, not on a button, never while typing), 1/2 pick a scope, Esc denies", () => {
    const o = { level: "caution" as const, hasRule: true, inText: false, onButton: false, busy: false };
    expect(permKeyAction("Enter", o)).toBe("allow_once");
    expect(permKeyAction("Enter", { ...o, level: "danger" })).toBeNull();
    expect(permKeyAction("Enter", { ...o, level: "hard_block" })).toBeNull();
    expect(permKeyAction("Enter", { ...o, onButton: true })).toBeNull();
    expect(permKeyAction("Enter", { ...o, inText: true })).toBeNull();
    expect(permKeyAction("Escape", { ...o, inText: true })).toBeNull();
    expect(permKeyAction("Enter", { ...o, busy: true })).toBeNull();
    expect(permKeyAction("Enter", { ...o, mods: true })).toBeNull();
    expect(permKeyAction("1", o)).toBe("allow_once");
    expect(permKeyAction("2", o)).toBe("allow_always");
    expect(permKeyAction("2", { ...o, hasRule: false })).toBeNull();
    expect(permKeyAction("Escape", { ...o, level: "danger" })).toBe("deny");
  });

  it("says the Always allow rule in plain words", () => {
    const vi = translator("vi");
    const en = translator("en");
    expect(alwaysAllowText("Edit(**)", vi)).toBe("Luôn cho phép sửa file trong project này");
    expect(alwaysAllowText("Edit(src/app/**)", en)).toBe("Always allow edits in src/app/");
    expect(alwaysAllowText("Read(**)", en)).toBe("Always allow reading this project");
    expect(alwaysAllowText("Bash(npm install:*)", vi)).toBe("Luôn cho phép lệnh npm install …");
    expect(alwaysAllowText("Bash(git status)", en)).toBe("Always allow git status");
    expect(alwaysAllowText("WebFetch(domain:example.com)", vi)).toBe("Luôn cho phép truy cập example.com");
    expect(alwaysAllowText("mcp__db__query", en)).toBe("Always allow query (db)");
    expect(alwaysAllowText("mcp__db", en)).toBe("Always allow MCP db");
    expect(alwaysAllowText("npm run lint", en)).toBe("Always allow npm run lint");
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
