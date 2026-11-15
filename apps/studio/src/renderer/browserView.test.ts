import { describe, expect, it } from "vitest";
import { applyBrowser, shortUrl } from "./browserView";

const ev = (over: Partial<Parameters<typeof applyBrowser>[1]> = {}) => ({
  url: "http://localhost:5173/cart",
  title: "Cart",
  frame: "data:image/jpeg;base64,AAAA",
  errors: 0,
  failed: 0,
  ...over,
});

describe("browserView", () => {
  it("shows the page and keeps the last frame when a new one is missing", () => {
    const a = applyBrowser(null, ev());
    expect(a).toMatchObject({ url: "http://localhost:5173/cart", title: "Cart", frame: "data:image/jpeg;base64,AAAA" });
    const b = applyBrowser(a, ev({ frame: undefined, errors: 2 }));
    expect(b?.frame).toBe("data:image/jpeg;base64,AAAA");
    expect(b?.errors).toBe(2);
  });

  it("ignores frames that are not image data URLs", () => {
    expect(applyBrowser(null, ev({ frame: "javascript:alert(1)" }))?.frame).toBeUndefined();
    expect(applyBrowser(null, ev({ frame: "https://evil.example/x.png" }))?.frame).toBeUndefined();
  });

  it("clears when the browser closes", () => {
    expect(applyBrowser(applyBrowser(null, ev()), ev({ url: "" }))).toBeNull();
  });

  it("shortens the address", () => {
    expect(shortUrl("http://127.0.0.1:8767/index.html")).toBe("127.0.0.1:8767/index.html");
  });
});
