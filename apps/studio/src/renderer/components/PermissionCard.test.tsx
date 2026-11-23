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
const card = (risk: PermissionRisk, lang: "en" | "vi" = "en", extra: Partial<Perm> = {}, detailsOpen = false, note = false) => {
  const perm: Perm = { session_id: "s", request_id: "r", name: "Bash", input: { command: "npm test && git push origin main" }, reason: "", risk, ...extra };
  return renderToStaticMarkup(
    <LangContext.Provider value={lang}>
      <PermissionCard perm={perm} busy={false} error={false} onAnswer={noop} onAllow={noop} onDeny={noop} onDenyNote={note ? noop : undefined} detailsOpen={detailsOpen} />
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
  it("red card: title from the reason, level, the real command; Deny + Allow without Enter, no scope menu", () => {
    const out = card(red);
    expect(out).toContain("perm-level-danger");
    expect(out).toContain("<h4>Push straight to the main branch</h4>");
    expect(out).toContain('class="perm-risk perm-risk-danger">Dangerous</span>');
    expect(out).toContain('<span class="perm-prompt">$ </span>');
    expect(out).toContain("git push origin main");
    expect(out).toContain("Deny<kbd>Esc</kbd></button>");
    expect(out).toContain(">Allow</button>"); // no Enter on red cards
    expect(out).not.toContain("perm-caret");
    expect(out).not.toContain("Always allow");
    expect(out).not.toContain("perm-compact");
  });

  it("keeps the other reasons folded behind +N", () => {
    const out = card({ ...red, codes: ["GIT_PUSH_DEFAULT", "NET_ACCESS"], reasons: [] });
    expect(out).toContain('aria-expanded="false">+1 more</button>');
    expect(out).not.toContain('class="perm-reasons"');
    expect(card({ ...red, codes: ["GIT_PUSH_DEFAULT", "NET_ACCESS"], reasons: [] }, "en", {}, true)).toContain('class="perm-reasons"');
  });

  it("Bypass countdown card stays full, with the scope menu trigger and the countdown", () => {
    const out = card({ tier: "ask", reasons: [], level: "caution", codes: ["PKG_INSTALL"], allow_rule: "Bash(npm install:*)", countdown_s: 30 }, "vi");
    expect(out).not.toContain("perm-compact");
    expect(out).toContain("Cần chú ý");
    expect(out).toContain('aria-label="Chọn phạm vi cho phép"');
    expect(out).toContain("Cho phép<kbd>Enter</kbd></button>");
    expect(out).toContain("Từ chối<kbd>Esc</kbd></button>");
    expect(out).toContain("Tự từ chối sau 30 giây");
  });

  it("one line (C) for a short low-risk command with a rule; ⌃ opens the full card", () => {
    const out = card({ tier: "ask", reasons: [], level: "caution", codes: ["PKG_INSTALL"], allow_rule: "Bash(npm install:*)" }, "vi", { input: { command: "npm install zod@3.23.8" } });
    expect(out).toContain("perm-card perm-compact perm-level-caution");
    expect(out).toContain('<code class="perm-cmd1" title="npm install zod@3.23.8">npm install zod@3.23.8</code>');
    expect(out).toContain('<span class="perm-why1">Cài package</span>');
    expect(out).toContain('aria-label="Mở thẻ đầy đủ"');
    expect(out).not.toContain("<h4>");
  });

  it("a write card shows the file and its diff, and offers Deny with a note", () => {
    const safe: PermissionRisk = { tier: "auto", reasons: [], level: "safe", codes: ["FS_WRITE_WS"], allow_rule: "Edit(**)" };
    const out = card(safe, "vi", {
      name: "Write",
      input: { file_path: "D:\\w\\hello.py", content: 'print("xin chào")\n' },
      preview: { path: "hello.py", before: "", after: 'print("xin chào")\n' },
    }, false, true);
    expect(out).toContain("<h4>Cho phép tạo hello.py?</h4>");
    expect(out).toContain("File mới");
    expect(out).toContain("diff-row add");
    expect(out).not.toContain("file_path");
    expect(out).toContain("Từ chối kèm lời dặn");
    expect(out).not.toContain("perm-compact");
  });

  it("MCP tools show a key/value table with a JSON switch", () => {
    const out = card({ tier: "ask", reasons: [], level: "caution", codes: ["MCP_CALL"] }, "en", {
      name: "mcp__github__create_issue",
      input: { repo: "5ilence", title: "Fix tooltip flicker", labels: ["bug"] },
    });
    expect(out).toContain('<dl class="perm-kv"><dt>repo</dt><dd title="5ilence">5ilence</dd>');
    expect(out).toContain('<dd title="[&quot;bug&quot;]">[&quot;bug&quot;]</dd>');
    expect(out).toContain(">JSON</button>");
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
    expect(html("auto")).toContain("<span>Auto</span>");
    expect(html("auto")).not.toContain("default");
    expect(html("bypass")).toContain("perm-trigger-bypass");
    expect(html("bypass")).toContain("Bypass permissions");
  });
});
