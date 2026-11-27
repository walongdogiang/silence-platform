import { describe, expect, it } from "vitest";
import { forwardedShortcut, type KeyInput } from "./previewKeys";

const key = (code: string, mods: Partial<KeyInput> = {}): KeyInput => ({
  type: "keyDown",
  control: false,
  shift: false,
  alt: false,
  meta: false,
  code,
  ...mods,
});

describe("forwardedShortcut", () => {
  it("chuyển Ctrl+J, Ctrl+Shift+B, Ctrl+Alt+U về app", () => {
    expect(forwardedShortcut(key("KeyJ", { control: true }))).toBe(true);
    expect(forwardedShortcut(key("KeyB", { control: true, shift: true }))).toBe(true);
    expect(forwardedShortcut(key("KeyU", { control: true, alt: true }))).toBe(true);
  });

  it("để trang tự xử lý phím khác và keyUp", () => {
    expect(forwardedShortcut(key("KeyJ"))).toBe(false);
    expect(forwardedShortcut(key("KeyB", { control: true }))).toBe(false);
    expect(forwardedShortcut(key("KeyC", { control: true }))).toBe(false);
    expect(forwardedShortcut(key("KeyJ", { control: true, type: "keyUp" }))).toBe(false);
  });
});
