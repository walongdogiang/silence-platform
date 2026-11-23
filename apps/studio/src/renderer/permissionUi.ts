import type { MsgKey, T } from "./i18n";
import type { Perm } from "./models";
import type { PermAnswer, RiskLevel, RiskTier } from "./types";

/** Phạm vi một lần duyệt: `once` chỉ lần này, `session` tới hết phiên (bộ nhớ), `workspace` ghi vào `.silence/permissions.json`. */
export type PermScope = "once" | "session" | "workspace";

/** Nhãn badge theo tầng rủi ro (docs/security/permissions.md). */
export function tierBadge(tier: RiskTier | undefined, t: T): { label: string; cls: string } {
  switch (tier) {
    case "block":
      return { label: t("perm.tier.block"), cls: "block" };
    case "logged":
      return { label: t("perm.tier.logged"), cls: "logged" };
    case "auto":
      return { label: t("perm.tier.auto"), cls: "auto" };
    default:
      return { label: t("perm.tier.ask"), cls: "ask" };
  }
}

/** Mẫu Engine cho phép nhớ (`npm install *`, `src/**`); không có = lần này thôi, không nhớ được. */
export function rememberPattern(perm: Perm | null): string | null {
  return perm?.risk?.pattern ?? null;
}

function patternText(perm: Perm, pattern: string): string {
  return perm.name === "shell" ? `"${pattern}"` : pattern;
}

/** Host chưa có trong allowlist mà thẻ hỏi (lệnh mạng ở chế độ Tự chủ). */
export function permHosts(perm: Perm | null): string[] {
  return perm?.risk?.hosts ?? [];
}

/** Thẻ leo thang (bị chặn nhiều lần liền): Engine đặt `risk.escalation`. */
export function permEscalation(perm: Perm | null) {
  return perm?.risk?.escalation ?? null;
}

/** `a.io, b.io +2` — danh sách host gọn cho nhãn nút. */
export function hostsText(hosts: string[], max = 2): string {
  if (hosts.length <= max) return hosts.join(", ");
  return `${hosts.slice(0, max).join(", ")} +${hosts.length - max}`;
}

/** Nhãn 2 nút nhớ; `null` khi Engine không cho nhớ (lệnh nguy hiểm, pipeline…). */
export function scopeLabels(perm: Perm | null, t: T): { session: string; workspace: string } | null {
  if (!perm) return null;
  const hosts = permHosts(perm);
  if (hosts.length) {
    const what = hostsText(hosts);
    return { session: t("perm.allowHostSession", { what }), workspace: t("perm.allowHostWorkspace", { what }) };
  }
  const p = rememberPattern(perm);
  if (!p) return null;
  const what = patternText(perm, p);
  return { session: t("perm.allowSession", { what }), workspace: t("perm.allowWorkspace", { what }) };
}

/**
 * Permission modes (docs/security/permissions.md), Auto first (the default). Code names are the TS
 * core's; main maps them to the Rust Engine's `ask` / `balanced` when the core is off. Bypass needs the
 * core. Read-only "Ask" is a work mode (`modes.ts`), not a permission mode.
 */
export type UiPermMode = "auto" | "manual" | "accept_edits" | "bypass";

export const PERM_MODES: { id: UiPermMode; label: MsgKey; desc: MsgKey }[] = [
  { id: "auto", label: "perm.mode.auto", desc: "perm.mode.autoDesc" },
  { id: "manual", label: "perm.mode.manual", desc: "perm.mode.manualDesc" },
  { id: "accept_edits", label: "perm.mode.acceptEdits", desc: "perm.mode.acceptEditsDesc" },
  { id: "bypass", label: "perm.mode.bypass", desc: "perm.mode.bypassDesc" },
];

/**
 * "Always allow" button text in plain words for the rule the core offers (`ruleFor` in
 * packages/core/src/permissions/rules.ts): `Edit(**)` → "Always allow edits in this project". The exact
 * rule stays in the tooltip.
 */
export function alwaysAllowText(rule: string, t: T): string {
  let m: RegExpMatchArray | null;
  if (rule === "Edit(**)") return t("perm.always.editAll");
  if ((m = rule.match(/^Edit\((.+)\/\*\*\)$/))) return t("perm.always.editIn", { path: `${m[1]}/` });
  if (rule === "Read(**)") return t("perm.always.readAll");
  if ((m = rule.match(/^Read\((.+)\/\*\*\)$/))) return t("perm.always.readIn", { path: `${m[1]}/` });
  if ((m = rule.match(/^WebFetch\(domain:(.+)\)$/))) return t("perm.always.domain", { domain: m[1]! });
  if ((m = rule.match(/^mcp__(.+?)__(.+)$/))) return t("perm.always.mcpTool", { tool: m[2]!, server: m[1]! });
  if ((m = rule.match(/^mcp__(.+)$/))) return t("perm.always.mcp", { server: m[1]! });
  if ((m = rule.match(/^\w+\((.+):\*\)$/))) return t("perm.always.cmdPrefix", { cmd: m[1]! });
  if ((m = rule.match(/^\w+\((.+)\)$/))) return t("perm.always.cmd", { cmd: m[1]! });
  return t("perm.always.cmd", { cmd: rule }); // a repo verify command: the exact command line
}

