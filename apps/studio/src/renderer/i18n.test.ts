import { describe, expect, it } from "vitest";
import { MSG_KEYS, escalationText, translate, type MsgKey } from "./i18n";

describe("i18n", () => {
  it("interpolates and switches language", () => {
    expect(translate("vi", "auto.used", { usd: "$1" })).toBe("Đã dùng $1");
    expect(translate("en", "auto.used", { usd: "$1" })).toBe("Used $1");
    expect(translate("en", "model.search")).toBe("Search models");
  });

  it("both languages use the same {vars} for every key", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    const bad = MSG_KEYS.filter((k) => vars(translate("en", k)) !== vars(translate("vi", k)));
    expect(bad).toEqual([]);
    expect(MSG_KEYS.filter((k) => !translate("vi", k).trim())).toEqual([]);
  });

  it("maps Engine escalation phrases, passes unknown text through", () => {
    const t = (k: MsgKey, v?: Record<string, string | number>) => translate("vi", k, v);
    expect(escalationText("tests failed after an edit", t)).toBe("test đỏ sau khi sửa");
    expect(escalationText("grep failed 2 times", t)).toBe("grep lỗi 2 lần");
    expect(escalationText("4 steps without progress", t)).toBe("4 bước không tiến triển");
    expect(escalationText("something new", t)).toBe("something new");
  });
});
