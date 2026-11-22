import { useEffect, useState } from "react";
import { Play, TerminalSquare, X } from "lucide-react";
import { useT } from "../i18n";
import { MarkdownMessage } from "./MarkdownMessage";

/** Row of `session.external` (TS core, roadmap 1.10). */
export type ExternalItem = { backend_session_id: string; title: string; workspace: string; updated_at: string; created_at?: string; git_branch?: string };
export type ExternalLine = { role: "user" | "assistant"; text: string };

/** Transcript without fetching (tests). */
export function ExternalTranscript(props: { lines: ExternalLine[] }) {
  const t = useT();
  if (!props.lines.length) return <p className="muted">{t("external.empty")}</p>;
  return (
    <ol className="external-lines">
      {props.lines.map((l, i) => (
        <li key={i} className={`external-line ${l.role}`}>
          {l.role === "user" ? <div className="external-user">{l.text}</div> : <MarkdownMessage text={l.text} />}
        </li>
      ))}
    </ol>
  );
}

/**
 * Read-only view of a session made in Claude desktop / terminal (roadmap 1.10). "Continue in 5ilence"
 * resumes it as a core session (the Risk Engine and the rest of the harness apply from then on).
 */
export function ExternalSessionView(props: { item: ExternalItem; onClose: () => void; onContinue: (item: ExternalItem, lines: ExternalLine[]) => void; canContinue: boolean }) {
  const t = useT();
  const [lines, setLines] = useState<ExternalLine[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true;
    setLines(null);
    setErr("");
    window.silence
      .rpc("session.external_messages", { backend_session_id: props.item.backend_session_id, workspace: props.item.workspace || undefined })
      .then((r) => live && setLines((r as { lines: ExternalLine[] }).lines))
      .catch((e: unknown) => live && setErr(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [props.item]);
  const where = props.item.workspace.split(/[\\/]/).filter(Boolean).pop() ?? "";
  return (
    <section className="external-view" aria-label={props.item.title || t("external.untitled")}>
      <header className="external-head">
        <TerminalSquare size={16} aria-hidden="true" />
        <div className="external-title">
          <h2>{props.item.title || t("external.untitled")}</h2>
          <span className="muted">{t("external.meta", { where: where || "—", when: new Date(props.item.updated_at).toLocaleString() })}</span>
        </div>
        <button type="button" className="btn-solid" disabled={!props.canContinue || !lines} title={props.canContinue ? t("external.continueTip") : t("external.needsWorkspace")} onClick={() => lines && props.onContinue(props.item, lines)}>
          <Play size={14} /> {t("external.continue")}
        </button>
        <button type="button" className="icon-btn" aria-label={t("common.close")} onClick={props.onClose}>
          <X size={16} />
        </button>
      </header>
      <p className="muted external-note">{t("external.readOnly")}</p>
      <div className="external-body">{err ? <p className="perm-error" role="alert">{err}</p> : !lines ? <p className="muted">{t("common.loading")}</p> : <ExternalTranscript lines={lines} />}</div>
    </section>
  );
}
