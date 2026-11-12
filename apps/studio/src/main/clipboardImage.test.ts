import { describe, expect, it } from "vitest";
import { MAX_CLIPBOARD_IMAGE_BYTES, isPngBytes } from "./clipboardImage";

const png = (n = 16) => {
  const b = new Uint8Array(n);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return b;
};

describe("isPngBytes", () => {
  it("nhận PNG, từ chối còn lại", () => {
    expect(isPngBytes(png())).toBe(true);
    expect(isPngBytes(new Uint8Array([1, 2, 3]))).toBe(false);
    expect(isPngBytes(new Uint8Array(32))).toBe(false);
    expect(isPngBytes("data:image/png;base64,AAAA")).toBe(false);
    expect(isPngBytes(null)).toBe(false);
    expect(isPngBytes(new Uint8Array(MAX_CLIPBOARD_IMAGE_BYTES + 1))).toBe(false);
  });
});
