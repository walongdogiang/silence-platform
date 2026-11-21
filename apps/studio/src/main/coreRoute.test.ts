import { describe, expect, it } from "vitest";
import { routeRpc, splitDelete, toCoreModel } from "./coreRoute";

const ids = new Set(["core-1"]);

describe("routeRpc", () => {
  it("sends everything to the Engine while the core is off", () => {
    expect(routeRpc("session.create", { workspace: "D:/w" }, false, ids)).toEqual({ to: "engine" });
    expect(routeRpc("session.prompt", { session_id: "core-1", text: "x" }, false, ids)).toEqual({ to: "engine" });
  });

  it("creates chat sessions on the core, without the Engine-only permission mode", () => {
    expect(routeRpc("session.create", { workspace: "D:/w", model: "claude-opus@cli", mode: "plan", permission: "balanced" }, true, ids)).toEqual({
      to: "core",
      method: "session.create",
      params: { workspace: "D:/w", mode: "plan", model: "opus" },
    });
    expect(routeRpc("session.create", { workspace: "D:/w", model: "auto" }, true, ids)).toEqual({ to: "core", method: "session.create", params: { workspace: "D:/w" } });
  });

  it("forwards turn methods of core sessions and keeps other sessions on the Engine", () => {
    const perm = { session_id: "core-1", request_id: "r", allow: true };
    expect(routeRpc("session.permission", perm, true, ids)).toEqual({ to: "core", method: "session.permission", params: perm });
    expect(routeRpc("session.set_model", { session_id: "core-1", model: "gpt-x" }, true, ids)).toEqual({ to: "core", method: "session.set_model", params: { session_id: "core-1", model: "" } });
    expect(routeRpc("session.prompt", { session_id: "old-engine", text: "x" }, true, ids)).toEqual({ to: "engine" });
    expect(routeRpc("fs.tree", { workspace: "D:/w" }, true, ids)).toEqual({ to: "engine" });
  });

  it("answers Engine-only settings locally and refuses what the core cannot do yet", () => {
    expect(routeRpc("session.set_effort", { session_id: "core-1", effort: "high" }, true, ids)).toEqual({ to: "local", result: {} });
    expect(routeRpc("session.rewind", { session_id: "core-1", keep_user_turns: 1 }, true, ids)).toMatchObject({ to: "error" });
    expect(routeRpc("session.context", { session_id: "core-1" }, true, ids)).toMatchObject({ to: "error" });
  });
});

describe("profile.status", () => {
  it("goes to the core, or answers that it is unavailable when the core is off", () => {
    expect(routeRpc("profile.status", { workspace: "D:/w" }, true, ids)).toEqual({ to: "core", method: "profile.status", params: { workspace: "D:/w" } });
    expect(routeRpc("profile.status", { workspace: "D:/w" }, false, ids)).toEqual({ to: "local", result: { available: false } });
  });
});

describe("toCoreModel", () => {
  it("maps catalog ids to Claude Code aliases and drops other vendors", () => {
    expect(toCoreModel("claude-sonnet")).toBe("sonnet");
    expect(toCoreModel("claude-haiku@api")).toBe("haiku");
    expect(toCoreModel("claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(toCoreModel("anthropic/claude-opus-5.5")).toBeUndefined();
    expect(toCoreModel("auto")).toBeUndefined();
    expect(toCoreModel(undefined)).toBeUndefined();
  });
});

describe("splitDelete", () => {
  it("splits ids between the core and the Engine", () => {
    expect(splitDelete({ session_ids: ["core-1", "e-2", 3] }, ids)).toEqual({ core: ["core-1"], engine: ["e-2"] });
  });
});
