import { useEffect, useState, type RefObject } from "react";
import { useT } from "../i18n";

export type Chapter = { turn: number; title: string };

/** Tên chương mặc định: dòng đầu có chữ của tin user, gọn khoảng trắng, ≤ 60 ký tự. */
export function chapterTitle(text: string): string {
  const line = text.split("\n").map((s) => s.replace(/\s+/g, " ").trim()).find(Boolean) ?? "";
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}

/**
 * Mục lục: các lượt đã ghim theo thứ tự, mở đầu bằng "Bắt đầu phiên" (lượt 0) nếu lượt 0 chưa ghim.
 * Chưa ghim gì → rỗng (không hiện mục lục).
 */
export function chaptersFrom(turns: { chapter?: string }[], start: string): Chapter[] {
  const pinned = turns.flatMap((t, i) => (t.chapter ? [{ turn: i, title: t.chapter }] : []));
  if (!pinned.length) return [];
  return pinned[0].turn === 0 ? pinned : [{ turn: 0, title: start }, ...pinned];
}

/** Chương đang đọc: chương cuối cùng mà đầu lượt đã cuộn qua (cách đỉnh khung ≤ 48px). */
function activeIndex(chapters: Chapter[], viewport: HTMLElement): number {
  const top = viewport.getBoundingClientRect().top + 48;
  let active = 0;
  chapters.forEach((c, i) => {
    const el = viewport.querySelector<HTMLElement>(`[data-turn="${c.turn}"]`);
    if (el && el.getBoundingClientRect().top <= top) active = i;
  });
  return active;
}

/**
 * Mục lục chương nổi góc trên bên phải khung chat (như Claude): mặc định là chồng gạch ngắn (mỗi
 * chương một gạch, chương đang đọc sáng và dài hơn); rê chuột / focus thì mở danh sách tên chương.
 * Bấm tên → cuộn mượt tới lượt đó.
 */
export function ChapterNav(props: { chapters: Chapter[]; viewport: RefObject<HTMLDivElement | null> }) {
  const t = useT();
  const [active, setActive] = useState(0);
  const { chapters, viewport } = props;

  useEffect(() => {
    const el = viewport.current;
    if (!el || !chapters.length) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setActive(activeIndex(chapters, el)));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", update);
    };
  }, [chapters, viewport]);

  if (!chapters.length) return null;

  function jump(turn: number) {
    const el = viewport.current;
    const target = el?.querySelector<HTMLElement>(`[data-turn="${turn}"]`);
    if (!el || !target) return;
    const top = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 12;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: turn === 0 ? 0 : top, behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <nav className="chapter-nav" aria-label={t("chapter.nav")}>
      <div className="chapter-rail" aria-hidden>
        {chapters.map((c, i) => (
          <span key={c.turn} className={i === active ? "on" : undefined} />
        ))}
      </div>
      <ol className="chapter-list">
        {chapters.map((c, i) => (
          <li key={c.turn}>
            <button
              type="button"
              className={i === active ? "on" : undefined}
              aria-current={i === active ? "location" : undefined}
              onClick={() => jump(c.turn)}
            >
              <span className="chapter-dash" aria-hidden />
              <span className="chapter-title">{c.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
