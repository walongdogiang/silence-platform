import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Backend, StartOptions } from "../backends/types.js";
import { RpcClient } from "../api/jsonrpc.js";
import { memoryPair } from "../api/transport.js";
import { createCoreWithSessions } from "../core.js";
import { loadPersonal, looksLikeSecret, projectName, PROFILE_MAX_LINES } from "./personal.js";

const tmp = (p: string) => mkdtempSync(path.join(os.tmpdir(), p));

function home(files: Record<string, string>): string {
  const h = tmp("core-home-");
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(h, rel)), { recursive: true });
    writeFileSync(path.join(h, rel), text);
  }
  return h;
}

const PLUGIN = { "plugin/.claude-plugin/plugin.json": JSON.stringify({ name: "me" }), "plugin/skills/verify/SKILL.md": "---\nname: verify\n---", "plugin/skills/pr-flow/SKILL.md": "x" };

function gitRepo(name: string): string {
  const parent = tmp("core-git-");
  const ws = path.join(parent, name);
  mkdirSync(ws);
  execFileSync("git", ["init", "-q"], { cwd: ws });
  return ws;
}

describe("looksLikeSecret", () => {
  it("catches keys and tokens but not prose about them", () => {
    expect(looksLikeSecret("api_key = abcdefghijklmnop1234")).toBe(true);
    expect(looksLikeSecret("dùng sk-ant-abcdefghijklmnopqrst")).toBe(true);
    expect(looksLikeSecret("ghp_abcdefghijklmnopqrstuvwxyz0123")).toBe(true);
    expect(looksLikeSecret("-----BEGIN OPENSSH PRIVATE KEY-----")).toBe(true);
    expect(looksLikeSecret("Không bao giờ in API key; dùng bearer token từ env.")).toBe(false);
  });
});

describe("projectName", () => {
  it("uses the main checkout's folder, so worktrees share one profile", async () => {
    const ws = gitRepo("myrepo");
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: ws });
    const wt = path.join(path.dirname(ws), "myrepo-wt");
    execFileSync("git", ["worktree", "add", "-q", wt], { cwd: ws });
    expect(await projectName(ws)).toBe("myrepo");
    expect(await projectName(wt)).toBe("myrepo");
    expect(await projectName(tmp("plain-"))).toMatch(/^plain-/);
  });
});

describe("loadPersonal", () => {
  it("joins the profile and the project profile and loads a valid plugin", async () => {
    const ws = gitRepo("shop");
    const h = home({ "profile.md": "Nói tiếng Việt.\n", "projects/shop/profile.md": "Dùng pnpm.", ...PLUGIN });
    const p = await loadPersonal(h, ws);
    expect(p.systemAppend).toBe("Nói tiếng Việt.\n\n## Project: shop\n\nDùng pnpm.");
    expect(p.project).toMatchObject({ name: "shop", lines: 1, loaded: true });
    expect(p.plugin).toMatchObject({ name: "me", skills: ["pr-flow", "verify"], loaded: true });
    expect(p.plugins).toEqual([path.join(h, "plugin")]);
    expect(p.warnings).toEqual([]);
  });

  it("refuses a profile holding a secret, warns on a long one, and skips a plugin without manifest", async () => {
    const long = Array.from({ length: PROFILE_MAX_LINES + 5 }, (_, i) => `- quy ước ${i}`).join("\n");
    const h = home({ "profile.md": `token: abcdefghijklmnopqrstu\n`, "projects/x/profile.md": long, "plugin/skills/a/SKILL.md": "x" });
    const ws = path.join(tmp("core-p-"), "x");
    mkdirSync(ws);
    const p = await loadPersonal(h, ws);
    expect(p.profile).toMatchObject({ loaded: false });
    expect(p.project).toMatchObject({ loaded: true, lines: PROFILE_MAX_LINES + 5 });
    expect(p.systemAppend).toContain("## Project: x");
    expect(p.systemAppend).not.toContain("token");
    expect(p.plugins).toEqual([]);
    expect(p.warnings).toHaveLength(3);
    expect(p.warnings.join("\n")).toMatch(/secret[\s\S]*dòng[\s\S]*plugin\.json/);
  });

  it("is empty without ~/.silence", async () => {
    const p = await loadPersonal(path.join(tmp("none-"), "missing"));
    expect(p).toMatchObject({ profile: null, project: null, plugin: null, plugins: [], warnings: [] });
    expect(p.systemAppend).toBeUndefined();
  });
});

describe("personal layer in sessions", () => {
  it("reads ~/.silence fresh for each session and reports it through profile.status", async () => {
    const started: StartOptions[] = [];
    const fake: Backend = {
      info: { id: "fake", version: "0", capabilities: {} as never },
      start: async (o) => {
        started.push(o);
        return { send: async () => {}, interrupt: async () => {}, close: async () => {} };
      },
    };
    const h = home({ "profile.md": "v1", ...PLUGIN });
    const core = createCoreWithSessions({ host: "test", dataDir: tmp("core-data-"), home: h, sessions: { backends: { claude: fake }, listExternal: async () => [], snapshot: async () => null } });
    const [a, b] = memoryPair();
    core.server.attach(a);
    const client = new RpcClient(b);
    const ws = tmp("core-ws-");
    const first = await client.call<{ personal: { profile: { loaded: boolean } } }>("session.create", { workspace: ws });
    expect(first.personal.profile.loaded).toBe(true);
    writeFileSync(path.join(h, "profile.md"), "v2");
    await client.call("session.create", { workspace: ws });
    expect(started.map((s) => s.systemAppend)).toEqual(["v1", "v2"]);
    await expect(client.call("profile.status", { workspace: ws })).resolves.toMatchObject({ home: h, plugin: { skills: ["pr-flow", "verify"] }, warnings: [] });
  });
});
