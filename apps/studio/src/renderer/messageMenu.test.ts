import { describe, expect, it } from "vitest";
import type { ChatLine } from "./models";
import {
  attachToPrompt,
  cutParams,
  firstUserFrom,
  quoteBlock,
  rewindImages,
  rewindPrompt,
  stripMarkdown,
  userTurnsBefore,
} from "./messageMenu";

describe("stripMarkdown", () => {
  it("drops markup and keeps the words", () => {
    const md = [
      "# Title",
      "",
      "Some **bold**, *italic*, `code` and ~~gone~~ text.",
      "- one",
      "- [x] done",
      "> quoted",
      "[docs](https://x.dev) and ![cat](cat.png)",
    ].join("\n");
    expect(stripMarkdown(md)).toBe(
      ["Title", "", "Some bold, italic, code and gone text.", "• one", "done", "quoted", "docs (https://x.dev) and cat"].join("\n"),
    );
  });

  it("keeps code blocks verbatim without fences", () => {
    expect(stripMarkdown("Run:\n```bash\nnpm run **x**\n```")).toBe("Run:\nnpm run **x**");
  });

  it("turns tables into tab-separated rows", () => {
    expect(stripMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe("a\tb\n1\t2");
  });

  it("leaves snake_case and math alone", () => {
    expect(stripMarkdown("call my_func_name with 2 * 3 * 4")).toBe("call my_func_name with 2 * 3 * 4");
  });

  it("keeps inline code verbatim", () => {
    expect(stripMarkdown("Call `__init__` then `a*b*c` and `[x](y)`")).toBe("Call __init__ then a*b*c and [x](y)");
    expect(stripMarkdown("``a `b` c``")).toBe("a `b` c");
  });

  it("keeps escaped punctuation literal", () => {
    expect(stripMarkdown("2 \\* 3 \\* 4 and \\_x\\_")).toBe("2 * 3 * 4 and _x_");
  });

  it("strips nested quotes and autolinks", () => {
    expect(stripMarkdown("> > deep\nsee <https://x.dev>")).toBe("deep\nsee https://x.dev");
  });

  it("keeps a shorter fence inside a longer one", () => {
    expect(stripMarkdown("````md\n```js\nx\n```\n````\nafter")).toBe("```js\nx\n```\nafter");
  });

  it("drops link titles", () => {
    expect(stripMarkdown('[docs](https://x.dev "Docs")')).toBe("docs (https://x.dev)");
  });
});

describe("attach as context", () => {
  it("quotes every line", () => {
    expect(quoteBlock("a\n\nb")).toBe("> a\n>\n> b");
  });

  it("appends under the draft and leaves a line to type on", () => {
    expect(attachToPrompt("", "hi")).toBe("> hi\n\n");
    expect(attachToPrompt("look at this:  \n", "hi")).toBe("look at this:\n\n> hi\n\n");
    expect(attachToPrompt("draft", "   ")).toBe("draft");
  });
});

const lines: ChatLine[] = [
  { kind: "user", text: "first" },
  { kind: "token", text: "a1" },
  { kind: "user", text: "second" },
  { kind: "token", text: "a2" },
  { kind: "user", text: "third" },
];

describe("history cuts", () => {
  it("counts user turns before a line", () => {
    expect(userTurnsBefore(lines, 0)).toBe(0);
    expect(userTurnsBefore(lines, 2)).toBe(1);
    expect(userTurnsBefore(lines, 99)).toBe(3);
  });

  it("finds the first dropped user message", () => {
    expect(firstUserFrom(lines, 1)).toEqual({ kind: "user", text: "second" });
    expect(firstUserFrom(lines, 5)).toBeUndefined();
  });

  it("builds rewind/fork params", () => {
    expect(cutParams(lines, 2)).toEqual({ keep_user_turns: 1, text: "second" });
    // Cutting after the end of a turn (Fork chat on an answer): the next user message is dropped.
    expect(cutParams(lines, 4)).toEqual({ keep_user_turns: 2, text: "third" });
    // Nothing after: whole history.
    expect(cutParams(lines, 5)).toEqual({});
  });
});

describe("rewindPrompt", () => {
  it("puts the message images first and keeps the draft's", () => {
    expect(rewindImages(["a", "b"], ["c", "a"])).toEqual(["a", "b", "c"]);
    expect(rewindImages(undefined, ["c"])).toEqual(["c"]);
  });

  it("puts the message back and keeps an unsent draft", () => {
    expect(rewindPrompt("msg", "")).toBe("msg");
    expect(rewindPrompt("msg", "msg")).toBe("msg");
    expect(rewindPrompt("msg", "draft")).toBe("msg\n\ndraft");
  });
});
