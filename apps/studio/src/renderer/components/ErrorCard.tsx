import { AlertCircle, RotateCcw } from "lucide-react";
import { errorCopy, errorDetail } from "../errorCopy";
import { useT } from "../i18n";
import type { ErrorInfo } from "../types";

/** Thẻ lỗi inline trong lượt chat. Không toast/dialog; chi tiết kỹ thuật thu gọn. */
export function ErrorCard(props: {
  message: string;
  info?: ErrorInfo;
  retryDisabled?: boolean;
  onRetry?: () => void;
}) {
  const t = useT();
  const c = errorCopy(props.info, t);
  return (
    <div className="msg-error" role="alert">
      <div className="msg-error-head">
        <AlertCircle size={15} strokeWidth={1.75} />
        <b>{c.title}</b>
      </div>
      <p className="msg-error-body">{c.body}</p>
      <p className="msg-error-hint">{c.hint}</p>
      {c.canRetry && props.onRetry ? (
        <div className="row">
          <button type="button" className="ghost" disabled={props.retryDisabled} onClick={props.onRetry}>
            <RotateCcw size={12} strokeWidth={1.75} /> {t("err.retry")}
          </button>
        </div>
      ) : null}
      <details className="msg-error-detail">
        <summary>{t("err.details")}</summary>
        <pre>{errorDetail(props.info, props.message)}</pre>
      </details>
    </div>
  );
}
