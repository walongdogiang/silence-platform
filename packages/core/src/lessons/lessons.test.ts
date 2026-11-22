import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { RpcClient } from "../api/jsonrpc.js";
import { memoryPair } from "../api/transport.js";
import { claudeOneShot } from "../backends/claude/oneShot.js";
import { createCoreWithSessions } from "../core.js";
import { applyLesson, lessonPrompt, lessonTargets, parseProposal, targetKind } from "./lessons.js";

const tmp = (p: string) => mkdtempSync(path.join(os.tmpdir(), p));
const write = (root: string, rel: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text);
};
const sh = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** ~/.silence as a git repo with a bare remote, like silence-home. */
function homeRepo() {
  const remote = tmp("l-remote-");
  sh(remote, "init", "-q", "--bare");
  const home = tmp("l-home-");
  sh(home, "init", "-q");
  sh(home, "config", "user.name", "t");
  sh(home, "config", "user.email", "t@t");
  write(home, "profile.md", "# Profile\n- Speak Vietnamese.\n");
  write(home, "plugin/skills/verify/SKILL.md", "---\nname: verify\n---\nRun checks.\n");
  write(home, "projects/shop/verify.yaml", "rules: []\n");
  sh(home, "add", ".");
  sh(home, "commit", "-q", "-m", "init");
  sh(home, "branch", "-M", "main");
  sh(home, "remote", "add", "origin", remote);
  sh(home, "push", "-q", "-u", "origin", "main");
  return { home, remote };
}

describe("lesson targets", () => {
  it("allow only personal files of this project, never permissions", () => {
    expect(targetKind("profile.md", "shop")).toBe("profile");
    expect(targetKind("projects/shop/profile.md", "shop")).toBe("project_profile");
    expect(targetKind("projects/shop/verify.yaml", "shop")).toBe("verify");
    expect(targetKind("plugin/skills/new-skill/SKILL.md", "shop")).toBe("skill");
    expect(targetKind("permissions.yaml", "shop")).toBeNull();
    expect(targetKind("projects/shop/permissions.yaml", "shop")).toBeNull();
    expect(targetKind("projects/other/profile.md", "shop")).toBeNull();
    expect(targetKind("plugin/skills/../../x/SKILL.md", "shop")).toBeNull();
    expect(targetKind("plugin/.claude-plugin/plugin.json", "shop")).toBeNull();
  });

  it("lists existing and missing files with their content", async () => {
    const { home } = homeRepo();
    const t = await lessonTargets(home, "shop");
    expect(t.map((x) => [x.file, x.exists])).toEqual([
      ["profile.md", true],
      ["projects/shop/profile.md", false],
      ["projects/shop/verify.yaml", true],
      ["plugin/skills/verify/SKILL.md", true],
    ]);
    expect(lessonPrompt("Always run tests", { user: "fix x", answer: "done" }, "shop", t)).toContain("--- projects/shop/profile.md (does not exist yet)");
  });
});

describe("parseProposal", () => {
  const targets = [{ file: "profile.md", kind: "profile" as const, content: "# Profile\n", exists: true }];
  it("reads fenced JSON, normalises the final newline and marks new files", () => {
    const text = '```json\n{"summary":"Run tests first","edits":[{"file":"profile.md","content":"# Profile\\n- Run tests first.","reason":"r"},{"file":"plugin/skills/tests-first/SKILL.md","content":"---\\nname: tests-first\\n---\\nx\\n","reason":"new"}]}\n```';
    const p = parseProposal(text, "shop", targets);
    expect(p.summary).toBe("Run tests first");
    expect(p.edits).toEqual([
      { file: "profile.md", kind: "profile", before: "# Profile\n", after: "# Profile\n- Run tests first.\n", reason: "r", isNew: false },
      expect.objectContaining({ file: "plugin/skills/tests-first/SKILL.md", kind: "skill", before: "", isNew: true }),
    ]);
    expect(p.warnings).toEqual([]);
  });

  it("drops disallowed, secret and unchanged edits with a warning", () => {
    const text = JSON.stringify({
      summary: "x",
      edits: [
        { file: "permissions.yaml", content: "allow: ['Bash(*)']" },
        { file: "profile.md", content: "token: abcdefghijklmnopqrstu" },
        { file: "projects/shop/profile.md", content: "" },
        { file: "~/.silence/profile.md", content: "# Profile\n" },
      ],
    });
    const p = parseProposal(text, "shop", targets);
    expect(p.edits).toEqual([]);
    expect(p.warnings).toEqual(["not allowed: permissions.yaml", "looks like it contains a secret: profile.md"]);
    expect(() => parseProposal("no json here", "shop", targets)).toThrow(/not JSON/);
  });
});

