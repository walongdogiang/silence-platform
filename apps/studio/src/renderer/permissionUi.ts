import type { MsgKey, T } from "./i18n";
import type { Perm } from "./models";
import type { RiskTier, SandboxStatus } from "./types";

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

/** Chế độ quyền chọn được trong Settings. `autonomous` chỉ chọn được khi sandbox Ready. */
export type UiPermMode = "ask" | "balanced" | "autonomous";

export const PERM_MODES: { id: UiPermMode; label: MsgKey; desc: MsgKey }[] = [
  { id: "balanced", label: "perm.mode.balanced", desc: "perm.mode.balancedDesc" },
  { id: "ask", label: "perm.mode.ask", desc: "perm.mode.askDesc" },
];

export const PERM_MODE_KEY = "silence.permission.mode";

export function normalizePermMode(raw: unknown): UiPermMode {
  return raw === "ask" || raw === "autonomous" ? raw : "balanced";
}

/** `sandbox.status` đã biết và Ready. */
export function sandboxReady(s: SandboxStatus | null): boolean {
  return s?.state === "ready";
}

/** Dòng giải thích khi người dùng chọn Tự chủ mà sandbox không Ready (Engine chạy y như Cân bằng). */
export function autonomousFallbackNote(mode: UiPermMode, s: SandboxStatus | null, t: T): string | null {
  if (mode !== "autonomous" || s === null || s.state === "ready") return null;
  if (s.state === "degraded") return t("sandbox.banner.degraded", { reason: s.reason });
  if (s.state === "not_installed") return t("sandbox.banner.notInstalled");
  return t("sandbox.banner.unsupported");
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
