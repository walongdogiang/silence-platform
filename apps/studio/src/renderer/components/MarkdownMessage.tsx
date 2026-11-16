import { useMemo, useRef, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { looksLikeDiff, parseUnifiedDiff } from "../unifiedDiff";
import { CodeBlock, DiffBlock } from "./CodeView";
import { parsePathRef } from "../pathRef";
import { workspaceImageSrc } from "../workspaceImages";
import { WorkspaceImage } from "./WorkspaceImage";
import { VisualBlock } from "./VisualBlock";
import type { EditTarget } from "../imageActions";
import { useT } from "../i18n";

export { parsePathRef };

const isHttp = (href: string) => /^https?:\/\//i.test(href);
const REMARK_PLUGINS = [remarkGfm];

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
  const { workspace, streaming } = props;
  const t = useT();
  // Parent callbacks are new functions on every render (every streamed token). Keep the latest in a
  // ref and hand stable wrappers to the Markdown tree, so finished messages are not re-parsed
  // (remark + GFM) on each token — only presence of a callback changes what renders.
  const latest = useRef(props);
  latest.current = props;
  const hasOpenFile = Boolean(props.onOpenFile);
  const hasOpenImage = Boolean(props.onOpenImage);
  const hasEditImage = Boolean(props.onEditImage);
  const onOpenFile = useMemo(
    () => (hasOpenFile ? (path: string) => latest.current.onOpenFile?.(path) : undefined),
    [hasOpenFile],
  );
  const onOpenImage = useMemo(
    () => (hasOpenImage ? (images: string[], index: number) => latest.current.onOpenImage?.(images, index) : undefined),
    [hasOpenImage],
  );
  const onEditImage = useMemo(
    () => (hasEditImage ? (target: EditTarget) => latest.current.onEditImage?.(target) : undefined),
    [hasEditImage],
  );
  const components = useMemo<Components>(
    () => ({
      a({ href, children }) {
        const ref = href && !isHttp(href) && onOpenFile ? parsePathRef(href.replace(/^\.\//, "")) : null;
        if (ref && onOpenFile) {
          return (
            <button type="button" className="md-path md-link-file" title={t("md.open", { path: ref.path })} onClick={() => onOpenFile(ref.path)}>
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
        return <span className="md-img-blocked">{alt ? t("md.imgAlt", { alt }) : t("md.imgBlocked")}</span>;
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
              title={t("md.open", { path: ref.path })}
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
    // `t` changes with the UI language (new function each render): key the memo on its output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onOpenFile, workspace, onOpenImage, streaming, onEditImage, t("md.imgBlocked")],
  );

  // Same element object → React skips the subtree; only the message whose text changed re-parses.
  const md = useMemo(
    () => (
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {props.text}
      </ReactMarkdown>
    ),
    [props.text, components],
  );

  return <div className="msg-ai msg-md">{md}</div>;
}
