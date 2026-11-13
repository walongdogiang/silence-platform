import type { T } from "./i18n";
import type { ContextUsage } from "./types";

/** Engine tự tóm tắt lịch sử khi đạt 70% (`compact_if_needed`). */
export const COMPACT_AT = 70;

export function fmtTok(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function contextPct(u: ContextUsage | null | undefined): number {
  if (!u || u.window <= 0) return 0;
  return Math.min(100, Math.round((u.used / u.window) * 100));
}

/** ok < 70% (ngưỡng tự tóm tắt) ≤ warn < 90% ≤ full. */
export function contextLevel(pct: number): "ok" | "warn" | "full" {
  if (pct >= 90) return "full";
  if (pct >= COMPACT_AT) return "warn";
  return "ok";
}

/** `~` khi số là ước lượng (chưa có lượt nào provider báo số thật). */
export function contextTip(u: ContextUsage | null | undefined, t: T): string {
  if (!u) return t("ctx.show");
  const approx = u.measured ? "" : "~";
  return `Context · ${approx}${fmtTok(u.used)} / ${fmtTok(u.window)} (${contextPct(u)}%)`;
}

export type UsageRow = { id: string; label: string; color: string; n: number };

export function usageRows(u: ContextUsage | null | undefined, t: T): UsageRow[] {
  const p = u?.parts;
  return [
    { id: "system", label: t("ctx.system"), color: "#9aa0a6", n: p?.system ?? 0 },
    { id: "rules", label: t("ctx.rules"), color: "#4ccb91", n: p?.rules ?? 0 },
    { id: "tools", label: t("ctx.tools"), color: "#a78bfa", n: p?.tools ?? 0 },
    { id: "mcp_tools", label: t("ctx.mcpTools"), color: "#c084fc", n: p?.mcp_tools ?? 0 },
    { id: "summarized", label: t("ctx.summarized"), color: "#e87979", n: p?.summarized ?? 0 },
    { id: "conversation", label: t("ctx.conversation"), color: "#a67c7c", n: p?.conversation ?? 0 },
  ];
}
