import type { MsgKey, T } from "./i18n";
import type { Perm } from "./models";
import type { RiskTier } from "./types";

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
 * Permission modes (docs/security/permissions.md). Code names are the TS core's; main maps them to
 * the Rust Engine's `ask` / `balanced` when the core is off. Ask (read-only) and Bypass need the core.
 */
export type UiPermMode = "ask" | "manual" | "accept_edits" | "auto" | "bypass";

export const PERM_MODES: { id: UiPermMode; label: MsgKey; desc: MsgKey }[] = [
  { id: "ask", label: "perm.mode.ask", desc: "perm.mode.askDesc" },
  { id: "manual", label: "perm.mode.manual", desc: "perm.mode.manualDesc" },
  { id: "accept_edits", label: "perm.mode.acceptEdits", desc: "perm.mode.acceptEditsDesc" },
  { id: "auto", label: "perm.mode.auto", desc: "perm.mode.autoDesc" },
  { id: "bypass", label: "perm.mode.bypass", desc: "perm.mode.bypassDesc" },
];

export const PERM_MODE_KEY = "silence.permission.mode";
export const BYPASS_ENABLED_KEY = "silence.permission.bypassEnabled";
export const BYPASS_ACK_KEY = "silence.permission.bypassAck";

/**
 * Stored value → mode. Legacy: `balanced` / `autonomous` → Auto, `allowlist` → Manual, and a stored
 * `ask` (old "Cautious") is the new Ask (read-only), as decided for this step. Anything else → Auto.
 */
export function normalizePermMode(raw: unknown): UiPermMode {
  if (raw === "ask" || raw === "manual" || raw === "accept_edits" || raw === "auto" || raw === "bypass") return raw;
  if (raw === "allowlist") return "manual";
  return "auto";
}

/** Whether `mode` can be chosen now: Ask and Bypass need the core; Bypass also needs the Settings switch. */
export function permModeAvailable(mode: UiPermMode, coreOn: boolean, bypassEnabled: boolean): boolean {
  if (mode === "ask") return coreOn;
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
