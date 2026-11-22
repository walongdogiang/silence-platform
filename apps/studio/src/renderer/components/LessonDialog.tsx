import { useEffect, useMemo, useRef, useState } from "react";
import { GraduationCap } from "lucide-react";
import { useT, type T } from "../i18n";
import { diffHunks, summarizeDiff } from "../diffSummary";
import { DiffTable } from "./CodeView";
import { DiffStat } from "./DiffCard";

/** `lesson.propose` result (TS core, roadmap 1.9). */
export type LessonEdit = { file: string; kind: "profile" | "project_profile" | "verify" | "skill"; before: string; after: string; reason: string; isNew: boolean };
export type LessonProposal = { lesson_id: string; project: string; model: string; summary: string; edits: LessonEdit[]; warnings: string[] };
/** `lesson.apply` result. */
export type LessonApplied = { written: string[]; lessonFile: string; commit: string | null; pushed: boolean; note?: string };

export const LESSON_MODELS = ["haiku", "sonnet", "opus"] as const;

type Step =
  | { s: "write" }
  | { s: "proposing" }
  | { s: "review"; p: LessonProposal; accept: Set<number> }
  | { s: "applying"; p: LessonProposal }
  | { s: "done"; r: LessonApplied };

const lang = (file: string) => (file.endsWith(".yaml") ? "yaml" : "markdown");

/** One line about where the change was saved. */
export function appliedText(r: LessonApplied, t: T): string {
  if (!r.commit) return t("lesson.savedOnly", { n: r.written.length });
  return r.pushed ? t("lesson.pushed", { sha: r.commit, n: r.written.length }) : t("lesson.committed", { sha: r.commit, n: r.written.length });
}

/** Review of one proposed edit: file, reason, +/- and the diff; checkbox to accept it. */
export function LessonEditView(props: { edit: LessonEdit; checked: boolean; onToggle: () => void; disabled?: boolean }) {
  const t = useT();
  const e = props.edit;
  const sum = useMemo(() => summarizeDiff(e.before, e.after), [e]);
  const hunks = useMemo(() => diffHunks(e.before, e.after), [e]);
  return (
    <li className="lesson-edit">
      <label className="lesson-edit-head">
        <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={props.onToggle} />
        <code>~/.silence/{e.file}</code>
        {e.isNew ? <span className="lesson-new">{t("lesson.newFile")}</span> : null}
        <DiffStat added={sum.added} removed={sum.removed} />
      </label>
      {e.reason ? <p className="lesson-reason">{e.reason}</p> : null}
      <div className="lesson-diff">
        <DiffTable hunks={hunks} lang={lang(e.file)} />
      </div>
    </li>
  );
}

/**
 * "Record a lesson" (roadmap 1.9): the user says what should be different after a turn; one Claude
 * call proposes edits to ~/.silence (profile, project profile, verify.yaml, skills); the user picks
 * which diffs to keep; the core writes them, commits and pushes. Nothing is written before Apply.
 */
