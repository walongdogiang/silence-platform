export type CheckpointFile = { path: string; before: string; after: string };

export type ChatLine =
  | { kind: "user"; text: string }
  | { kind: "token"; text: string }
  | { kind: "tool"; name: string; output: string }
  | { kind: "route"; text: string }
  | { kind: "sys"; text: string }
  | { kind: "worked"; ms: number; at: number }
  | { kind: "narrate"; verb: string; detail?: string; /** legacy persist */ text?: string }
  | { kind: "thought"; ms?: number; brief: string; body?: string }
  | { kind: "checkpoint"; id: string; at: number; label: string; files: CheckpointFile[] };

export type ChatThread = {
  id: string;
  sessionId: string;
  workspace: string;
  title: string;
  preview: string;
  updatedAt: number;
  lines: ChatLine[];
  /** Thread gốc nếu đây là Fork Chat */
  forkedFromId?: string;
};

export type Diff = { path: string; before: string; after: string };
export type Perm = { request_id: string; name: string; input: unknown; reason: string };

export type ShellView = "chat" | "hidden";

export type NavId =
  | "home"
  | "projects"
  | "initiatives"
  | "tasks"
  | "agents"
  | "knowledge"
  | "decisions"
  | "tests"
  | "deploy"
  | "services"
  | "network"
  | "settings";

export type CenterTab = "chat" | "plan" | "tasks" | "files" | "tests" | "decisions" | "logs";

export const LIVE_NAVS: NavId[] = ["projects", "settings", "network"];
export const LIVE_TABS: CenterTab[] = ["chat", "plan", "files", "logs"];
