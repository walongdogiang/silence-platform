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
export function contextTip(u: ContextUsage | null | undefined): string {
  if (!u) return "Show context usage";
  const approx = u.measured ? "" : "~";
  return `Context · ${approx}${fmtTok(u.used)} / ${fmtTok(u.window)} (${contextPct(u)}%)`;
}

export type UsageRow = { label: string; color: string; n: number };

export function usageRows(u: ContextUsage | null | undefined): UsageRow[] {
  const p = u?.parts;
  return [
    { label: "System prompt", color: "#9aa0a6", n: p?.system ?? 0 },
    { label: "Rules", color: "#4ccb91", n: p?.rules ?? 0 },
    { label: "Tool definitions", color: "#a78bfa", n: p?.tools ?? 0 },
    { label: "MCP tools", color: "#c084fc", n: p?.mcp_tools ?? 0 },
    { label: "Summarized conversation", color: "#e87979", n: p?.summarized ?? 0 },
    { label: "Conversation", color: "#a67c7c", n: p?.conversation ?? 0 },
  ];
}