export function LessonDialog(props: {
  workspace: string;
  /** The turn the lesson is about. */
  user: string;
  answer: string;
  onClose: () => void;
  /** Test hook: start on this step. */
  initial?: Step;
}) {
  const t = useT();
  const [step, setStep] = useState<Step>(props.initial ?? { s: "write" });
  const [text, setText] = useState("");
  const [model, setModel] = useState<(typeof LESSON_MODELS)[number]>("haiku");
  const [err, setErr] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const busy = step.s === "proposing" || step.s === "applying";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, props]);

  async function propose() {
    setErr("");
    setStep({ s: "proposing" });
    try {
      const p = (await window.silence.rpc("lesson.propose", { workspace: props.workspace, text, user: props.user, answer: props.answer, model })) as LessonProposal;
      setStep({ s: "review", p, accept: new Set(p.edits.map((_, i) => i)) });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStep({ s: "write" });
    }
  }

  async function apply(p: LessonProposal, accept: Set<number>) {
    setErr("");
    setStep({ s: "applying", p });
    try {
      const r = (await window.silence.rpc("lesson.apply", { lesson_id: p.lesson_id, accept: [...accept] })) as LessonApplied;
      setStep({ s: "done", r });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStep({ s: "review", p, accept });
    }
  }

  return (
    <div className="unsaved-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && props.onClose()}>
      <div ref={boxRef} className="unsaved-dialog lesson-dialog" role="dialog" aria-modal="true" aria-labelledby="lesson-title">
        <h3 id="lesson-title">
          <span className="confirm-ico">
            <GraduationCap size={16} />
          </span>
          {t("lesson.title")}
        </h3>

        {step.s === "write" || step.s === "proposing" ? (
          <>
            <p>{t("lesson.intro")}</p>
            <textarea
              className="lesson-input"
              value={text}
              autoFocus
              rows={4}
              disabled={step.s === "proposing"}
              placeholder={t("lesson.placeholder")}
              aria-label={t("lesson.placeholder")}
              onChange={(e) => setText(e.target.value)}
            />
            <label className="lesson-model">
              {t("lesson.model")}
              <select value={model} disabled={step.s === "proposing"} onChange={(e) => setModel(e.target.value as (typeof LESSON_MODELS)[number])}>
                {LESSON_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m[0]!.toUpperCase() + m.slice(1)}
                  </option>
                ))}
              </select>
              <span className="muted">{t("lesson.quota")}</span>
            </label>
          </>
        ) : null}

        {step.s === "review" || step.s === "applying" ? (
          <ReviewStep
            p={step.p}
            accept={step.s === "review" ? step.accept : new Set(step.p.edits.map((_, i) => i))}
            disabled={step.s === "applying"}
            onToggle={(i) => {
              if (step.s !== "review") return;
              const next = new Set(step.accept);
              if (next.has(i)) next.delete(i);
              else next.add(i);
              setStep({ ...step, accept: next });
            }}
          />
        ) : null}

        {step.s === "done" ? (
          <>
            <p role="status">{appliedText(step.r, t)}</p>
            {step.r.note ? <p className="perm-error">{step.r.note}</p> : null}
            <p className="muted">{t("lesson.noteFile", { file: step.r.lessonFile })}</p>
          </>
        ) : null}

        {err ? (
          <p className="perm-error" role="alert">
            {err}
          </p>
        ) : null}

        <div className="unsaved-actions">
          {step.s === "done" ? (
            <button type="button" className="btn-solid" onClick={props.onClose}>
              {t("common.close")}
            </button>
          ) : (
            <>
              <button type="button" className="btn-light" disabled={busy} onClick={props.onClose}>
                {t("common.cancel")}
              </button>
              {step.s === "write" || step.s === "proposing" ? (
                <button type="button" className="btn-solid" disabled={busy || !text.trim()} onClick={() => void propose()}>
                  {step.s === "proposing" ? t("lesson.proposing") : t("lesson.propose")}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-solid"
                  disabled={busy}
                  onClick={() => step.s === "review" && void apply(step.p, step.accept)}
                >
                  {step.s === "applying"
                    ? t("lesson.applying")
                    : step.s === "review" && step.accept.size === 0
                      ? t("lesson.saveOnly")
                      : t("lesson.apply", { n: step.s === "review" ? step.accept.size : 0 })}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ReviewStep(props: { p: LessonProposal; accept: Set<number>; disabled: boolean; onToggle: (i: number) => void }) {
  const t = useT();
  const { p } = props;
  return (
    <>
      <p>
        <strong>{p.summary}</strong>
      </p>
      <p className="muted">{t("lesson.reviewHint", { model: p.model })}</p>
      {p.edits.length ? (
        <ul className="lesson-edits">
          {p.edits.map((e, i) => (
            <LessonEditView key={e.file} edit={e} checked={props.accept.has(i)} disabled={props.disabled} onToggle={() => props.onToggle(i)} />
          ))}
        </ul>
      ) : (
        <p className="muted">{t("lesson.noEdits")}</p>
      )}
      {p.warnings.length ? (
        <ul className="perm-reasons" aria-label={t("lesson.dropped")}>
          {p.warnings.map((w) => (
            <li key={w}>{t("lesson.droppedItem", { what: w })}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
