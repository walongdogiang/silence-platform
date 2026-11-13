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

/** Nhãn 2 nút nhớ; `null` khi Engine không cho nhớ (lệnh nguy hiểm, pipeline…). */
export function scopeLabels(perm: Perm | null, t: T): { session: string; workspace: string } | null {
  if (!perm) return null;
  const p = rememberPattern(perm);
  if (!p) return null;
  const what = patternText(perm, p);
  return { session: t("perm.allowSession", { what }), workspace: t("perm.allowWorkspace", { what }) };
}

/** Chế độ quyền chọn được trong Settings. `autonomous` chờ sandbox chặn mạng nên chưa chọn được. */
export type UiPermMode = "ask" | "balanced";

export const PERM_MODES: { id: UiPermMode; label: MsgKey; desc: MsgKey }[] = [
  { id: "balanced", label: "perm.mode.balanced", desc: "perm.mode.balancedDesc" },
  { id: "ask", label: "perm.mode.ask", desc: "perm.mode.askDesc" },
];

export const PERM_MODE_KEY = "silence.permission.mode";

export function normalizePermMode(raw: unknown): UiPermMode {
  return raw === "ask" ? "ask" : "balanced";
}

export function loadPermMode(): UiPermMode {
  try {
    return normalizePermMode(localStorage.getItem(PERM_MODE_KEY));
  } catch {
    return "balanced";
  }
}

export function savePermMode(mode: UiPermMode): void {
  try {
    localStorage.setItem(PERM_MODE_KEY, mode);
  } catch {
    /* localStorage có thể bị chặn: bỏ qua, lần sau dùng mặc định. */
  }
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
