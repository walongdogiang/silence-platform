import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangContext } from "../i18n";
import type { ChatThread } from "../models";
import { normalizePrefs } from "../prefs";
import { ChatHistoryPanel } from "./ChatHistoryPanel";
import { WorktreeBanner, WorktreeCard, WorktreeMenu, type WorktreeView } from "./Worktree";

const noop = () => {};
const w: WorktreeView = { path: "C:\\Users\\me\\AppData\\Local\\silence\\worktrees\\shop\\20261122-0905-ab12", branch: "silence/20261122-0905-ab12", base: "main", reason: "other_running" };
const vi = (node: JSX.Element) => renderToStaticMarkup(<LangContext.Provider value="vi">{node}</LangContext.Provider>);

describe("worktree UI", () => {
  it("the banner is one line: branch ← base and why; the folder only in the tooltip and copy button", () => {
    const out = vi(<WorktreeBanner w={w} />);
    expect(out).toContain("Worktree riêng · <code>silence/20261122-0905-ab12</code> ← main");
    expect(out).toContain("vì một chat khác đang chạy trong thư mục này");
    expect(out).toContain('title="C:\\Users\\me\\AppData\\Local\\silence\\worktrees\\shop\\20261122-0905-ab12"');
    expect(out).toContain('aria-label="Copy đường dẫn thư mục worktree"');
    expect(out.split("AppData").length).toBe(2);
  });

  it("the merge card lists changed files and offers merge, keep and discard", () => {
    const out = vi(<WorktreeCard w={w} files={[{ path: "src/a.ts", added: 3, removed: 1 }, { path: "new.md", added: 0, removed: 0, isNew: true }]} commits={1} onMerge={noop} onKeep={noop} onDiscard={noop} />);
    expect(out).toContain("2 file đổi trong silence/20261122-0905-ab12");
    expect(renderToStaticMarkup(<LangContext.Provider value="en"><WorktreeCard w={w} files={[{ path: "a", added: 1, removed: 0 }]} commits={1} onMerge={noop} onKeep={noop} onDiscard={noop} /></LangContext.Provider>)).toContain("1 file changed in");
    expect(out).toContain("<code>src/a.ts</code>");
    expect(out).toContain(">mới<");
    expect(out).toContain("Gộp vào main");
    expect(out).toContain("Giữ nhánh");
    expect(out).toContain(">Bỏ<");
  });

  it("reports a conflict with the files, and a merge with its commit", () => {
    const base = { w, files: [{ path: "a.txt", added: 1, removed: 1 }], commits: 0, onMerge: noop, onKeep: noop, onDiscard: noop };
    expect(vi(<WorktreeCard {...base} outcome={{ ok: false, conflicts: ["a.txt"] }} />)).toContain("Xung đột khi gộp");
  });

  it("once merged it shows what went in, not the empty branch, and drops merge/keep/discard", () => {
    const after = { w, files: [], commits: 0, onMerge: noop, onKeep: noop, onDiscard: noop };
    const out = vi(<WorktreeCard {...after} outcome={{ ok: true, commit: "abc1234" }} merged={[{ path: "notes.md", added: 1, removed: 0 }]} onClose={noop} />);
    expect(out).toContain("Đã gộp 1 file vào main (abc1234)");
    expect(out).toContain("<code>notes.md</code>");
    expect(out).toContain("wt-card done");
    expect(out).not.toContain("Gộp vào main");
    expect(out).not.toContain("Giữ nhánh");
    expect(out).not.toContain(">Bỏ<");
    expect(out).toContain(">Đóng<");
  });

  it("the per-chat switch shows the choice, and locks after the first message", () => {
    expect(vi(<WorktreeMenu mode="on" onMode={noop} locked={false} active={false} />)).toContain("Worktree: luôn tách");
    const locked = vi(<WorktreeMenu mode="auto" onMode={noop} locked active />);
    expect(locked).toContain("Trong worktree");
    expect(locked).toMatch(/<button[^>]*disabled=""/);
  });
});

describe("parallel chats", () => {
  const thread = (id: string, title: string): ChatThread => ({ id, sessionId: `s-${id}`, workspace: "D:/w", title, preview: "", updatedAt: Date.now(), lines: [{ kind: "user", text: title }] });
  it("the history marks every running chat, waiting ones apart", () => {
    const out = renderToStaticMarkup(
      <LangContext.Provider value="en">
        <ChatHistoryPanel workspace="D:/w" threads={[thread("a", "First"), thread("b", "Second"), thread("c", "Third")]} activeId="a" onNewChat={noop} onSelect={noop} onDelete={noop} onRename={noop} onCustomize={noop} onToggle={noop} runStates={{ a: "running", b: "waiting" }} />
      </LangContext.Provider>,
    );
    expect((out.match(/history-dot on running/g) ?? []).length).toBe(1);
    expect((out.match(/history-dot on waiting/g) ?? []).length).toBe(1);
    expect((out.match(/run-ind sm working/g) ?? []).length).toBe(1);
  });

  it("turns at once default to 2 and stay within 1..4", () => {
    expect(normalizePrefs({}).maxConcurrent).toBe(2);
    expect(normalizePrefs({ maxConcurrent: 4 }).maxConcurrent).toBe(4);
    expect(normalizePrefs({ maxConcurrent: 9 }).maxConcurrent).toBe(2);
  });
});
