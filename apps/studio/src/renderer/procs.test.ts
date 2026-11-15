import { describe, expect, it } from "vitest";
import { applyProc, exitCode, isLocalUrl, procState, sortProcs, type ProcRow } from "./procs";

const row = (id: string, status = "running", urls: string[] = []): ProcRow => ({ id, command: `cmd ${id}`, status, urls });

describe("procs", () => {
  it("reads status", () => {
    expect(procState("running")).toBe("running");
    expect(procState("stopped")).toBe("stopped");
    expect(procState("exited 1")).toBe("exited");
    expect(procState("exited")).toBe("exited");
    expect(exitCode("exited 3")).toBe(3);
    expect(exitCode("exited")).toBeUndefined();
  });

  it("upserts from events", () => {
    let list = applyProc([], row("p1"));
    list = applyProc(list, row("p2"));
    expect(list.map((p) => p.id)).toEqual(["p2", "p1"]);
    list = applyProc(list, row("p1", "running", ["http://localhost:5173/"]));
    expect(list.find((p) => p.id === "p1")?.urls).toEqual(["http://localhost:5173/"]);
    expect(list).toHaveLength(2);
  });

  it("sorts running first, newest first", () => {
    const sorted = sortProcs([row("p1", "stopped"), row("p2"), row("p10"), row("p3", "exited 1")]);
    expect(sorted.map((p) => p.id)).toEqual(["p10", "p2", "p3", "p1"]);
  });

  it("only links loopback URLs", () => {
    expect(isLocalUrl("http://localhost:5173/")).toBe(true);
    expect(isLocalUrl("https://127.0.0.1:8443/app")).toBe(true);
    expect(isLocalUrl("http://[::1]:3000")).toBe(true);
    expect(isLocalUrl("http://localhost.evil.com/")).toBe(false);
    expect(isLocalUrl("http://192.168.1.2:5173/")).toBe(false);
    expect(isLocalUrl("javascript:alert(1)")).toBe(false);
  });
});
