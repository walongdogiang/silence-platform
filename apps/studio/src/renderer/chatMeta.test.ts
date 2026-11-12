import { describe, expect, it } from "vitest";
import { formatRanges, mergeRanges, mergeReadSteps, narrateToPast, narrateToolLive, readRange } from "./chatMeta";

const read = (path: string, extra: Record<string, number> = {}) => narrateToPast(narrateToolLive("read", { path, ...extra }));

describe("read step grouping", () => {
  it("derives line ranges from offset/limit", () => {
    expect(readRange({ path: "a" })).toBeUndefined();
    expect(readRange({ path: "a", offset: 615, limit: 15 })).toEqual([[615, 629]]);
    expect(readRange({ path: "a", limit: 40 })).toEqual([[1, 40]]);
    expect(readRange({ path: "a", offset: 990 })).toEqual([[990, null]]);
  });

  it("shows the range on a single read", () => {
    expect(narrateToolLive("read", { path: "src/App.tsx", offset: 1, limit: 40 })).toMatchObject({
      verb: "Reading",
      detail: "App.tsx (1–40)",
      file: "src/App.tsx",
    });
    expect(narrateToolLive("read", { path: "src/App.tsx" }).detail).toBe("App.tsx");
  });

  it("merges sorted, overlapping and adjacent ranges", () => {
    expect(mergeRanges([[615, 629]], [[1, 40]])).toEqual([[1, 40], [615, 629]]);
    expect(mergeRanges([[1, 40]], [[41, 60]])).toEqual([[1, 60]]);
    expect(mergeRanges([[1, 40]], [[30, 50]])).toEqual([[1, 50]]);
    expect(mergeRanges([[900, null]], [[950, 1000]])).toEqual([[900, null]]);
    expect(mergeRanges([[1, 40]], undefined)).toBeUndefined();
  });

  it("groups consecutive reads of the same file like Claude Code", () => {
    const steps = mergeReadSteps([
      read("src/App.tsx", { offset: 1, limit: 40 }),
      read("src/App.tsx", { offset: 615, limit: 15 }),
      read("src/App.tsx", { offset: 835, limit: 60 }),
      { verb: "Edited", detail: "App.tsx" },
      read("src/ChatPane.tsx", { offset: 1, limit: 45 }),
    ]);
    expect(steps.map((s) => `${s.verb} ${s.detail}`)).toEqual([
      "Read App.tsx (1–40, 615–629, 835–894)",
      "Edited App.tsx",
      "Read ChatPane.tsx (1–45)",
    ]);
  });

  it("a whole-file read absorbs ranges; different files stay apart", () => {
    const whole = mergeReadSteps([read("a/x.ts", { offset: 10, limit: 5 }), read("a/x.ts")]);
    expect(whole).toHaveLength(1);
    expect(whole[0].detail).toBe("x.ts");
    expect(mergeReadSteps([read("a/x.ts"), read("b/x.ts")])).toHaveLength(2);
  });

  it("live step keeps the latest verb", () => {
    const live = mergeReadSteps([read("a.ts", { limit: 10 }), narrateToolLive("read", { path: "a.ts", offset: 50, limit: 10 })]);
    expect(live).toHaveLength(1);
    expect(live[0].verb).toBe("Reading");
    expect(live[0].detail).toBe("a.ts (1–10, 50–59)");
  });

  it("collapses long range lists", () => {
    expect(formatRanges([[1, 2], [5, 6], [9, 10], [13, 14], [17, 18], [21, 22]])).toBe("1–2, 5–6, 9–10, 13–14, … +2");
  });
});
