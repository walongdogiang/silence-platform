import { describe, expect, it } from "vitest";
import { guessLang, speechChunks, speechText } from "./readAloud";

describe("readAloud", () => {
  it("speechText bỏ khối code, Markdown và URL", () => {
    const md = "## Kết quả\n\nĐã sửa **xong** file `a.ts`.\n\n```ts\nconst x = 1;\n```\n\nXem https://example.com nhé.";
    const out = speechText(md);
    expect(out).not.toContain("const x");
    expect(out).not.toContain("**");
    expect(out).not.toContain("##");
    expect(out).not.toContain("https://");
    expect(out).toContain("Đã sửa xong file a.ts.");
  });

  it("guessLang: có dấu tiếng Việt → vi-VN, còn lại en-US", () => {
    expect(guessLang("Vẽ một con chó")).toBe("vi-VN");
    expect(guessLang("Draw a dog")).toBe("en-US");
  });

  it("speechChunks gộp câu ngắn, cắt câu quá dài, không khúc nào vượt max", () => {
    expect(speechChunks("Một. Hai. Ba.", 50)).toEqual(["Một. Hai. Ba."]);
    const long = Array.from({ length: 60 }, (_, i) => `từ${i}`).join(" ");
    const chunks = speechChunks(long, 80);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 80)).toBe(true);
    expect(chunks.join(" ")).toBe(long);
  });
});
