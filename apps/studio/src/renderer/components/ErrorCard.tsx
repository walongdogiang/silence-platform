import { AlertCircle, RotateCcw, Shuffle } from "lucide-react";
import { errorCopy, errorDetail } from "../errorCopy";
import { useT } from "../i18n";
import type { ErrorInfo } from "../types";

/** Thẻ lỗi inline trong lượt chat. Không toast/dialog; chi tiết kỹ thuật thu gọn. */
export function ErrorCard(props: {
  message: string;
  info?: ErrorInfo;
  retryDisabled?: boolean;
  onRetry?: () => void;
  /** Mở chọn model/nguồn (Settings → Models) khi thử lại không giúp được. */
  onSwitchModel?: () => void;
}) {
  const t = useT();
  const c = errorCopy(props.info, t, props.message);
  return (
    <div className="msg-error" role="alert">
      <div className="msg-error-head">
        <AlertCircle size={15} strokeWidth={1.75} />
        <b>{c.title}</b>
      </div>
      <p className="msg-error-body">{c.body}</p>
      <p className="msg-error-hint">{c.hint}</p>
      {(c.canRetry && props.onRetry) || (c.canSwitchModel && props.onSwitchModel) ? (
        <div className="row">
          {c.canSwitchModel && props.onSwitchModel ? (
            <button type="button" className="ghost" onClick={props.onSwitchModel}>
              <Shuffle size={12} strokeWidth={1.75} /> {t("err.switchModel")}
            </button>
          ) : null}
          {c.canRetry && props.onRetry ? (
            <button type="button" className="ghost" disabled={props.retryDisabled} onClick={props.onRetry}>
              <RotateCcw size={12} strokeWidth={1.75} /> {t("err.retry")}
            </button>
          ) : null}
        </div>
      ) : null}
      <details className="msg-error-detail">
        <summary>{t("err.details")}</summary>
        <pre>{errorDetail(props.info, props.message)}</pre>
      </details>
    </div>
  );
}
