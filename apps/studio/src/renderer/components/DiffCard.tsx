import { Check, FileCode2, Maximize2 } from "lucide-react";
import { useMemo, useState } from "react";
import { diffHunks, summarizeDiff } from "../diffSummary";
import type { Diff } from "../models";
import { languageFor } from "../syntax";
import { DiffTable } from "./CodeView";

const PREVIEW_ROWS = 14;

/** File ảnh dạng chữ (SVG) xem trước được ngay từ nội dung đề xuất, chưa cần Apply. */
export function isSvgPath(p: string): boolean {
  return /\.svg$/i.test(p);
}

/**
 * SVG → data URL cho `<img>`: trong `<img>` SVG không chạy script, không tải tài nguyên ngoài,
 * nên xem trước nội dung model viết là an toàn.
 */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** `src/app/x.py` → { dir: "src/app/", name: "x.py" } */
export function splitPath(p: string) {
  const norm = p.split("\\").join("/");
  const i = norm.lastIndexOf("/");
  return { dir: i >= 0 ? norm.slice(0, i + 1) : "", name: i >= 0 ? norm.slice(i + 1) : norm };
}

export function DiffStat(props: { added: number; removed: number }) {
  return (
    <span className="diff-stat">
      <span className="add">+{props.added}</span>
      <span className="del">−{props.removed}</span>
    </span>
  );
}

export function DiffCard(props: {
  diff: Diff;
  onApply: () => void;
  onReject: () => void;
  onShow: () => void;
  /** Bấm ảnh xem trước (SVG) → lightbox. */
  onOpenImage?: (images: string[], index: number) => void;
}) {
  const { diff } = props;
  const [expanded, setExpanded] = useState(false);
  const svg = isSvgPath(diff.path) && diff.after.trim().length > 0;
  const [view, setView] = useState<"preview" | "code">("preview");
  const showPreview = svg && view === "preview";
  const sum = useMemo(() => summarizeDiff(diff.before, diff.after), [diff]);
  const hunks = useMemo(() => diffHunks(diff.before, diff.after), [diff]);
  const total = hunks.reduce((n, h) => n + h.rows.length, 0);
  const { dir, name } = splitPath(diff.path);

  // Cắt theo tổng số hàng hiển thị, giữ nguyên thứ tự hunk.
  let budget = expanded ? Infinity : PREVIEW_ROWS;
  const shown = useMemo(
    () =>
      hunks
        .map((h) => {
          const rows = h.rows.slice(0, Math.max(0, budget));
          budget -= rows.length;
          return { ...h, rows };
        })
        .filter((h) => h.rows.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hunks, expanded],
  );
  const lang = languageFor(diff.path);

  return (
    <section className="diff-card" aria-label={`Thay đổi đề xuất cho ${diff.path}`}>
      <header className="diff-card-head">
        <button type="button" className="diff-card-file" onClick={props.onShow} title="Mở trong panel Changes">
          <FileCode2 size={15} aria-hidden />
          <span className="diff-path">
            {dir && <span className="dir">{dir}</span>}
            <span className="name">{name}</span>
          </span>
        </button>
        <DiffStat added={sum.added} removed={sum.removed} />
        {svg ? (
          <div className="diff-view-toggle" role="tablist" aria-label="Cách xem">
            <button type="button" role="tab" aria-selected={view === "preview"} onClick={() => setView("preview")}>
              Xem trước
            </button>
            <button type="button" role="tab" aria-selected={view === "code"} onClick={() => setView("code")}>
              Mã
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className="icon-btn diff-card-open"
          onClick={props.onShow}
          title="Mở trong panel Changes"
          aria-label="Mở trong panel Changes"
        >
          <Maximize2 size={14} />
        </button>
      </header>

      {showPreview ? (
        <div className="diff-card-preview">
          <button
            type="button"
            className="img-zoom"
            title="Bấm để phóng to"
            onClick={() => props.onOpenImage?.([svgDataUrl(diff.after)], 0)}
          >
            <img src={svgDataUrl(diff.after)} alt={`Xem trước ${name}`} />
          </button>
        </div>
      ) : total > 0 ? (
        <div className="diff-card-body">
          <DiffTable hunks={shown} lang={lang} />
          {total > PREVIEW_ROWS && (
            <button type="button" className="diff-more" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Thu gọn" : `Hiện thêm ${total - PREVIEW_ROWS} dòng`}
            </button>
          )}
        </div>
      ) : (
        <p className="diff-card-empty">Không có thay đổi nội dung.</p>
      )}

      {diff.applied ? (
        // Balanced: Engine đã ghi file (tầng 1). Không còn Apply/Reject; Hoàn tác ghi lại `before`.
        <footer className="diff-card-foot">
          <span className="diff-card-applied">
            <Check size={14} aria-hidden />
            Đã áp dụng
          </span>
          <button type="button" className="ghost sm" onClick={props.onReject} title="Ghi lại nội dung trước khi sửa">
            Hoàn tác
          </button>
        </footer>
      ) : (
        <footer className="diff-card-foot">
          <button type="button" className="ghost sm" onClick={props.onReject}>
            Reject
          </button>
          <button type="button" className="primary sm" onClick={props.onApply}>
            <Check size={14} aria-hidden />
            Apply
          </button>
        </footer>
      )}
    </section>
  );
}
