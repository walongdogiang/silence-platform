import { describe, expect, it } from "vitest";
import { permissionNotice, shouldNotify } from "./notify";

const win = (focused: boolean, minimized = false, visible = true) => ({
  isFocused: () => focused,
  isMinimized: () => minimized,
  isVisible: () => visible,
});

describe("permission notification", () => {
  it("shows only the reason, never a command", () => {
    expect(permissionNotice("Cài package")).toEqual({ title: "5ilence cần bạn duyệt", body: "Cài package" });
  });

  it("falls back to a generic line and clips long text", () => {
    expect(permissionNotice(undefined).body).toBe("Agent đang chờ quyết định của bạn.");
    expect(permissionNotice("   ").body).toBe("Agent đang chờ quyết định của bạn.");
    const long = permissionNotice("x".repeat(300)).body;
    expect(long.length).toBe(90);
    expect(long.endsWith("…")).toBe(true);
    expect(permissionNotice("a\n  b\tc").body).toBe("a b c");
  });

  it("notifies only when the window is not in front", () => {
    expect(shouldNotify(win(true))).toBe(false);
    expect(shouldNotify(win(false))).toBe(true);
    expect(shouldNotify(win(true, true))).toBe(true);
    expect(shouldNotify(win(true, false, false))).toBe(true);
    expect(shouldNotify(null)).toBe(false);
  });
});