describe("applyLesson", () => {
  it("writes the accepted edits and a lesson note, commits only those files and pushes", async () => {
    const { home, remote } = homeRepo();
    write(home, "unrelated.txt", "dirty, not part of the lesson");
    const targets = await lessonTargets(home, "shop");
    const p = parseProposal(JSON.stringify({ summary: "Chạy test trước khi báo xong", edits: [{ file: "profile.md", content: "# Profile\n- Speak Vietnamese.\n- Run tests before saying done.\n", reason: "user asked" }] }), "shop", targets);
    const res = await applyLesson(home, "Luôn chạy test trước khi nói xong", { workspace: "D:/w/shop" }, p, p.edits, new Date("2026-11-22T10:00:00Z"));
    expect(res).toMatchObject({ written: ["profile.md"], lessonFile: "lessons/2026-11-22-chay-test-truoc-khi-bao-xong.md", pushed: true });
    expect(res.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(readFileSync(path.join(home, "profile.md"), "utf8")).toContain("Run tests before saying done.");
    expect(readFileSync(path.join(home, res.lessonFile), "utf8")).toContain("Luôn chạy test trước khi nói xong");
    expect(sh(home, "show", "--name-only", "--format=%s", "HEAD").split("\n").filter(Boolean)).toEqual(["lesson: Chạy test trước khi báo xong", "lessons/2026-11-22-chay-test-truoc-khi-bao-xong.md", "profile.md"]);
    expect(sh(home, "status", "--porcelain")).toBe("?? unrelated.txt");
    expect(sh(remote, "log", "-1", "--format=%s", "main")).toBe("lesson: Chạy test trước khi báo xong");
  });

  it("refuses when a file changed since the proposal", async () => {
    const { home } = homeRepo();
    const p = parseProposal(JSON.stringify({ summary: "x", edits: [{ file: "profile.md", content: "new\n" }] }), "shop", await lessonTargets(home, "shop"));
    write(home, "profile.md", "edited by hand\n");
    await expect(applyLesson(home, "x", {}, p, p.edits)).rejects.toThrow(/changed since the proposal/);
  });

  it("outside git it writes files only and says so", async () => {
    const home = tmp("l-plain-");
    const p = parseProposal(JSON.stringify({ summary: "x", edits: [{ file: "profile.md", content: "hi\n" }] }), "shop", await lessonTargets(home, "shop"));
    const res = await applyLesson(home, "x", {}, p, p.edits);
    expect(res).toMatchObject({ written: ["profile.md"], commit: null, pushed: false, note: expect.stringContaining("not a git repository") });
  });
});

describe("claudeOneShot", () => {
  it("runs without tools or project settings and returns the result text", async () => {
    let seen: Options | undefined;
    const res = await claudeOneShot("SYS", "PROMPT", {
      cwd: "C:/h",
      env: { PATH: "/bin", ANTHROPIC_API_KEY: "sk-x" },
      queryFn: async function* ({ options }) {
        seen = options;
        yield { type: "system", subtype: "init", model: "claude-haiku-5-5", apiKeySource: "none" };
        yield { type: "assistant", message: { content: [{ type: "text", text: "{}" }] } };
        yield { type: "result", subtype: "success", result: '{"summary":"s","edits":[]}', usage: { input_tokens: 3, output_tokens: 4 }, total_cost_usd: 0.001 };
      },
    });
    expect(res).toEqual({ text: '{"summary":"s","edits":[]}', usage: { inputTokens: 3, outputTokens: 4, usd: 0.001 }, model: "claude-haiku-5-5" });
    expect(seen).toMatchObject({ tools: [], settingSources: [], maxTurns: 1, model: "haiku", systemPrompt: "SYS", env: { PATH: "/bin" } });
  });

  it("refuses an API-key login", async () => {
    await expect(
      claudeOneShot("S", "P", {
        cwd: ".",
        queryFn: async function* () {
          yield { type: "system", subtype: "init", apiKeySource: "ANTHROPIC_API_KEY" };
        },
      }),
    ).rejects.toThrow(/not the subscription/);
  });
});

describe("lesson RPC", () => {
  it("proposes from one call, then applies only the accepted edits", async () => {
    const { home } = homeRepo();
    let prompt = "";
    const core = createCoreWithSessions({
      host: "test",
      dataDir: tmp("l-data-"),
      home,
      sessions: {
        backends: {},
        listExternal: async () => [],
        oneShot: async (_s, p, o) => {
          prompt = p;
          expect(o.model).toBe("sonnet");
          return {
            text: JSON.stringify({ summary: "Prefer pnpm", edits: [{ file: "projects/shop/profile.md", content: "Use pnpm.\n", reason: "a" }, { file: "profile.md", content: "# Profile\nchanged\n", reason: "b" }] }),
            usage: { inputTokens: 1, outputTokens: 1, usd: 0 },
            model: "claude-sonnet-5-5",
          };
        },
      },
    });
    const [a, b] = memoryPair();
    core.server.attach(a);
    const client = new RpcClient(b);
    const ws = path.join(tmp("l-ws-"), "shop");
    mkdirSync(ws);
    const prop = await client.call<{ lesson_id: string; edits: Array<{ file: string }>; summary: string }>("lesson.propose", { workspace: ws, text: "Dùng pnpm", user: "install x", answer: "ran npm install", model: "sonnet" });
    expect(prompt).toContain("Dùng pnpm");
    expect(prop.edits.map((e) => e.file)).toEqual(["projects/shop/profile.md", "profile.md"]);
    const res = await client.call<{ written: string[]; pushed: boolean }>("lesson.apply", { lesson_id: prop.lesson_id, accept: [0] });
    expect(res).toMatchObject({ written: ["projects/shop/profile.md"], pushed: true });
    expect(readFileSync(path.join(home, "profile.md"), "utf8")).not.toContain("changed");
    await expect(client.call("lesson.apply", { lesson_id: prop.lesson_id, accept: [0] })).rejects.toThrow(/unknown or expired/);
  });
});
