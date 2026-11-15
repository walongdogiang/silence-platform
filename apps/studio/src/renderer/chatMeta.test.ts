import { describe, expect, it } from "vitest";
import { formatRanges, mergeRanges, mergeReadSteps, narrateToPast, narrateToolLive, readRange, stepText } from "./chatMeta";
import { translator } from "./i18n";

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

describe("step text in the UI language", () => {
  it("translates stored English verbs and fixed details, keeps unknown text", () => {
    const vi = translator("vi");
    expect(stepText({ verb: "Read", detail: "App.tsx (1–40)" }, vi)).toBe("Đã đọc App.tsx (1–40)");
    expect(stepText(narrateToolLive("grep", { pattern: "foo", path: "src/a.ts" }), vi)).toBe("Đang tìm `foo` trong a.ts");
    expect(stepText({ verb: "Running", detail: "command" }, vi)).toBe("Đang chạy lệnh");
    expect(stepText({ verb: "Frobbing", detail: "x" }, vi)).toBe("Frobbing x");
    expect(stepText({ verb: "Read", detail: "a.ts" }, translator("en"))).toBe("Read a.ts");
  });
});

describe("narration of verification tools", () => {
  it("names background-process and http_check steps", () => {
    expect(narrateToolLive("proc_start", { command: "npm run dev" })).toEqual({ verb: "Starting", detail: "npm run dev" });
    expect(narrateToolLive("proc_logs", { id: "p1" })).toEqual({ verb: "Reading logs", detail: "p1" });
    expect(narrateToolLive("proc_stop", { id: "p1" })).toEqual({ verb: "Stopping", detail: "p1" });
    expect(narrateToolLive("proc_list", {})).toEqual({ verb: "Checking processes" });
    expect(narrateToolLive("http_check", { url: "http://localhost:5173/api", method: "post" })).toEqual({
      verb: "Checking",
      detail: "POST localhost:5173/api",
    });
    expect(narrateToPast(narrateToolLive("http_check", { url: "http://127.0.0.1:8000/" })).verb).toBe("Checked");
    expect(narrateToPast(narrateToolLive("proc_start", { command: "x" })).verb).toBe("Started");
  });
});
