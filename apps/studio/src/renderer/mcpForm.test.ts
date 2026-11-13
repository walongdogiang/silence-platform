import { describe, expect, it } from "vitest";
import { commandLine, hasLiteralSecret, parseEnv, splitArgs, validServerName } from "./mcpForm";

describe("mcp form", () => {
  it("splits args with quotes", () => {
    expect(splitArgs("-y  @scope/server  --root \"C:\My Files\"")).toEqual(["-y", "@scope/server", "--root", "C:\My Files"]);
    expect(splitArgs("  ")).toEqual([]);
    expect(splitArgs('""')).toEqual([""]);
  });

  it("parses KEY=value lines", () => {
    expect(parseEnv("A=1\n\n B = ${TOKEN} ")).toEqual({ env: [["A", "1"], ["B", "${TOKEN}"]], bad: null });
    expect(parseEnv("novalue").bad).toBe("novalue");
    expect(parseEnv("1X=2").bad).toBe("1X=2");
  });

  it("flags values pasted in plain text", () => {
    expect(hasLiteralSecret([["T", "${GITHUB_TOKEN}"]])).toBe(false);
    expect(hasLiteralSecret([["T", "ghp_abc"]])).toBe(true);
  });

  it("matches the Engine name rule", () => {
    expect(validServerName("github")).toBe(true);
    expect(validServerName("a__b")).toBe(false);
    expect(validServerName("a b")).toBe(false);
  });

  it("shows the command line to confirm", () => {
    expect(commandLine("npx", ["-y", "a b"])).toBe('npx -y "a b"');
  });
});
