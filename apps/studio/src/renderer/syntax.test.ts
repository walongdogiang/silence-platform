import { describe, expect, it } from "vitest";
import { languageFor, tokenClass } from "./syntax";

describe("languageFor", () => {
  it("nhận tên fence và đuôi file", () => {
    expect(languageFor("python")).toBe("python");
    expect(languageFor("calculator.py")).toBe("python");
    expect(languageFor("apps\\studio\\src\\x.tsx")).toBe("typescript");
    expect(languageFor("ps1")).toBe("powershell");
    expect(languageFor("Cargo.toml")).toBe("ini");
    expect(languageFor("Dockerfile")).toBe("dockerfile");
  });

  it("không biết thì plaintext", () => {
    expect(languageFor(undefined)).toBe("plaintext");
    expect(languageFor("README")).toBe("plaintext");
    expect(languageFor("foo.unknownext")).toBe("plaintext");
  });
});

describe("tokenClass", () => {
  it("ánh xạ loại token Monaco sang class", () => {
    expect(tokenClass("keyword.python")).toBe("tk-keyword");
    expect(tokenClass("string.escape.ts")).toBe("tk-string");
    expect(tokenClass("comment.line")).toBe("tk-comment");
    expect(tokenClass("number.float")).toBe("tk-number");
    expect(tokenClass("type.identifier.ts")).toBe("tk-type");
    expect(tokenClass("delimiter.parenthesis")).toBe("tk-punct");
    expect(tokenClass("identifier.python")).toBe("");
    expect(tokenClass("")).toBe("");
  });
});
