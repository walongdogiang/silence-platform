import { describe, expect, it } from "vitest";
import { CredentialStore, MAIN_ONLY_RPC, cleanKey, type Cipher, type FileIo } from "./credentials";

const cipher = (ok = true): Cipher => ({
  available: () => ok,
  encrypt: (s) => `enc:${Buffer.from(s).toString("base64")}`,
  decrypt: (s) => Buffer.from(s.replace(/^enc:/, ""), "base64").toString(),
});

const memIo = (initial: string | null = null): FileIo & { text: string | null } => {
  const io = {
    text: initial,
    read: () => io.text,
    write: (t: string) => {
      io.text = t;
    },
  };
  return io;
};

describe("credential store", () => {
  it("stores keys encrypted and reports only has_key + last4", () => {
    const io = memIo();
    const s = new CredentialStore(io, cipher());
    s.set("anthropic", "sk-ant-secret-1234");
    expect(io.text).not.toContain("sk-ant-secret-1234");
    const st = s.status().find((x) => x.provider === "anthropic")!;
    expect(st).toEqual({ provider: "anthropic", has_key: true, last4: "1234" });
    expect(JSON.stringify(s.status())).not.toContain("secret");
    expect(new CredentialStore(io, cipher()).get("anthropic")).toBe("sk-ant-secret-1234");
  });

  it("clears with an empty key and ignores unknown providers on load", () => {
    const io = memIo(JSON.stringify({ evil: "x", anthropic: "enc:YQ==" }));
    const s = new CredentialStore(io, cipher());
    expect(s.all()).toEqual([{ provider: "anthropic", key: "a" }]);
    s.set("anthropic", "");
    expect(s.all()).toEqual([]);
  });

  it("refuses to store without OS encryption", () => {
    const s = new CredentialStore(memIo(), cipher(false));
    expect(() => s.set("anthropic", "k")).toThrow();
  });

  it("validates input and keeps secret RPCs main-only", () => {
    expect(cleanKey("  abc  ")).toBe("abc");
    expect(() => cleanKey("a\nb")).toThrow();
    expect(() => cleanKey(42)).toThrow();
    expect(MAIN_ONLY_RPC.has("providers.set_credential")).toBe(true);
  });
});
