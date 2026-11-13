import type { SessionMode } from "./modes";
import type { ErrorInfo, PermissionRisk } from "./types";
export type CheckpointFile = { path: string; before: string; after: string };

export type ChatLine =
  /**
   * `images`: data URL ảnh dán (trong bộ nhớ, không vào localStorage); `imageIds`: key ảnh trong
   * IndexedDB (`imageStore.ts`) để mở lại thread; `imageCount`: số ảnh, dùng khi không lấy lại được.
   */
  | { kind: "user"; text: string; images?: string[]; imageIds?: string[]; imageCount?: number }
  | { kind: "token"; text: string }
  | { kind: "tool"; name: string; output: string }
  /**
   * Route of a model call. `slot` set on Auto (`frontier|strong|small`); `model` = short name;
   * `purpose` = `agent`, `plan`, `title`, `subagent:explore`…; `reason` for the tooltip.
   */
  | {
      kind: "route";
      text: string;
      model?: string;
      slot?: string;
      escalated?: boolean;
      reason?: string;
      purpose?: string;
    }
  /** Engine gợi ý chuyển mode (vd. Ask → Agent) để áp dụng thay đổi vừa đề xuất. */
  | { kind: "mode_suggest"; mode: SessionMode; reason: string; prompt: string }
  | { kind: "sys"; text: string }
  | { kind: "error"; message: string; info?: ErrorInfo }
  | { kind: "worked"; ms: number; at: number }
  | {
      kind: "narrate";
      verb: string;
      detail?: string;
      /** Bước đọc file: gộp Read liên tiếp cùng file (`mergeReadSteps`). */
      file?: string;
      ranges?: [number, number | null][];
      /** legacy persist */ text?: string;
    }
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
  /** auto = cắt từ prompt (tạm); ai = Engine sinh (`chat.title`); user = đổi tên tay. ai/user không bị ghi đè. */
  titleSource?: "auto" | "ai" | "user";
};

/** `applied`: Engine already wrote the file (Balanced) — card offers Undo, not Apply/Reject. */
export type Diff = { path: string; before: string; after: string; applied?: boolean };
/** `risk`: tier + reasons from the Risk Engine (docs/security/permissions.md). */
export type Perm = { request_id: string; name: string; input: unknown; reason: string; risk?: PermissionRisk };

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