/** How the TS core card is drawn: one line (C) or the full card (B). */
export type PermLayout = "compact" | "full";

/**
 * One line only for a low-risk shell command the core lets us remember: not red, has `allow_rule`,
 * one line of at most 80 characters, at most one reason, no hosts, no file change to review, no countdown.
 */
export function permLayout(perm: Perm): PermLayout {
  const r = perm.risk;
  if (!r?.level || r.level === "danger" || r.level === "hard_block") return "full";
  if (!r.allow_rule || perm.preview || r.hosts?.length || r.escalation || r.countdown_s) return "full";
  const c = (perm.input as { command?: unknown } | null | undefined)?.command;
  if (typeof c !== "string") return "full";
  const cmd = c.trim();
  if (!cmd || cmd.includes("\n") || cmd.length > 80) return "full";
  const codes = new Set(r.reasons.length ? r.reasons.map((x) => x.code) : (r.codes ?? []));
  return codes.size > 1 ? "full" : "compact";
}

/**
 * Key on a TS core card → answer. Never while typing (input/textarea/contenteditable) or busy. Enter
 * allows once, except on red cards and on a focused button (the button handles its own Enter); 1/2
 * pick the scope when the card offers "Always allow"; Esc denies.
 */
export function permKeyAction(
  key: string,
  o: { level: RiskLevel; hasRule: boolean; inText: boolean; onButton: boolean; busy: boolean; mods?: boolean },
): PermAnswer | null {
  if (o.inText || o.busy || o.mods) return null;
  if (key === "Escape") return "deny";
  if (key === "Enter") return o.level === "danger" || o.level === "hard_block" || o.onButton ? null : "allow_once";
  if (o.hasRule && key === "1") return "allow_once";
  if (o.hasRule && key === "2") return "allow_always";
  return null;
}

/** Short name of what a card asked for, for the receipt line: first command line, the file, or the tool. */
export function permTarget(perm: Perm): string {
  const c = (perm.input as { command?: unknown } | null | undefined)?.command;
  const raw = typeof c === "string" ? (c.trim().split(/\r?\n/)[0] ?? "") : (perm.preview?.path ?? perm.name);
  const one = raw.replace(/\s+/g, " ").trim();
  return one.length > 72 ? `${one.slice(0, 71)}…` : one;
}

export const PERM_MODE_KEY = "silence.permission.mode";
export const BYPASS_ENABLED_KEY = "silence.permission.bypassEnabled";
export const BYPASS_ACK_KEY = "silence.permission.bypassAck";

/**
 * Stored value → mode. Legacy: `balanced` / `autonomous` → Auto, `allowlist` → Manual, and a stored
 * `ask` (the old read-only permission mode) → Auto, the chat opening in the Ask work mode instead
 * (`takeLegacyAskMode`). Anything else → Auto.
 */
export function normalizePermMode(raw: unknown): UiPermMode {
  if (raw === "manual" || raw === "accept_edits" || raw === "auto" || raw === "bypass") return raw;
  if (raw === "allowlist") return "manual";
  return "auto";
}

/** Whether `mode` can be chosen now: Bypass needs the core and the Settings switch. */
export function permModeAvailable(mode: UiPermMode, coreOn: boolean, bypassEnabled: boolean): boolean {
  if (mode === "bypass") return coreOn && bypassEnabled;
  return true;
}

/** The mode sessions actually get: an unavailable choice falls back to Auto. */
export function effectivePermMode(mode: UiPermMode, coreOn: boolean, bypassEnabled: boolean): UiPermMode {
  return permModeAvailable(mode, coreOn, bypassEnabled) ? mode : "auto";
}

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* localStorage có thể bị chặn: bỏ qua, lần sau dùng mặc định. */
  }
}

export function loadPermMode(): UiPermMode {
  return normalizePermMode(readKey(PERM_MODE_KEY));
}

export function savePermMode(mode: UiPermMode): void {
  writeKey(PERM_MODE_KEY, mode);
}

/**
 * One-time move of a stored legacy `ask` permission mode: stores Auto and returns true, so the caller
 * opens the chat in the Ask work mode (same read-only behaviour as before).
 */
export function takeLegacyAskMode(): boolean {
  if (readKey(PERM_MODE_KEY) !== "ask") return false;
  writeKey(PERM_MODE_KEY, "auto");
  return true;
}

/** "Allow Bypass permissions mode" switch in Settings (off by default). */
export function loadBypassEnabled(): boolean {
  return readKey(BYPASS_ENABLED_KEY) === "1";
}

export function saveBypassEnabled(on: boolean): void {
  writeKey(BYPASS_ENABLED_KEY, on ? "1" : "0");
}

/** The user already confirmed the first-time Bypass warning. */
export function bypassAcknowledged(): boolean {
  return readKey(BYPASS_ACK_KEY) === "1";
}

export function acknowledgeBypass(): void {
  writeKey(BYPASS_ACK_KEY, "1");
}

/** Dòng `trace` do Engine gửi khi chặn một lệnh (`policy.blocked`) → bước "Đã chặn" trong chat. */
export function blockedStep(detail: unknown): { verb: string; detail: string } | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  const title = typeof d.title === "string" ? d.title : "";
  const code = typeof d.code === "string" ? d.code : "";
  if (!title && !code) return null;
  return { verb: "Blocked", detail: title || code };
}
