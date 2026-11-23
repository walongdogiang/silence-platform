import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SandboxStatus } from "../types";
import type { UiPermMode } from "../permissionUi";
import { PermissionsSection, sandboxStateText } from "./PermissionsSection";
import { translator } from "../i18n";

const noop = async () => {};

const html = (sandbox: SandboxStatus | null, opts: { mode?: UiPermMode; coreOn?: boolean; bypass?: boolean } = {}) =>
  renderToStaticMarkup(
    <PermissionsSection
      workspace=""
      mode={opts.mode ?? "auto"}
      onMode={() => {}}
      coreOn={opts.coreOn ?? true}
      bypassEnabled={opts.bypass ?? false}
      onBypassEnabled={() => {}}
      sandbox={sandbox}
      onRefreshSandbox={noop}
      onSetupSandbox={noop}
    />,
  );

const radios = (out: string) => out.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];

describe("PermissionsSection modes", () => {
  it("lists Auto first, then Manual and Accept edits; Bypass only once its switch is on", () => {
    const out = html(null);
    expect(radios(out)).toHaveLength(3);
    const at = (label: string) => out.indexOf(`<strong>${label}</strong>`);
    expect(at("Auto")).toBeGreaterThan(-1);
    expect(at("Auto")).toBeLessThan(at("Manual"));
    expect(at("Manual")).toBeLessThan(at("Accept edits"));
    expect(out).not.toContain("Auto (default)");
    expect(out).not.toContain("Everything runs without asking");
    expect(radios(html(null, { bypass: true }))).toHaveLength(4);
    expect(out).toContain("Allow Bypass permissions mode");
  });

  it("Bypass cannot be picked while the core is off", () => {
    const r = radios(html(null, { coreOn: false, bypass: true }));
    expect(r[0]).not.toContain("disabled");
    expect(r[1]).not.toContain("disabled");
    expect(r[3]).toContain("disabled");
    expect(html(null, { coreOn: false })).toContain("SILENCE_CORE=1");
  });
});

describe("PermissionsSection sandbox", () => {
  it("offers install when missing, repair when degraded, nothing when ready", () => {
    expect(html({ state: "not_installed" })).toContain("Install sandbox (UAC)");
    const degraded = html({ state: "degraded", reason: "firewall rule missing" });
    expect(degraded).toContain("Repair (UAC)");
    expect(degraded).toContain("firewall rule missing");
    const ready = html({ state: "ready" });
    expect(ready).not.toContain("(UAC)");
    expect(ready).toContain("Ready");
    expect(html({ state: "unsupported" })).not.toContain("(UAC)");
  });

  it("states read the same in English", () => {
    const en = translator("en");
    expect(sandboxStateText(null, en)).toBe("Checking…");
    expect(sandboxStateText({ state: "ready" }, en)).toBe("Ready");
    expect(sandboxStateText({ state: "degraded", reason: "r" }, en)).toBe("Needs repair: r");
  });
});
