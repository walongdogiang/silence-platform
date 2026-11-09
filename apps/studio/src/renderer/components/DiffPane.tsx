import Editor, { DiffEditor } from "@monaco-editor/react";
import { Check, FileCode2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { summarizeDiff } from "../diffSummary";
import { useMonacoTheme } from "../monaco";
import type { Diff } from "../models";
import { DiffStat, splitPath } from "./DiffCard";
import { PlaceholderView } from "./PlaceholderView";

const loadingEl = <div className="placeholder compact">Đang tải trình soạn thảo…</div>;

const baseOptions = {
  minimap: { enabled: false },
  fontSize: 13,
  lineHeight: 20,
  fontFamily: "Cascadia Code, Consolas, monospace",
  scrollBeyondLastLine: false,
  automaticLayout: true,
  glyphMargin: false,
  folding: false,
  lineNumbersMinChars: 3,
  renderLineHighlight: "none" as const,
  padding: { top: 8, bottom: 8 },
  overviewRulerBorder: false,
  scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6, useShadows: false },
};

type ReviewTab = "changes" | "tests" | "logs" | "preview";

export function DiffPane(props: {
  tree: string[];
  file: string | null;
  fileText: string;
  diff: Diff | null;
  language: string;
  onOpenFile: (path: string) => void;
  onChange: (text: string) => void;
  onApply?: () => void;
  onReject?: () => void;
  /** Đóng panel (nếu đang có diff chờ duyệt thì chỉ ẩn, thẻ Diff trong chat vẫn còn). */
  onClose?: () => void;
  onReviewTab?: (t: ReviewTab) => void;
  /** Đổi mỗi lần user bấm mở diff từ thẻ trong chat: đưa về tab Changes. */
  showChangesSignal?: number;
}) {
  const [sub, setSub] = useState<ReviewTab>("changes");
  const theme = useMonacoTheme();
  useEffect(() => {
    if (props.showChangesSignal) pick("changes");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.showChangesSignal]);
  const shown = props.diff?.path ?? props.file;
  const sum = useMemo(
    () => (props.diff ? summarizeDiff(props.diff.before, props.diff.after) : null),
    [props.diff],
  );

  function pick(t: ReviewTab) {
    setSub(t);
    props.onReviewTab?.(t);
  }

  const files = props.diff ? [props.diff.path] : props.tree.slice(0, 40);
  const head = shown ? splitPath(shown) : null;

  return (
    <div className="diff-pane">
      <div className="diff-subtabs">
        {(["changes", "tests", "logs", "preview"] as const).map((id) => (
          <button key={id} type="button" className={sub === id ? "active" : ""} onClick={() => pick(id)}>
            {id === "changes" ? "Changes" : id === "tests" ? "Tests" : id === "logs" ? "Logs" : "Preview"}
            {id === "changes" && props.diff ? <em> 1</em> : null}
          </button>
        ))}
        {props.onClose && (
          <button
            type="button"
            className="icon-btn diff-close"
            onClick={props.onClose}
            title="Đóng panel"
            aria-label="Đóng panel Changes"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {sub === "changes" && (
        <div className="diff-body">
          <div className="diff-files">
            {files.map((p) => {
              const { dir, name } = splitPath(p);
              const isDiff = props.diff && p === props.diff.path;
              const isNew = isDiff && props.diff!.before === "";
              return (
                <button
                  key={p}
                  type="button"
                  className={shown === p ? "active" : ""}
                  onClick={() => props.onOpenFile(p)}
                  title={p}
                >
                  <span className="diff-file-name">
                    <span className="name">{name}</span>
                    {dir && <span className="dir">{dir.replace(/\/$/, "")}</span>}
                  </span>
                  {isDiff && sum && <DiffStat added={sum.added} removed={sum.removed} />}
                  {isDiff && <i className={`diff-badge ${isNew ? "new" : "mod"}`}>{isNew ? "A" : "M"}</i>}
                </button>
              );
            })}
            {props.tree.length === 0 && !props.diff && <p className="hint">Chưa có thay đổi</p>}
          </div>

          <div className="diff-main">
            {head && (
              <div className="diff-filehead">
                <FileCode2 size={15} aria-hidden />
                <span className="diff-path">
                  {head.dir && <span className="dir">{head.dir}</span>}
                  <span className="name">{head.name}</span>
                </span>
                {sum && <DiffStat added={sum.added} removed={sum.removed} />}
                {props.diff && (props.onApply || props.onReject) && (
                  <span className="diff-filehead-actions">
                    {props.onReject && (
                      <button type="button" className="ghost sm" onClick={props.onReject}>
                        Reject
                      </button>
                    )}
                    {props.onApply && (
                      <button type="button" className="primary sm" onClick={props.onApply}>
                        <Check size={14} aria-hidden />
                        Apply
                      </button>
                    )}
                  </span>
                )}
              </div>
            )}
            <div className="diff-editor">
              {props.diff ? (
                <DiffEditor
                  height="100%"
                  theme={theme}
                  language={props.language}
                  original={props.diff.before}
                  modified={props.diff.after}
                  loading={loadingEl}
                  options={{
                    ...baseOptions,
                    readOnly: true,
                    originalEditable: false,
                    renderSideBySide: true,
                    useInlineViewWhenSpaceIsLimited: true,
                    renderOverviewRuler: false,
                    renderMarginRevertIcon: false,
                    ignoreTrimWhitespace: false,
                    hideUnchangedRegions: { enabled: true, contextLineCount: 3, minimumLineCount: 3 },
                  }}
                />
              ) : shown ? (
                <Editor
                  height="100%"
                  theme={theme}
                  language={props.language}
                  value={props.fileText}
                  loading={loadingEl}
                  onChange={(v) => props.onChange(v ?? "")}
                  options={baseOptions}
                />
              ) : (
                <div className="placeholder compact">Chọn file hoặc chờ agent tạo diff</div>
              )}
            </div>
          </div>
        </div>
      )}

      {sub === "tests" && (
        <PlaceholderView title="Tests" detail="Chưa kết nối backend — UI only. Không có kết quả test thật." />
      )}
      {sub === "logs" && (
        <PlaceholderView title="Logs" detail="Mở panel dưới (Ctrl+J) để xem Terminal và Output." />
      )}
      {sub === "preview" && (
        <PlaceholderView title="Preview" detail="Chưa kết nối backend — UI only. Không có preview thật." />
      )}
    </div>
  );
}
