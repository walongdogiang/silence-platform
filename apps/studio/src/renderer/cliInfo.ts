/** Display helpers for `providers.cli_info` (Claude CLI card + Source row). */

const PLAN: Record<string, string> = { pro: "Pro", max: "Max", team: "Team", enterprise: "Enterprise", free: "Free" };

export function planLabel(plan: string): string {
  const p = plan.trim().toLowerCase();
  if (!p) return "—";
  return PLAN[p] ?? p.charAt(0).toUpperCase() + p.slice(1);
}

export function authLabel(method: string, provider: string): string {
  const m = method.trim().toLowerCase();
  const via =
    provider === "bedrock" ? " (Amazon Bedrock)" : provider === "vertex" ? " (Google Vertex AI)" : provider === "foundry" ? " (Microsoft Foundry)" : "";
  if (m === "claude.ai") return `Claude account${via}`;
  if (m.includes("api") || m.includes("key")) return `API key${via}`;
  if (m.includes("token")) return `Long-lived token${via}`;
  return (method || "—") + via;
}

/** True when this login is a personal claude.ai subscription (internal use only in 5ilence). */
export function isSubscriptionLogin(method: string): boolean {
  return method.trim().toLowerCase() === "claude.ai";
}

/** `{ text, warn }` for the login expiry; warn when under 7 days or past. */
export function expiryNote(expiresAt: string, now: Date = new Date()): { text: string; warn: boolean } | null {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return null;
  const days = Math.floor((t - now.getTime()) / 86_400_000);
  const date = new Date(t).toLocaleDateString();
  if (t <= now.getTime()) return { text: `Expired on ${date}`, warn: true };
  if (days < 1) return { text: `Expires today (${date})`, warn: true };
  return { text: `Expires ${date} (in ${days} day${days === 1 ? "" : "s"})`, warn: days < 7 };
}

/** Short form for the composer Source row: `alexander.long@x.com` → `alexand…@x.com`. */
export function shortEmail(email: string, max = 7): string {
  const at = email.indexOf("@");
  if (at < 0) return email.length > max + 3 ? `${email.slice(0, max)}…` : email;
  const local = email.slice(0, at);
  return (local.length > max ? `${local.slice(0, max)}…` : local) + email.slice(at);
}

export function fmtUsd(n: number): string {
  if (n === 0) return "$0";
  return n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`;
}
