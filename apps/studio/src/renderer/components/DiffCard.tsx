import { Check, FileCode2, Maximize2 } from "lucide-react";
import { useMemo, useState } from "react";
import { diffHunks, summarizeDiff } from "../diffSummary";
import { useT } from "../i18n";
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

/**
 * Path as shown on the card: relative to the first root it sits under (the chat's worktree or
 * workspace), else unchanged. Case-insensitive for Windows drive paths.
 */
export function shownPath(p: string, roots: (string | undefined)[]): string {
  const norm = p.split("\\").join("/");
  for (const r of roots) {
    if (!r) continue;
    const root = r.split("\\").join("/").replace(/\/+$/, "") + "/";
    if (norm.toLowerCase().startsWith(root.toLowerCase())) return norm.slice(root.length);
  }
  return norm;
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
  /** Folders the path is shown relative to (worktree first, then workspace); full path in the tooltip. */
  roots?: (string | undefined)[];
  /** The edit is already merged into this branch: Undo here would not reach it, so it is hidden. */
  mergedInto?: string;
}) {
  const t = useT();
  const { diff } = props;
  const [expanded, setExpanded] = useState(false);
  const svg = isSvgPath(diff.path) && diff.after.trim().length > 0;
  const [view, setView] = useState<"preview" | "code">("preview");
  const showPreview = svg && view === "preview";
  const sum = useMemo(() => summarizeDiff(diff.before, diff.after), [diff]);
  const hunks = useMemo(() => diffHunks(diff.before, diff.after), [diff]);
  const total = hunks.reduce((n, h) => n + h.rows.length, 0);
  const { dir, name } = splitPath(shownPath(diff.path, props.roots ?? []));

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
    <section className="diff-card" aria-label={t("diff.proposedFor", { path: diff.path })}>
      <header className="diff-card-head">
        <button type="button" className="diff-card-file" onClick={props.onShow} title={`${diff.path}\n${t("diff.openInPanel")}`}>
          <FileCode2 size={15} aria-hidden />
          <span className="diff-path">
            {dir && <span className="dir">{dir}</span>}
            <span className="name">{name}</span>
          </span>
        </button>
        <DiffStat added={sum.added} removed={sum.removed} />
        {svg ? (
          <div className="diff-view-toggle" role="tablist" aria-label={t("diff.viewAs")}>
            <button type="button" role="tab" aria-selected={view === "preview"} onClick={() => setView("preview")}>
              {t("diff.preview")}
            </button>
            <button type="button" role="tab" aria-selected={view === "code"} onClick={() => setView("code")}>
              {t("diff.code")}
            </button>
          </div>
        ) : null}
        <button
          type="button"
          className="icon-btn diff-card-open"
          onClick={props.onShow}
          title={t("diff.openInPanel")}
          aria-label={t("diff.openInPanel")}
        >
          <Maximize2 size={14} />
        </button>
      </header>

      {showPreview ? (
        <div className="diff-card-preview">
          <button
            type="button"
            className="img-zoom"
            title={t("img.clickToZoom")}
            onClick={() => props.onOpenImage?.([svgDataUrl(diff.after)], 0)}
          >
            <img src={svgDataUrl(diff.after)} alt={t("diff.previewOf", { name })} />
          </button>
        </div>
      ) : total > 0 ? (
        <div className="diff-card-body">
          <DiffTable hunks={shown} lang={lang} />
          {total > PREVIEW_ROWS && (
            <button type="button" className="diff-more" onClick={() => setExpanded((v) => !v)}>
              {expanded ? t("diff.collapse") : t("diff.showMore", { n: total - PREVIEW_ROWS })}
            </button>
          )}
        </div>
      ) : (
        <p className="diff-card-empty">{t("diff.noContentChange")}</p>
      )}

      {diff.applied ? (
        // Balanced: Engine đã ghi file (tầng 1). Không còn Apply/Reject; Hoàn tác ghi lại `before`.
        <footer className="diff-card-foot">
          <span className="diff-card-applied">
            <Check size={14} aria-hidden />
            {t("diff.applied")}
          </span>
          {props.mergedInto ? (
            <span className="muted diff-card-merged">{t("diff.undoMerged", { base: props.mergedInto })}</span>
          ) : (
            <button type="button" className="ghost sm" onClick={props.onReject} title={t("diff.undoTip")}>
              {t("diff.undo")}
            </button>
          )}
        </footer>
      ) : (
        <footer className="diff-card-foot">
          <button type="button" className="ghost sm" onClick={props.onReject}>
            {t("common.reject")}
          </button>
          <button type="button" className="primary sm" onClick={props.onApply}>
            <Check size={14} aria-hidden />
            {t("common.apply")}
          </button>
        </footer>
      )}
    </section>
  );
}
