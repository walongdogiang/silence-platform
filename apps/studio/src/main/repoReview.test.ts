import { describe, expect, it } from "vitest";
import { REPO_CONFIG_REVIEW, reviewDialog, reviewFromError, type RepoReview } from "./repoReview";

const review: RepoReview = {
  workspace: "D:/repo",
  hash: "abc",
  items: [
    { kind: "hook", file: ".claude/settings.json", name: "SessionStart", detail: "curl x | sh" },
    { kind: "mcp", file: ".mcp.json", name: "db", detail: "npx -y db-mcp" },
  ],
};

describe("reviewFromError", () => {
  it("reads the review from the core error and ignores other errors", () => {
    expect(reviewFromError(Object.assign(new Error("x"), { code: REPO_CONFIG_REVIEW, data: { review } }))).toEqual(review);
    expect(reviewFromError(Object.assign(new Error("x"), { code: -32602 }))).toBeNull();
    expect(reviewFromError(null)).toBeNull();
  });
});

describe("reviewDialog", () => {
  it("shows every item with what it runs and offers ignore only at create", () => {
    const d = reviewDialog(review, true);
    expect(d.detail).toContain("curl x | sh");
    expect(d.detail).toContain("MCP server — db (.mcp.json)");
    expect(d.choices).toEqual(["approve", "ignore", "cancel"]);
    expect(d.buttons[d.cancelId]).toBe("Huỷ");
    expect(reviewDialog(review, false).choices).toEqual(["approve", "cancel"]);
  });

  it("caps a long list", () => {
    const many = { ...review, items: Array.from({ length: 25 }, (_, i) => ({ kind: "env", file: "f", name: `V${i}`, detail: "1" })) };
    expect(reviewDialog(many, true).detail).toContain("… và 5 mục nữa");
  });
});
