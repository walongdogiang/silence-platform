import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangContext } from "../i18n";
import type { Diff } from "../models";
import { DiffCard, shownPath } from "./DiffCard";

const noop = () => {};
const wt = "C:\\Users\\me\\AppData\\Local\\silence\\worktrees\\py\\20261123-1702-ce12";
const vi = (node: JSX.Element) => renderToStaticMarkup(<LangContext.Provider value="vi">{node}</LangContext.Provider>);

describe("diff card path and undo", () => {
  it("shows the path relative to the worktree, else the workspace, else as is", () => {
    expect(shownPath(`${wt}\\src\\notes.md`, [wt, "D:/proj"])).toBe("src/notes.md");
    expect(shownPath("d:/PROJ/a.py", [undefined, "D:\\proj\\"])).toBe("a.py");
    expect(shownPath("E:/other/a.py", [wt, "D:/proj"])).toBe("E:/other/a.py");
    expect(shownPath("D:/project2/a.py", ["D:/proj"])).toBe("D:/project2/a.py");
  });

  it("keeps the full path in the tooltip, and drops Undo once the edit is merged", () => {
    const diff = { path: `${wt}/notes.md`, before: "", after: "x\n", applied: true } as Diff;
    const live = vi(<DiffCard diff={diff} onApply={noop} onReject={noop} onShow={noop} roots={[wt]} />);
    expect(live).toContain('<span class="name">notes.md</span>');
    expect(live).not.toContain('class="dir"');
    expect(live).toContain(`title="${wt}/notes.md`);
    expect(live).toContain(">Hoàn tác<");
    const merged = vi(<DiffCard diff={diff} onApply={noop} onReject={noop} onShow={noop} roots={[wt]} mergedInto="master" />);
    expect(merged).not.toContain(">Hoàn tác<");
    expect(merged).toContain("Đã gộp vào master");
  });
});
