import { useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { looksLikeDiff, parseUnifiedDiff } from "../unifiedDiff";
import { CodeBlock, DiffBlock } from "./CodeView";
import { parsePathRef } from "../pathRef";
import { workspaceImageSrc } from "../workspaceImages";
import { WorkspaceImage } from "./WorkspaceImage";
import { VisualBlock } from "./VisualBlock";
import type { EditTarget } from "../imageActions";

export { parsePathRef };

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
 * - ảnh từ xa bị chặn (URL ảnh là kênh rò rỉ dữ liệu khi model bị prompt-injection); ảnh trỏ vào
 *   workspace (`![x](out/a.png)`) đọc qua Engine `fs.read_image` (jail) và hiện tại chỗ;
 * - link http(s) đi qua `openExternal` (main kiểm lại); link tới file trong workspace mở như
 *   chip đường dẫn; link khác chỉ hiện chữ.
 * Copy Message vẫn lấy chuỗi gốc `ai.text`, không lấy từ DOM.
 */
export function MarkdownMessage(props: {
  text: string;
  onOpenFile?: (path: string) => void;
  /** Đường dẫn workspace: cần để hiện ảnh `![](path)` trong workspace. */
  workspace?: string;
  onOpenImage?: (images: string[], index: number) => void;
  /** Câu trả lời còn đang stream: khối ```svg chưa xong hiện ô chờ thay vì mã. */
  streaming?: boolean;
  /** Nút "Chỉnh sửa" khi hover ảnh (hình SVG, ảnh workspace): mở trình đánh dấu. */
  onEditImage?: (target: EditTarget) => void;
}) {
  const { onOpenFile, workspace, onOpenImage, streaming, onEditImage } = props;
  const components = useMemo<Components>(
    () => ({
      a({ href, children }) {
        const ref = href && !isHttp(href) && onOpenFile ? parsePathRef(href.replace(/^\.\//, "")) : null;
        if (ref && onOpenFile) {
          return (
            <button type="button" className="md-path md-link-file" title={`Mở ${ref.path}`} onClick={() => onOpenFile(ref.path)}>
              {children}
            </button>
          );
        }
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
      img({ alt, src }) {
        const path = workspace ? workspaceImageSrc(src) : null;
        if (path) return <WorkspaceImage workspace={workspace} path={path} alt={alt} onOpen={onOpenImage} onEdit={onEditImage} />;
        return <span className="md-img-blocked">{alt ? `[ảnh: ${alt}]` : "[ảnh bị chặn]"}</span>;
      },
      code({ className, children }) {
        const text = textOf(children);
        const inline = !className && !text.includes("\n");
        if (!inline) {
          const lang = /language-([\w+#.-]+)/.exec(className ?? "")?.[1];
          if (lang?.toLowerCase() === "svg") return (
              <VisualBlock text={text} streaming={streaming} onOpenImage={onOpenImage} onEdit={onEditImage} />
            );
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
    [onOpenFile, workspace, onOpenImage, streaming, onEditImage],
  );

  return (
    <div className="msg-ai msg-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {props.text}
      </ReactMarkdown>
    </div>
  );
}
