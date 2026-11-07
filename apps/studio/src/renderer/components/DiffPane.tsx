import Editor, { type Monaco } from "@monaco-editor/react";
import { useState } from "react";
import type { Diff } from "../models";
import { PlaceholderView } from "./PlaceholderView";

function beforeMount(monaco: Monaco) {
  monaco.editor.defineTheme("silence-graphite", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#191A1C",
      "editorGutter.background": "#191A1C",
    },
  });
}

type ReviewTab = "changes" | "tests" | "logs" | "preview";

export function DiffPane(props: {
  tree: string[];
  file: string | null;
  fileText: string;
  diff: Diff | null;
  language: string;
  onOpenFile: (path: string) => void;
  onChange: (text: string) => void;
  onReviewTab?: (t: ReviewTab) => void;
}) {
  const [sub, setSub] = useState<ReviewTab>("changes");
  const shown = props.diff?.path ?? props.file;
  const value = props.diff ? props.diff.after : props.fileText;

  function pick(t: ReviewTab) {
    setSub(t);
    props.onReviewTab?.(t);
  }

  return (
    <div className="diff-pane">
      <div className="diff-subtabs">
        {(["changes", "tests", "logs", "preview"] as const).map((id) => (
          <button key={id} type="button" className={sub === id ? "active" : ""} onClick={() => pick(id)}>
            {id === "changes" ? "Changes" : id === "tests" ? "Tests" : id === "logs" ? "Logs" : "Preview"}
            {id === "changes" && props.diff ? <em> 1</em> : null}
          </button>
        ))}
      </div>

      {sub === "changes" && (
        <div className="diff-body">
          <div className="diff-files">
            {(props.diff ? [props.diff.path] : props.tree.slice(0, 40)).map((p) => (
              <button
                key={p}
                type="button"
                className={shown === p ? "active" : ""}
                onClick={() => props.onOpenFile(p)}
              >
                <b>{props.diff && p === props.diff.path ? "M" : ""}</b>
                <span>{p.split("/").pop()}</span>
              </button>
            ))}
            {props.tree.length === 0 && !props.diff && <p className="hint">Chưa có thay đổi</p>}
          </div>
          <div className="diff-editor">
            {shown ? (
              <Editor
                height="100%"
                theme="silence-graphite"
                beforeMount={beforeMount}
                language={props.language}
                value={value}
                onChange={(v) => props.onChange(v ?? "")}
                options={{
                  readOnly: Boolean(props.diff),
                  minimap: { enabled: false },
                  fontSize: 12,
                  fontFamily: "Cascadia Code, Consolas, monospace",
                  scrollBeyondLastLine: false,
                }}
              />
            ) : (
              <div className="placeholder compact">Chọn file hoặc chờ agent tạo diff</div>
            )}
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
