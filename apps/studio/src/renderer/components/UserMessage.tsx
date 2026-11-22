import { Check, Copy, RefreshCw, RotateCcw } from "lucide-react";
import { ForkIcon } from "./ForkIcon";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { useT } from "../i18n";
import { COPIED_MS } from "./ImageFrame";
import { MessageTime } from "./MessageTime";

/** Tin dài hơn ngần này (px) thì thu gọn, có nút Xem thêm. Khớp `.msg-user .msg-bubble.clamped` trong CSS. */
export const USER_CLAMP_PX = 280;

type Action = {
  key: string;
  label: string;
  /** Dòng mô tả dưới tiêu đề trong tooltip (kiểu Claude); khoá thì là lý do khoá. */
  desc?: string;
  icon: ReactNode;
  disabled?: boolean;
  onClick: () => void;
};

/**
 * Tin của user (kiểu Claude Code): bong bóng **căn phải**, rộng theo nội dung (≤ 85%); ảnh dán nằm
 * **trên** bong bóng. Dưới bong bóng, căn phải (như Claude), **ẩn đến khi rê chuột / focus vào tin**:
 * giờ tương đối "28 phút trước" (tooltip ngày giờ đủ) · Fork từ đây · Quay lại đây (đưa tin về
 * composer) · Thử lại (lượt cuối) · Copy. Tooltip mỗi nút có tiêu đề + mô tả, hiện phía trên.
 * Tin rất dài thì thu gọn.
 * Chuột phải / Shift+F10 trên bong bóng vẫn mở menu tin nhắn đầy đủ.
 */
export function UserMessage(props: {
  text: string;
  images?: ReactNode;
  at?: number;
  live?: boolean;
  busy?: boolean;
  onCopy: (text: string) => void;
  onRetry?: () => void;
  /** Quay lại đây: bỏ tin này và các tin sau, đưa tin về composer để sửa. */
  onRewind?: () => void;
  onFork?: () => void;
  onMenu: (e: ReactMouseEvent | ReactKeyboardEvent) => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [long, setLong] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const bubble = useRef<HTMLDivElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);
  useLayoutEffect(() => {
    const el = bubble.current;
    if (el) setLong(el.scrollHeight > USER_CLAMP_PX + 40);
  }, [props.text]);

  const locked = Boolean(props.busy || props.live);
  const lockTip = t("msgMenu.busyDesc");
  const actions: Action[] = [];
  if (props.onFork)
    actions.push({
      key: "fork",
      label: t("msgMenu.fork"),
      desc: locked ? lockTip : t("msgMenu.forkDesc"),
      icon: <ForkIcon size={14} strokeWidth={1.75} />,
      disabled: locked,
      onClick: props.onFork,
    });
  if (props.onRewind)
    actions.push({
      key: "rewind",
      label: t("msgMenu.rewind"),
      desc: locked ? lockTip : t("chat.rewindDesc"),
      icon: <RotateCcw size={14} strokeWidth={1.75} />,
      disabled: locked,
      onClick: props.onRewind,
    });
  if (props.onRetry)
    actions.push({
      key: "retry",
      label: t("msgMenu.retry"),
      desc: locked ? lockTip : t("msgMenu.retryDesc"),
      icon: <RefreshCw size={14} strokeWidth={1.75} />,
      disabled: locked,
      onClick: props.onRetry,
    });

  function copy() {
    props.onCopy(props.text);
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }

  const clamped = long && !expanded;
  return (
    <div className="msg-user" onContextMenu={props.onMenu}>
      {props.images}
      {props.text ? (
        <div
          ref={bubble}
          className={`msg-bubble${clamped ? " clamped" : ""}`}
          tabIndex={0}
          aria-haspopup="menu"
          onKeyDown={props.onMenu}
        >
          {props.text}
        </div>
      ) : null}
      {long ? (
        <button type="button" className="msg-user-more" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {expanded ? t("chat.showLess") : t("chat.showMore")}
        </button>
      ) : null}
      {props.live && !props.at ? null : (
        <div className={`msg-user-actions${copied ? " is-copied" : ""}`}>
          {props.at ? <MessageTime at={props.at} /> : null}
          {props.live ? null : (
            <span className="msg-user-tools">
              {actions.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  className="msg-ai-action"
                  title={a.label}
                  data-tip-desc={a.desc}
                  data-tip-side="above"
                  aria-label={a.label}
                  aria-description={a.desc}
                  // aria-disabled (không phải disabled): vẫn rê chuột / focus được để đọc lý do khoá.
                  aria-disabled={a.disabled || undefined}
                  onClick={a.disabled ? undefined : a.onClick}
                >
                  {a.icon}
                </button>
              ))}
              <button
                type="button"
                className="msg-ai-action"
                title={copied ? t("common.copied") : t("chat.copyMessage")}
                data-tip-side="above"
                aria-label={t("chat.copyMessage")}
                disabled={!props.text.trim()}
                onClick={copy}
              >
                {copied ? <Check size={14} strokeWidth={1.75} /> : <Copy size={14} strokeWidth={1.75} />}
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
