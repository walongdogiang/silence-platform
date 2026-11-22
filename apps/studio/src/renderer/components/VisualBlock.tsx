import { Code2, FileCode2, Image as ImageIcon } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { svgDataUrl } from "./DiffCard";
import { CodeBlock } from "./CodeView";
import { svgViewBox } from "../pastedImages";
import type { EditTarget } from "../imageActions";
import { ImageFrame, type ImageMoreItem } from "./ImageFrame";
import { useT } from "../i18n";

/** Chiều cao tối đa của hình trong chat (px); xem đầy đủ thì phóng to. Khớp `.visual-*` trong CSS. */
export const VISUAL_MAX_H = 400;

/** SVG trong khối ```svg đã đủ (mở `<svg`, đóng `</svg>`) — lúc đang stream thì chưa. */
export function isCompleteSvg(text: string): boolean {
  const t = text.trim().replace(/^<\?xml[^>]*\?>\s*/i, "");
  return /^<svg[\s>]/i.test(t) && /<\/svg>$/i.test(t);
}

const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** `<title>` đầu tiên của SVG (đã bỏ thẻ con, gọn khoảng trắng, ≤ 80 ký tự) — làm alt và tiêu đề card. */
export function svgTitle(text: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  if (!m) return null;
  const t = decodeEntities(m[1].replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > 80 ? `${t.slice(0, 79)}…` : t;
}

const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}\\s*=\\s*["']\\s*([^"']*?)\\s*["']`, "i").exec(tag)?.[1];

/**
 * Tranh nền kín (minh hoạ) hay sơ đồ nền trong suốt: tranh khi hình vẽ đầu tiên (bỏ qua
 * title/desc/defs/style và các `<g>`) là `<rect>` phủ cả `viewBox` và có màu nền.
 * Tranh thì cho tràn sát mép card, sơ đồ thì giữ lề.
 */
export function isFullBleedSvg(text: string): boolean {
  const vb = svgViewBox(text);
  if (!vb) return false;
  const body = text
    .replace(/<(title|desc|defs|style|metadata)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/^[\s\S]*?<svg\b[^>]*>/i, "");
  const first = /<(rect|circle|ellipse|path|polygon|polyline|line|text|image|use)\b[^>]*>/i.exec(body);
  if (!first || first[1].toLowerCase() !== "rect") return false;
  const tag = first[0];
  const covers = (v: string | undefined, full: number) => v === "100%" || (v !== undefined && Number(v) >= full);
  const at0 = (v: string | undefined) => v === undefined || Number(v) <= 0;
  const fill = (attr(tag, "fill") ?? "").toLowerCase();
  return (
    covers(attr(tag, "width"), vb.w) &&
    covers(attr(tag, "height"), vb.h) &&
    at0(attr(tag, "x")) &&
    at0(attr(tag, "y")) &&
    fill !== "none" &&
    fill !== "transparent"
  );
}

function formatSize(chars: number): string {
  return chars < 1024 ? `${chars} B` : `${(chars / 1024).toFixed(1)} KB`;
}

/** Bề rộng (px) để hình cao tối đa `VISUAL_MAX_H` mà vẫn đúng tỉ lệ — tránh chat nhảy khi hình hiện. */
const fitWidth = (vb: { w: number; h: number }) => `min(100%, ${Math.round((VISUAL_MAX_H * vb.w) / vb.h)}px)`;

/**
 * Khối ```svg trong câu trả lời: vẽ thành hình ngay trong chat (như "visual"), không cần file.
 * Hiện bằng `<img src="data:image/svg+xml…">`: SVG trong `<img>` không chạy script, không tải
 * tài nguyên ngoài, nên an toàn với nội dung model viết.
 * Đang stream (`streaming`, chưa có `</svg>`) → ô chờ "Đang vẽ…" đúng tỉ lệ `viewBox` thay vì đổ
 * mã ra chat. Đã xong mà SVG cụt / hỏng → hiện mã. Không header: hình là trọng tâm, `<title>` làm
 * caption mờ bên dưới. Hover hình: một cụm Chỉnh sửa / Copy / Tải / ⋯ (`ImageFrame`); ⋯ có
 * Copy mã SVG và Xem mã (ngăn mã mở bên dưới, hình vẫn giữ chỗ).
 */
export function VisualBlock(props: {
  text: string;
  streaming?: boolean;
  onOpenImage?: (images: string[], index: number) => void;
  onEdit?: (target: EditTarget) => void;
}) {
  const t = useT();
  const text = props.text.replace(/\n$/, "");
  const complete = isCompleteSvg(text);
  const [showCode, setShowCode] = useState(false);
  const [broken, setBroken] = useState(false);
  const vb = svgViewBox(text);

  if (!complete) {
    if (props.streaming) {
      const box: CSSProperties = vb
        ? { aspectRatio: `${vb.w} / ${vb.h}`, width: fitWidth(vb) }
        : { height: 220, width: "100%" };
      return (
        <div className="visual visual-pending" role="status" aria-live="polite">
          <div className="visual-placeholder" style={box}>
            <span className="visual-label">
              <ImageIcon size={14} aria-hidden />
              {t("visual.drawing")}
            </span>
            <span className="visual-size">{formatSize(text.length)}</span>
          </div>
        </div>
      );
    }
    return <CodeBlock lang="svg" text={text} />;
  }
  const title = svgTitle(text);
  const label = title ?? t("visual.untitled");
  if (broken) {
    return (
      <div className="visual visual-broken">
        <span className="visual-note" role="status">
          {t("visual.broken")}
        </span>
        <CodeBlock lang="svg" text={text} />
      </div>
    );
  }
  const url = svgDataUrl(text.trim());
  const bleed = isFullBleedSvg(text);
  // Tranh: khối co theo bề rộng hình, hình sát mép, bo góc. Sơ đồ: nền nhạt full, hình giữa có lề.
  const boxStyle: CSSProperties | undefined = bleed && vb ? { width: fitWidth(vb) } : undefined;
  const imgStyle: CSSProperties | undefined = vb
    ? { aspectRatio: `${vb.w} / ${vb.h}`, width: bleed ? "100%" : fitWidth(vb) }
    : undefined;
  const more: ImageMoreItem[] = [
    {
      key: "copy-svg",
      label: t("visual.copySvg"),
      icon: <FileCode2 size={15} />,
      onSelect: () => navigator.clipboard.writeText(text),
      done: t("visual.svgCopied"),
      failed: t("img.copyFailedShort"),
    },
    {
      key: "code",
      label: showCode ? t("visual.hideCode") : t("visual.showCode"),
      icon: <Code2 size={15} />,
      onSelect: () => setShowCode((v) => !v),
    },
  ];
  return (
    <figure className={`visual${bleed ? " bleed" : ""}`}>
      <div className="visual-body" style={boxStyle}>
        <ImageFrame
          src={url}
          alt={label}
          name={title ?? undefined}
          title={t("img.clickToZoom")}
          imgStyle={imgStyle}
          onOpen={() => props.onOpenImage?.([url], 0)}
          onEdit={props.onEdit ? () => props.onEdit?.({ src: url, title: title ?? undefined }) : undefined}
          onImgError={() => setBroken(true)}
          more={more}
        />
      </div>
      {title ? (
        <figcaption className="visual-caption" style={boxStyle} title={title}>
          {title}
        </figcaption>
      ) : null}
      {showCode ? (
        <div className="visual-code">
          <CodeBlock lang="svg" text={text} />
        </div>
      ) : null}
    </figure>
  );
}
