import { useSyncExternalStore } from "react";
import { useT, type T } from "../i18n";

/**
 * Một đồng hồ chung cho mọi `MessageTime` (một interval cho cả chat, không phải mỗi tin một cái):
 * 30 giây một nhịp, dừng khi không còn tin nào hiển thị.
 */
const TICK_MS = 30_000;
let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(fn);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const useNow = () =>
  useSyncExternalStore(
    subscribe,
    () => now,
    () => Date.now(),
  );

/**
 * Giờ tương đối kiểu Claude: "vừa xong", "28 phút trước", "3 giờ trước", "hôm qua", "2 ngày trước";
 * quá 7 ngày thì ngày tháng ("18 thg 11"; năm khác kèm năm).
 */
export function formatAgo(at: number, current: number, locale: string, t: T): string {
  const sec = Math.round((current - at) / 1000);
  if (sec < 45) return t("chat.justNow");
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const min = Math.round(sec / 60);
  if (min < 60) return rtf.format(-min, "minute");
  const hr = Math.round(min / 60);
  if (hr < 24) return rtf.format(-hr, "hour");
  const day = Math.round(hr / 24);
  if (day <= 7) return rtf.format(-day, "day");
  const d = new Date(at);
  return d.toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() === new Date(current).getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Ngày giờ đầy đủ cho tooltip: "Nov 20, 2026, 3:03 PM" / "20 thg 11, 2026 15:03". */
export function formatFull(at: number, locale: string): string {
  try {
    return new Date(at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return new Date(at).toISOString();
  }
}

/** `<time>` chữ nhỏ mờ, tự cập nhật; tooltip là ngày giờ đầy đủ. */
export function MessageTime(props: { at: number; className?: string }) {
  const t = useT();
  const locale = t("locale");
  const current = useNow();
  return (
    <time
      className={`msg-time${props.className ? ` ${props.className}` : ""}`}
      dateTime={new Date(props.at).toISOString()}
      title={formatFull(props.at, locale)}
    >
      {formatAgo(props.at, Math.max(current, props.at), locale, t)}
    </time>
  );
}
