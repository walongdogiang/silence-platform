import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { LangContext, riskText, riskTextCodes } from "../i18n";
import type { Perm } from "../models";
import type { PermissionRisk } from "../types";
import { PermissionCard } from "./PermissionCard";
import { PermModeMenu } from "./PermModeMenu";

const noop = () => {};
const card = (risk: PermissionRisk, lang: "en" | "vi" = "en") => {
  const perm: Perm = { session_id: "s", request_id: "r", name: "Bash", input: { command: "npm test && git push origin main" }, reason: "", risk };
  return renderToStaticMarkup(
    <LangContext.Provider value={lang}>
      <PermissionCard perm={perm} busy={false} error={false} onAnswer={noop} onAllow={noop} onDeny={noop} />
    </LangContext.Provider>,
  );
};

const red: PermissionRisk = {
  tier: "block",
  reasons: [{ code: "GIT_PUSH_DEFAULT", title: "Push thẳng vào nhánh chính", detail: "…" }],
  level: "danger",
  codes: ["GIT_PUSH_DEFAULT", "BUILD_TEST"],
  segments: [
    { text: "npm test", level: "safe", codes: ["BUILD_TEST"] },
    { text: "git push origin main", level: "danger", codes: ["GIT_PUSH_DEFAULT"] },
  ],
  impact: { network: true, outside_workspace: false, deletes: false, admin: false, undoable: false },
  source: "agent",
  mode: "auto",
  deny_rule: "Bash(git push:*)",
};

describe("PermissionCard (TS core)", () => {
  it("shows the level, the real command and the buttons; a red card has no Always allow", () => {
    const out = card(red);
    expect(out).toContain("perm-level-danger");
    expect(out).toContain("Dangerous");
    expect(out).toContain("Push straight to the main branch");
    expect(out).toContain("npm test &amp;&amp; git push origin main");
    expect(out).toContain("Allow once");
    expect(out).not.toContain("Always allow");
    expect(out).toContain("Deny, add rule Bash(git push:*)");
  });

  it("keeps details folded by default", () => {
    const out = card(red);
    expect(out).toContain('aria-expanded="false"');
    expect(out).not.toContain("What it does");
    expect(out).not.toContain("Uses the network");
  });

  it("offers Always allow on a yellow card and shows a Bypass countdown", () => {
    const out = card({ tier: "ask", reasons: [], level: "caution", codes: ["PKG_INSTALL"], allow_rule: "Bash(npm install:*)", countdown_s: 30 }, "vi");
    expect(out).toContain("Cần chú ý");
    expect(out).toContain("Luôn cho phép Bash(npm install:*)");
    expect(out).toContain("Tự từ chối sau 30 giây");
  });

  it("keeps the Rust Engine card for cards without a level", () => {
    const out = card({ tier: "ask", reasons: [{ code: "PKG_INSTALL", title: "Cài package", detail: "…" }], pattern: "npm install *" });
    expect(out).toContain("Allow npm install * for this session");
    expect(out).not.toContain("Details");
  });
});

describe("risk code texts", () => {
  it("explain every policy code in both languages", () => {
    const policy = parseYaml(readFileSync(new URL("../../../../../packages/core/policy/default_policy.yaml", import.meta.url), "utf8")) as { codes: Record<string, unknown> };
    const codes = Object.keys(policy.codes).sort();
    const { en, vi } = riskTextCodes();
    expect([...en].sort()).toEqual(codes);
    expect([...vi].sort()).toEqual(codes);
    expect(riskText("DISK_DESTROY", "en")?.safer).toBeTruthy();
    expect(riskText("NOPE", "vi")).toBeNull();
  });
});

describe("PermModeMenu", () => {
  it("shows the current mode; Bypass is red", () => {
    const html = (mode: "auto" | "bypass") =>
      renderToStaticMarkup(
        <LangContext.Provider value="en">
          <PermModeMenu mode={mode} onMode={noop} coreOn bypassEnabled />
        </LangContext.Provider>,
      );
    expect(html("auto")).toContain("Auto (default)");
    expect(html("bypass")).toContain("perm-trigger-bypass");
    expect(html("bypass")).toContain("Bypass permissions");
  });
});
