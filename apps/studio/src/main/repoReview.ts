// Roadmap 1.6: the core refuses to load a repo's own config (hooks, MCP servers, env, auth helpers,
// shell in slash commands) until the user approved that exact content. Main shows the list in a
// native dialog and answers for the renderer, which stays unchanged.

/** JSON-RPC error code of the core (`REPO_CONFIG_REVIEW` in packages/core). */
export const REPO_CONFIG_REVIEW = -32010;

export interface RepoItem {
  kind: string;
  file: string;
  name: string;
  detail: string;
}
export interface RepoReview {
  workspace: string;
  hash: string;
  items: RepoItem[];
}

/** The review attached to a core error, or null when the error is something else. */
export function reviewFromError(err: unknown): RepoReview | null {
  const e = err as { code?: unknown; data?: { review?: RepoReview } } | null;
  if (!e || e.code !== REPO_CONFIG_REVIEW) return null;
  const r = e.data?.review;
  return r && typeof r.hash === "string" && Array.isArray(r.items) ? r : null;
}

const KIND_VI: Record<string, string> = {
  hook: "Hook",
  mcp: "MCP server",
  env: "Biến môi trường",
  helper: "Lệnh trợ giúp",
  plugin: "Plugin",
  command: "Lệnh shell trong slash command/skill",
  invalid: "File lỗi",
};

const MAX_ROWS = 20;

export type ReviewChoice = "approve" | "ignore" | "cancel";

/**
 * Dialog text and buttons. `atCreate`: the session can still start without the repo config; in a
 * running session the only options are approve or stop this turn.
 */
export function reviewDialog(review: RepoReview, atCreate: boolean): { message: string; detail: string; buttons: string[]; choices: ReviewChoice[]; cancelId: number } {
  const rows = review.items.slice(0, MAX_ROWS).map((i) => `• ${KIND_VI[i.kind] ?? i.kind} — ${i.name} (${i.file})\n    ${i.detail}`);
  if (review.items.length > MAX_ROWS) rows.push(`… và ${review.items.length - MAX_ROWS} mục nữa`);
  const intro = atCreate
    ? "Cấu hình của repo này sẽ chạy các lệnh dưới đây ngoài các tool call, nên Risk Engine không duyệt từng lần được."
    : "Cấu hình repo vừa thay đổi. Các lệnh dưới đây sẽ chạy ngoài các tool call.";
  const detail = `${review.workspace}\n\n${intro}\n\n${rows.join("\n")}\n\nChỉ cho phép khi bạn tin repo này. Lần sau chỉ hỏi lại khi các mục này đổi.`;
  const choices: ReviewChoice[] = atCreate ? ["approve", "ignore", "cancel"] : ["approve", "cancel"];
  const label: Record<ReviewChoice, string> = {
    approve: "Cho phép",
    ignore: "Chạy không dùng cấu hình repo",
    cancel: "Huỷ",
  };
  return {
    message: atCreate ? "Duyệt cấu hình repo trước khi mở chat" : "Cấu hình repo đã thay đổi",
    detail,
    buttons: choices.map((c) => label[c]),
    choices,
    cancelId: choices.indexOf("cancel"),
  };
}

/** Error text for the renderer when the user cancels. */
export const REVIEW_CANCELLED = "Đã huỷ: cấu hình repo chưa được duyệt.";
