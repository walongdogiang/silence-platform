import { describe, expect, it } from "vitest";
import type { ChatThread } from "./models";
import { pinnedSessionIds, pruneThreads } from "./retention";

const DAY = 24 * 60 * 60 * 1000;
const now = 100 * DAY;
const th = (id: string, ageDays: number, extra: Partial<ChatThread> = {}): ChatThread => ({
  id,
  sessionId: `s-${id}`,
  workspace: "w",
  title: id,
  preview: "",
  updatedAt: now - ageDays * DAY,
  lines: [],
  ...extra,
});

describe("chat retention", () => {
  it("keeps everything when retention is off", () => {
    const all = [th("a", 400)];
    expect(pruneThreads(all, 0, now).removed).toEqual([]);
  });

  it("removes old threads but keeps pinned and the open one", () => {
    const all = [th("new", 1), th("old", 40), th("pinned", 40, { pinned: true }), th("open", 40)];
    const r = pruneThreads(all, 30, now, "open");
    expect(r.kept.map((t) => t.id)).toEqual(["new", "pinned", "open"]);
    expect(r.removed.map((t) => t.id)).toEqual(["old"]);
  });

  it("lists pinned session ids for the Engine", () => {
    expect(pinnedSessionIds([th("a", 1, { pinned: true }), th("b", 1)])).toEqual(["s-a"]);
  });
});
