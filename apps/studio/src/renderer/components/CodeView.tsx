import { Check, Copy, FileCode2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type { DiffHunk } from "../diffSummary";
import { languageFor, useTokens, type Tok } from "../syntax";
import { inlineChanges, type ParsedDiff } from "../unifiedDiff";

/** Một dòng code có màu; `mark` = vùng [s, e) được tô đậm (phần chữ đổi trong diff). */
export function TokenLine(props: { text: string; tokens?: Tok[] | null; mark?: [number, number] }) {
  const toks = props.tokens ?? [{ text: props.text, cls: "" }];
  const mark = props.mark;
  if (!props.text) return <>{" "}</>;
  const out: ReactNode[] = [];
  let pos = 0;
  toks.forEach((t, i) => {
    const s = pos;
    const e = pos + t.text.length;
    pos = e;
    if (!t.text) return;
    if (!mark || e <= mark[0] || s >= mark[1]) {
      out.push(
        <span key={i} className={t.cls || undefined}>
          {t.text}
        </span>,
      );
      return;
    }
    // Cắt token tại ranh giới vùng đổi.
    const a = Math.max(s, mark[0]);
    const b = Math.min(e, mark[1]);
    const before = t.text.slice(0, a - s);
    const mid = t.text.slice(a - s, b - s);
    const after = t.text.slice(b - s);
    out.push(
      <span key={i} className={t.cls || undefined}>
        {before}
        <mark className="chg">{mid}</mark>
        {after}
      </span>,
    );
  });
  return <>{out}</>;
}

export function CopyButton(props: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className="code-copy"
      title={done ? "Đã chép" : "Chép"}
      aria-label={done ? "Đã chép" : (props.label ?? "Chép code")}
      onClick={() => {
        void navigator.clipboard?.writeText(props.text).then(() => setDone(true));
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      <span>{done ? "Đã chép" : "Copy"}</span>
    </button>
  );
}

/** Bảng diff unified: vạch màu | số dòng | code có syntax highlight + tô phần chữ đổi. */
export function DiffTable(props: { hunks: DiffHunk[]; lang: string }) {
  const flat = useMemo(() => props.hunks.flatMap((h) => h.rows), [props.hunks]);
  const text = useMemo(() => flat.map((r) => r.text).join("\n"), [flat]);
  const tokens = useTokens(text, props.lang);
  const marks = useMemo(() => {
    // Chỉ số hàng trong từng hunk → chỉ số phẳng.
    const out = new Map<number, [number, number]>();
    let base = 0;
    for (const h of props.hunks) {
      for (const [i, r] of inlineChanges(h.rows)) out.set(base + i, r);
      base += h.rows.length;
    }
    return out;
  }, [props.hunks]);
  const numbered = flat.some((r) => r.oldNo !== undefined || r.newNo !== undefined);

  let idx = 0;
  return (
    <table className={`diff-table${numbered ? "" : " no-ln"}`}>
      <tbody>
        {props.hunks.map((h, hi) => (
          <Fragment key={hi}>
            {(h.skippedBefore > 0 || (hi > 0 && !numbered)) && (
              <tr className="diff-skip">
                <td colSpan={3}>{h.skippedBefore > 0 ? `⋯ ${h.skippedBefore} dòng không đổi` : "⋯"}</td>
              </tr>
            )}
            {h.rows.map((r) => {
              const i = idx++;
              return (
                <tr
                  key={i}
                  className={`diff-row ${r.kind}`}
                  aria-label={r.kind === "add" ? "thêm" : r.kind === "del" ? "xoá" : undefined}
                >
                  <td className="mk" aria-hidden />
                  {numbered && <td className="ln">{r.kind === "del" ? r.oldNo : r.newNo}</td>}
                  <td className="code">
                    <TokenLine text={r.text} tokens={tokens?.[i]} mark={marks.get(i)} />
                  </td>
                </tr>
              );
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

/** Code block thường trong câu trả lời: header ngôn ngữ + Copy, body có highlight. */
export function CodeBlock(props: { lang?: string; text: string }) {
  const text = props.text.replace(/\n$/, "");
  const lang = languageFor(props.lang);
  const tokens = useTokens(text, lang);
  const lines = text.split("\n");
  return (
    <div className="code-card">
      <div className="code-card-head">
        <span className="code-lang">{props.lang || "text"}</span>
        <CopyButton text={text} />
      </div>
      <pre className="code-body">
        <code>
          {lines.map((l, i) => (
            <Fragment key={i}>
              <TokenLine text={l} tokens={tokens?.[i]} />
              {i < lines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </code>
      </pre>
    </div>
  );
}

/** Khối ```diff trong câu trả lời: header đường dẫn + `+N −M` + Copy, body là `DiffTable`. */
export function DiffBlock(props: {
  text: string;
  parsed: ParsedDiff;
  fenceLang?: string;
  openPath?: string | null;
  onOpenFile?: (path: string) => void;
}) {
  const { parsed } = props;
  const lang = languageFor(parsed.path ?? (props.fenceLang !== "diff" ? props.fenceLang : undefined));
  const path = parsed.path ?? "diff";
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const canOpen = Boolean(props.openPath && props.onOpenFile);
  const label = (
    <span className="diff-path">
      {dir && <span className="dir">{dir}</span>}
      <span className="name">{name}</span>
    </span>
  );
  return (
    <div className="code-card diff-block">
      <div className="code-card-head">
        <FileCode2 size={14} aria-hidden className="code-icon" />
        {canOpen ? (
          <button
            type="button"
            className="code-path-btn"
            title={`Mở ${props.openPath}`}
            onClick={() => props.onOpenFile!(props.openPath!)}
          >
            {label}
          </button>
        ) : (
          label
        )}
        <span className="diff-stat">
          <span className="add">+{parsed.added}</span>
          <span className="del">−{parsed.removed}</span>
        </span>
        <CopyButton text={props.text.replace(/\n$/, "")} label="Chép diff" />
      </div>
      <div className="code-card-body">
        <DiffTable hunks={parsed.hunks} lang={lang} />
      </div>
    </div>
  );
}
