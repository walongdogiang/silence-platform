import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SandboxStatus } from "../types";
import { PermissionsSection, sandboxStateText } from "./PermissionsSection";
import { translator } from "../i18n";

const noop = async () => {};

const html = (sandbox: SandboxStatus | null, mode: "ask" | "balanced" | "autonomous" = "balanced") =>
  renderToStaticMarkup(
    <PermissionsSection
      workspace=""
      mode={mode}
      onMode={() => {}}
      sandbox={sandbox}
      onRefreshSandbox={noop}
      onSetupSandbox={noop}
    />,
  );

/** The `<input>` of the Autonomous radio (the third radio of the group). */
function autonomousInput(out: string): string {
  const radios = out.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
  expect(radios).toHaveLength(3);
  return radios[2];
}

describe("PermissionsSection sandbox", () => {
  it("Autonomous is selectable only when the sandbox is ready", () => {
    expect(autonomousInput(html({ state: "ready" }))).not.toContain("disabled");
    expect(autonomousInput(html({ state: "not_installed" }))).toContain("disabled");
    expect(autonomousInput(html({ state: "degraded", reason: "x" }))).toContain("disabled");
    expect(autonomousInput(html({ state: "unsupported" }))).toContain("disabled");
    expect(autonomousInput(html(null))).toContain("disabled");
  });

  it("a selected Autonomous stays clickable so it can be unselected after the sandbox breaks", () => {
    expect(autonomousInput(html({ state: "degraded", reason: "x" }, "autonomous"))).not.toContain("disabled");
  });

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
