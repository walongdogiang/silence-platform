import { useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { looksLikeDiff, parseUnifiedDiff } from "../unifiedDiff";
import { CodeBlock, DiffBlock } from "./CodeView";

/**
 * Nhận `src/calc.py`, `calc.py:4`, `src/a/b.rs:10-20`. Từ chối đường dẫn tuyệt đối, có ổ đĩa
 * hoặc `..` (giống `rel_path` ở Engine) để chip chỉ mở file trong workspace.
 */
export function parsePathRef(text: string): { path: string; line?: number } | null {
  const m = /^([\w.\-]+(?:\/[\w.\-]+)*\.[A-Za-z0-9]{1,8})(?::(\d+)(?:-\d+)?)?$/.exec(text.trim());
  if (!m) return null;
  if (m[1].split("/").some((s) => s === "..")) return null;
  return { path: m[1], line: m[2] ? Number(m[2]) : undefined };
}

const isHttp = (href: string) => /^https?:\/\//i.test(href);

function textOf(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join("");
  return "";
}

/**
 * Câu trả lời của agent dạng GitHub-flavored Markdown. An toàn theo thiết kế:
 * - không rehype-raw: HTML thô không được render (hiện như chữ);
 * - `urlTransform` mặc định của react-markdown bỏ `javascript:` và scheme lạ;
 * - ảnh từ xa bị chặn (URL ảnh là kênh rò rỉ dữ liệu khi model bị prompt-injection);
 * - link http(s) đi qua `openExternal` (main kiểm lại), link khác chỉ hiện chữ.
 * Copy Message vẫn lấy chuỗi gốc `ai.text`, không lấy từ DOM.
 */
export function MarkdownMessage(props: { text: string; onOpenFile?: (path: string) => void }) {
  const { onOpenFile } = props;
  const components = useMemo<Components>(
    () => ({
      a({ href, children }) {
        if (!href || !isHttp(href)) return <span>{children}</span>;
        return (
          <a
            href={href}
            rel="noreferrer noopener"
            onClick={(e) => {
              e.preventDefault();
              void window.silence?.openExternal(href);
            }}
          >
            {children}
          </a>
        );
      },
      img({ alt }) {
        return <span className="md-img-blocked">{alt ? `[ảnh: ${alt}]` : "[ảnh bị chặn]"}</span>;
      },
      code({ className, children }) {
        const text = textOf(children);
        const inline = !className && !text.includes("\n");
        if (!inline) {
          const lang = /language-([\w+#.-]+)/.exec(className ?? "")?.[1];
          const parsed = looksLikeDiff(lang, text) ? parseUnifiedDiff(text) : null;
          if (parsed) {
            const ref = parsed.path ? parsePathRef(parsed.path) : null;
            return (
              <DiffBlock
                text={text}
                parsed={parsed}
                fenceLang={lang}
                openPath={ref?.path ?? null}
                onOpenFile={onOpenFile}
              />
            );
          }
          return <CodeBlock lang={lang} text={text} />;
        }
        const ref = onOpenFile ? parsePathRef(text) : null;
        if (ref && onOpenFile) {
          return (
            <button
              type="button"
              className="md-path"
              title={`Mở ${ref.path}`}
              onClick={() => onOpenFile(ref.path)}
            >
              {text}
            </button>
          );
        }
        return <code className="md-inline">{children}</code>;
      },
      pre({ children }) {
        // Khối code đã tự bọc trong card (`CodeBlock`/`DiffBlock`), không lồng thêm <pre>.
        return <>{children}</>;
      },
      table({ children }) {
        return (
          <div className="md-table-wrap">
            <table>{children}</table>
          </div>
        );
      },
    }),
    [onOpenFile],
  );

  return (
    <div className="msg-ai msg-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {props.text}
      </ReactMarkdown>
    </div>
  );
}
