export const PROTOCOL_VERSION = "0.1.3";

export type DiffApplyParams = {
  session_id: string;
  path: string;
  after: string;
};

export type DiffRejectParams = {
  session_id: string;
  path: string;
};

export type SessionMode = "agent" | "plan" | "ask" | "debug" | "review" | "multitask";

/** Params of `session.prompt`. `context`: extra text the UI attaches (e.g. Output tail in Debug). */
export type PromptParams = { session_id: string; text: string; context?: string };
export type PermissionMode = "ask" | "allowlist" | "yolo";

export type RpcRequest = {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: unknown;
};

export type RpcResponse = {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: { code: number; message: string };
};

export type SessionEvent =
  | { type: "token"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_start"; call_id: string; name: string; input: unknown }
  | { type: "tool_end"; call_id: string; name: string; ok: boolean; output: string }
  | { type: "permission"; request_id: string; name: string; input: unknown; reason: string }
  | { type: "plan"; markdown: string }
  | { type: "mode_suggestion"; mode: SessionMode; reason: string }
  | { type: "diff"; path: string; before: string; after: string }
  | { type: "trace"; event: string; detail: unknown }
  | { type: "route"; task_class: string; model_id: string; reason: string }
  | { type: "cost"; input_tokens: number; output_tokens: number; usd: number }
  | { type: "terminal"; data: string }
  | { type: "done"; stop: string }
  | { type: "error"; message: string; error?: ErrorInfo };

export type ErrorCode =
  | "PROVIDER_CREDITS"
  | "PROVIDER_AUTH"
  | "PROVIDER_RATE"
  | "PROVIDER_UNAVAILABLE"
  | "NETWORK"
  | "TIMEOUT"
  | "UNKNOWN";

/** Lỗi lượt đã chuẩn hóa ở Engine. `detail` đã lọc secret + cắt ngắn. */
export type ErrorInfo = {
  code: ErrorCode | string;
  status?: number;
  retryable: boolean;
  detail: string;
};


export type ModelInfo = {
  id: string;
  label?: string;
  api_model?: string;
  tier: string;
  context_window: number;
  tools: boolean;
  vision: boolean;
};
