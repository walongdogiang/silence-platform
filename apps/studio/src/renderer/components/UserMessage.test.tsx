import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LangContext, translator } from "../i18n";
import { UserMessage } from "./UserMessage";
import { formatAgo, formatFull } from "./MessageTime";

const inVi = (node: ReactNode) =>
  renderToStaticMarkup(<LangContext.Provider value="vi">{node}</LangContext.Provider>);
const noop = () => {};

describe("UserMessage", () => {
  it("hàng dưới bong bóng (như Claude): giờ rồi Fork · Quay lại đây · Thử lại · Copy", () => {
    const html = inVi(
      <UserMessage
        text="vẽ con chó"
        at={Date.now() - 8 * 60_000}
        onCopy={noop}
        onMenu={noop}
        onFork={noop}
        onRetry={noop}
        onRewind={noop}
      />,
    );
    const row = html.split('class="msg-user-actions"')[1];
    expect(row).toContain("<time");
    expect(row).toContain("8 phút trước");
    const order = ["<time", 'aria-label="Fork từ đây"', 'aria-label="Quay lại đây"', 'aria-label="Thử lại"', 'aria-label="Copy tin nhắn"'].map(
      (s) => row.indexOf(s),
    );
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Tooltip kiểu Claude: tiêu đề + dòng mô tả, hiện phía trên.
    expect(row).toContain('data-tip-desc="Mở chat mới với phần trước tin này, giữ nguyên chat này"');
    expect(row).toContain('data-tip-side="above"');
  });

  it("đang chạy, không giờ: không có hàng thao tác; bận: nút khoá vẫn rê được, mô tả là lý do", () => {
    expect(inVi(<UserMessage text="hi" live onCopy={noop} onMenu={noop} />)).not.toContain("msg-user-actions");
    const busy = inVi(<UserMessage text="hi" busy onCopy={noop} onMenu={noop} onRewind={noop} />);
    const rewind = busy.split('aria-label="Quay lại đây"')[1].split(">")[0];
    expect(rewind).toContain('aria-disabled="true"');
    expect(rewind).not.toContain("disabled=\"\"");
    expect(busy).toContain('data-tip-desc="Dùng được khi agent xong lượt này"');
  });

  it("tin cũ không có thời gian thì không hiện <time>", () => {
    expect(inVi(<UserMessage text="hi" onCopy={noop} onMenu={noop} />)).not.toContain("<time");
  });

  it("đang chạy mà có giờ: vẫn hiện giờ, không có nút", () => {
    const html = inVi(<UserMessage text="hi" live at={Date.now()} onCopy={noop} onMenu={noop} />);
    expect(html).toContain("<time");
    expect(html).not.toContain("msg-user-tools");
  });

  it("formatAgo: vừa xong, phút, giờ, ngày; quá 7 ngày thì ngày tháng", () => {
    const vi = translator("vi");
    const en = translator("en");
    const now = new Date(2026, 10, 20, 15, 0).getTime();
    expect(formatAgo(now - 10_000, now, "vi-VN", vi)).toBe("vừa xong");
    expect(formatAgo(now - 28 * 60_000, now, "en-US", en)).toBe("28 minutes ago");
    expect(formatAgo(now - 28 * 60_000, now, "vi-VN", vi)).toBe("28 phút trước");
    expect(formatAgo(now - 3 * 3_600_000, now, "en-US", en)).toBe("3 hours ago");
    expect(formatAgo(now - 24 * 3_600_000, now, "en-US", en)).toBe("yesterday");
    expect(formatAgo(new Date(2026, 10, 2).getTime(), now, "en-US", en)).toBe("Nov 2");
    expect(formatAgo(new Date(2025, 0, 2).getTime(), now, "en-US", en)).toContain("2025");
  });

  it("formatFull: tooltip ngày giờ đầy đủ như Claude", () => {
    expect(formatFull(new Date(2026, 10, 20, 15, 3).getTime(), "en-US")).toBe("Nov 20, 2026, 3:03 PM");
  });
});
