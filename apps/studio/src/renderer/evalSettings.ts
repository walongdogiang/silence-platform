import type { EvalSettings } from "./types";

/**
 * Tab **Cấu hình** của trang Evals: hàm thuần cho `evals/config.yaml`. Engine kiểm lại tất cả
 * (`eval_config.rs`); ở đây chỉ để báo lỗi sớm và tính số hiển thị.
 */

/** Số lượt Đêm và Tuần trong một tháng (evals/README.md → Lịch chạy và ngân sách). */
export const NIGHTLY_RUNS_PER_MONTH = 26;
export const WEEKLY_RUNS_PER_MONTH = 4;
/** Trần mỗi profile tối đa nếu Engine chưa gửi giá trị thật (USD). */
export const DEFAULT_MAX_CAP_USD = 20;

/** Tổng trần chi một lượt Tuần (ba bước). */
export function weeklyCap(s: EvalSettings): number {
  const w = s.profiles.weekly;
  return w.v0_max_cost + w.modes_max_cost + w.auto_max_cost;
}

/**
 * Trần chi tối đa mỗi tháng của CI theo lịch (0 khi CI tắt). Là mức trần, không phải chi dự kiến:
 * mỗi lượt dừng khi chạm trần và thường chi ít hơn nhiều.
 */
export function ciMonthlyCap(s: EvalSettings): number {
  if (!s.ci.enabled) return 0;
  const nightly = s.ci.nightly ? s.profiles.nightly.max_cost * NIGHTLY_RUNS_PER_MONTH : 0;
  const weekly = s.ci.weekly ? weeklyCap(s) * WEEKLY_RUNS_PER_MONTH : 0;
  return nightly + weekly;
}

/** Ô nhập USD → số, hoặc `null` khi trống / không phải số / âm / vượt trần. Nhận dấu phẩy thập phân. */
export function parseCap(text: string, max = DEFAULT_MAX_CAP_USD): number | null {
  const s = text.trim().replace(",", ".");
  if (s === "" || !/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
}

/** Hai cấu hình giống nhau (để biết có cần Lưu). */
export function sameSettings(a: EvalSettings, b: EvalSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
