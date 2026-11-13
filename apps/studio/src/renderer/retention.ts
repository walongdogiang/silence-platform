import type { ChatThread } from "./models";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Settings → Data → keep chat history. Threads last touched before the cutoff go, except
 * pinned ones and the one open now. `days = 0` keeps everything.
 */
export function pruneThreads(threads: ChatThread[], days: number, now: number, activeId = ""): {
  kept: ChatThread[];
  removed: ChatThread[];
} {
  if (!days) return { kept: threads, removed: [] };
  const cutoff = now - days * DAY_MS;
  const kept: ChatThread[] = [];
  const removed: ChatThread[] = [];
  for (const t of threads) {
    (t.pinned || t.id === activeId || t.updatedAt >= cutoff ? kept : removed).push(t);
  }
  return { kept, removed };
}

/** Engine session ids the Engine must keep when it prunes (pinned chats). */
export function pinnedSessionIds(threads: ChatThread[]): string[] {
  return threads.filter((t) => t.pinned && t.sessionId).map((t) => t.sessionId);
}
