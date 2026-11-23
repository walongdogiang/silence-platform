import type { RunPhase } from "../runStatus";

/**
 * Icon đầu dòng cho mọi thứ đang chạy (lượt, bước, suy nghĩ, chat trong lịch sử) — docs/frontend/status.md → Run indicator.
 * - `working`: sao 4 tia màu `--info` xoay đều 1,5s mỗi nửa vòng (CSS transform, không timer JS).
 * - `awaiting_permission`: chấm copper **đứng yên** — copper chỉ dành cho "cần bạn làm gì đó".
 * - `stopping`: sao chậm lại (4s) và mờ đi.
 * Icon chỉ để trang trí (`aria-hidden`); trạng thái luôn có nhãn chữ đi kèm.
 */
export function RunIndicator(props: { phase?: RunPhase; size?: "sm" | "md"; className?: string }) {
  const phase = props.phase ?? "working";
  const cls = `run-ind ${props.size ?? "md"} ${phase}${props.className ? ` ${props.className}` : ""}`;
  if (phase === "awaiting_permission") {
    return (
      <span className={cls} aria-hidden="true">
        <span className="run-ind-dot" />
      </span>
    );
  }
  return (
    <span className={cls} aria-hidden="true">
      <svg viewBox="0 0 16 16" className="run-ind-star">
        <path d="M8 2v12M2 8h12M3.76 3.76l8.48 8.48M12.24 3.76l-8.48 8.48" />
      </svg>
    </span>
  );
}
