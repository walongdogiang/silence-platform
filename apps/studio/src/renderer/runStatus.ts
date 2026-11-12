import { fmtTok } from "./contextUsage";

/**
 * Đồng hồ + bộ đếm của lượt đang chạy (run pulse). Thuần, không React — spec: `docs/frontend/status.md`.
 * `cost` từ Engine phát mỗi model call; một lượt có nhiều call nên ở đây cộng dồn.
 */
export type RunMeter = {
  startedAt: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  /** User đã bấm Stop, đang chờ `done{stop:"abort"}`. */
  stopping: boolean;
};

export type RunPhase = "working" | "awaiting_permission" | "stopping";

export function startRun(now: number): RunMeter {
  return { startedAt: now, inputTokens: 0, outputTokens: 0, usd: 0, stopping: false };
}

export function addCost(
  m: RunMeter | null,
  ev: { input_tokens: number; output_tokens: number; usd: number },
): RunMeter | null {
  if (!m) return m;
  return {
    ...m,
    inputTokens: m.inputTokens + ev.input_tokens,
    outputTokens: m.outputTokens + ev.output_tokens,
    usd: m.usd + ev.usd,
  };
}

export function markStopping(m: RunMeter | null): RunMeter | null {
  return m && !m.stopping ? { ...m, stopping: true } : m;
}

/** Stop thắng permission: đã bấm dừng thì không còn "chờ bạn". */
export function runPhase(m: RunMeter | null, awaitingPermission: boolean): RunPhase {
  if (m?.stopping) return "stopping";
  if (awaitingPermission) return "awaiting_permission";
  return "working";
}

/** `45s`, `1m 12s`, `1h 3m` — dùng chung cho pulse live và "Worked for". */
export function formatDuration(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem ? `${min}m ${rem}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${hr}h ${m}m` : `${hr}h`;
}

const PHASE_LABEL: Record<RunPhase, string> = {
  working: "Working",
  awaiting_permission: "Waiting for approval",
  stopping: "Stopping…",
};

/** Dòng summary của lượt live: `Working · 1m 12s · 5.9K tokens`. Token = output (model sinh ra). */
export function pulseLabel(m: RunMeter | null, now: number, awaitingPermission: boolean): string {
  const phase = runPhase(m, awaitingPermission);
  if (!m) return phase === "working" ? "Working…" : PHASE_LABEL[phase];
  const parts = [PHASE_LABEL[phase], formatDuration(now - m.startedAt)];
  if (m.outputTokens > 0) parts.push(`${fmtTok(m.outputTokens)} tokens`);
  return parts.join(" · ");
}

/** Tooltip chi tiết: input/output/USD của lượt. */
export function pulseTip(m: RunMeter | null): string {
  if (!m) return "";
  const usd = m.usd > 0 ? ` · $${m.usd.toFixed(m.usd < 0.01 ? 4 : 2)}` : "";
  return `Lượt này: ${fmtTok(m.inputTokens)} input · ${fmtTok(m.outputTokens)} output${usd}`;
}
