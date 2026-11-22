// Permission modes (docs/security/permissions.md): Ask · Manual · Accept edits · Auto (default) ·
// Bypass permissions. The Risk Engine labels a call (level + reason codes); the mode turns that label
// into allow / ask / deny. User rules (permissions/rules.ts) are applied before the mode by the caller.
import type { ToolCall } from "../backends/types.js";
import type { Verdict } from "../risk/classify.js";
import { policy, TIER_ORDER } from "../risk/policy.js";

export type PermMode = "ask" | "manual" | "accept_edits" | "auto" | "bypass";
export const PERM_MODES: PermMode[] = ["ask", "manual", "accept_edits", "auto", "bypass"];
export const DEFAULT_MODE: PermMode = "auto";

/**
 * Read a stored or requested mode. Legacy values: `balanced` → `auto`, `allowlist` → `manual`,
 * `autonomous` → `auto`, and a stored `ask` is the NEW Ask (read-only). `yolo` is never accepted.
 */
export function normalizeMode(raw: unknown): PermMode | null {
  if (raw === "yolo") return null;
  if (typeof raw === "string" && (PERM_MODES as string[]).includes(raw)) return raw as PermMode;
  if (raw === "allowlist") return "manual";
  return DEFAULT_MODE; // balanced, autonomous, missing, unknown
}

/** Display level of a call: none (safe), yellow (caution), red (danger), or refused outright. */
export type Level = "safe" | "caution" | "danger" | "hard_block";

export function levelOf(v: Verdict): Level {
  if (v.codes.some((c) => policy().hard_block.includes(c))) return "hard_block";
  if (v.tier === "block") return "danger";
  if (v.tier === "ask") return "caution";
  return "safe";
}

export type ModeAction =
  | { kind: "allow" }
  | { kind: "ask"; countdownSec?: number }
  | { kind: "deny"; reason: string; by: "mode" | "hard_block" };

/** Seconds before a Bypass countdown question refuses on its own. */
export const BYPASS_COUNTDOWN_SEC = 30;

export const ASK_MODE_REASON =
  "Ask mode is read-only: only reading, searching and read-only shell commands are available. Do not retry; answer from what you can read, and tell the user to switch to Manual or Auto if a change is needed.";

/** In Ask mode: reading, searching, read-only shell, and the agent's own bookkeeping. */
export function askModeAllows(call: ToolCall, v: Verdict): boolean {
  switch (call.kind) {
    case "read":
    case "search":
    case "internal":
    case "plan":
    case "agent":
      return true;
    case "shell":
      return v.codes.length > 0 && v.codes.every((c) => policy().read_only_shell.includes(c));
    default:
      return false;
  }
}

/** What `mode` does with a call the Risk Engine labelled `v` (no user rule matched). */
export function modeAction(mode: PermMode, call: ToolCall, v: Verdict): ModeAction {
  const level = levelOf(v);
  if (mode === "ask") return askModeAllows(call, v) ? { kind: "allow" } : { kind: "deny", reason: ASK_MODE_REASON, by: "mode" };
  if (mode === "bypass") {
    if (v.codes.some((c) => policy().bypass_countdown.includes(c))) return { kind: "ask", countdownSec: BYPASS_COUNTDOWN_SEC };
    if (v.codes.some((c) => policy().bypass_ask.includes(c))) return { kind: "ask" };
    return { kind: "allow" };
  }
  if (level === "hard_block") return { kind: "deny", reason: v.blockMessage(), by: "hard_block" };
  const readOnly = TIER_ORDER[v.tier] <= TIER_ORDER.auto;
  switch (mode) {
    case "manual":
      return readOnly ? { kind: "allow" } : { kind: "ask" };
    case "accept_edits":
      return readOnly || ((call.kind === "write" || call.kind === "edit") && level === "safe") ? { kind: "allow" } : { kind: "ask" };
    case "auto":
      return level === "safe" ? { kind: "allow" } : { kind: "ask" };
  }
}

/** Codes that mean the call reaches the network. */
const NETWORK = new Set(["NET_ACCESS", "PKG_INSTALL", "PKG_EXEC", "PKG_PUBLISH", "GIT_NETWORK", "GH_READ", "GH_WRITE", "GH_MERGE", "NET_DOWNLOAD_EXEC", "SECRET_EXFIL", "MCP_CALL", "GIT_PUSH_DEFAULT"]);
const DELETES = new Set(["FS_DELETE", "FS_DELETE_SYSTEM", "GIT_DESTRUCTIVE", "DISK_DESTROY"]);
const ADMIN = new Set(["SYSTEM_CHANGE", "DISK_DESTROY"]);
const OUTSIDE = new Set(["FS_OUTSIDE_WS", "FS_DELETE_SYSTEM", "SYSTEM_CHANGE", "DISK_DESTROY", "SECRET_EXFIL"]);

/** Wire shape (snake_case, like the rest of the protocol). */
export interface Impact {
  network: boolean;
  outside_workspace: boolean;
  deletes: boolean;
  admin: boolean;
  /** A per-turn git snapshot can undo it (changes stay inside the workspace, nothing leaves the machine). */
  undoable: boolean;
}

export function impactOf(v: Verdict, call: ToolCall, hasSnapshot: boolean): Impact {
  const has = (s: Set<string>) => v.codes.some((c) => s.has(c)) || (s === NETWORK && call.kind === "fetch");
  const network = has(NETWORK);
  const outsideWorkspace = has(OUTSIDE);
  return { network, outside_workspace: outsideWorkspace, deletes: has(DELETES), admin: has(ADMIN), undoable: hasSnapshot && !network && !outsideWorkspace };
}
