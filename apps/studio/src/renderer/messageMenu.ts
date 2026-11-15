/**
 * Message context menu (right-click a chat message): text helpers and history cuts.
 * Spec: docs/frontend/chat.md → "Menu chuột phải trên tin nhắn".
 */
import type { ChatLine } from "./models";

/** Placeholder chars (Private Use Area) that never appear in model output. */
const SLOT_OPEN = "";
const SLOT_CLOSE = "";
const SLOT_RE = /(\d+)/g;

/** Markdown → plain text for "Copy message". Keeps code as is, drops markup. */
export function stripMarkdown(md: string): string {
  const out: string[] = [];
  /** Open fence: its char and length; it closes only on the same char, at least as long. */
  let fence: { ch: string; len: number } | null = null;
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const f = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(raw);
    if (f) {
      const ch = f[1][0];
      const len = f[1].length;
      if (!fence) {
        fence = { ch, len };
        continue;
      }
      if (ch === fence.ch && len >= fence.len && !f[2].trim()) {
        fence = null;
        continue;
      }
    }
    if (fence) {
      out.push(raw);
      continue;
    }
    // Inline code and escaped punctuation are literal: set them aside so markup rules never touch them.
    const kept: string[] = [];
    const slot = (text: string) => {
      kept.push(text);
      return `${SLOT_OPEN}${kept.length - 1}${SLOT_CLOSE}`;
    };
    let s = raw.replace(/(`+)(.+?)\1/g, (_, _ticks: string, body: string) => slot(body.trim() || body));
    s = s.replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, (_, ch: string) => slot(ch));
    s = s.replace(/^\s{0,3}#{1,6}\s+/, ""); // headings
    s = s.replace(/^\s{0,3}(>\s?)+/, ""); // quotes, nested too
    s = s.replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, "$1"); // task list
    s = s.replace(/^(\s*)[-*+]\s+/, "$1• "); // bullets
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(s)) s = ""; // rules
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(s)) continue; // table separator
    if (/^\s*\|.*\|\s*$/.test(s)) s = s.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join("\t");
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1"); // images
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, text: string, url: string) =>
      text === url ? text : `${text} (${url})`,
    );
    s = s.replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1"); // autolinks
    s = s.replace(/(\*\*|__)(.+?)\1/g, "$2");
    s = s.replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?!\w)/g, "$1$2");
    s = s.replace(/(^|[^\w_])_(?!\s)([^_]+?)_(?!\w)/g, "$1$2");
    s = s.replace(/~~(.+?)~~/g, "$1");
    s = s.replace(SLOT_RE, (_, i: string) => kept[Number(i)] ?? "");
    out.push(s);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Composer images after Rewind: the message's images first, then any the draft already had. */
export function rewindImages(message: string[] | undefined, draft: string[]): string[] {
  if (!message?.length) return draft;
  return [...message, ...draft.filter((x) => !message.includes(x))];
}

/** "Attach message as context": a Markdown quote the user can write under. */
export function quoteBlock(text: string): string {
  const body = text.trim();
  if (!body) return "";
  return body
    .split(/\r?\n/)
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");
}

/** Adds a quoted message to the composer draft: after what is there, then an empty line to type on. */
export function attachToPrompt(prompt: string, text: string): string {
  const quote = quoteBlock(text);
  if (!quote) return prompt;
  const head = prompt.replace(/\s+$/, "");
  return `${head ? `${head}\n\n` : ""}${quote}\n\n`;
}

/** User messages before line `idx` = how many user turns the Engine keeps when cutting there. */
export function userTurnsBefore(lines: ChatLine[], idx: number): number {
  let n = 0;
  for (let i = 0; i < Math.min(idx, lines.length); i++) if (lines[i].kind === "user") n++;
  return n;
}

/** First user message at or after `idx` (the first one a cut at `idx` drops). */
export function firstUserFrom(lines: ChatLine[], idx: number): Extract<ChatLine, { kind: "user" }> | undefined {
  for (let i = Math.max(0, idx); i < lines.length; i++) {
    const l = lines[i];
    if (l.kind === "user") return l;
  }
  return undefined;
}

/**
 * Params for `session.rewind` / `session.fork` when the history is cut before line `idx`.
 * `undefined` keep = nothing is dropped (whole history).
 */
export function cutParams(lines: ChatLine[], idx: number): { keep_user_turns?: number; text?: string } {
  const next = firstUserFrom(lines, idx);
  if (!next) return {};
  return { keep_user_turns: userTurnsBefore(lines, idx), text: next.text };
}

/** Composer text after Rewind: the message back, with any unsent draft kept below it. */
export function rewindPrompt(message: string, draft: string): string {
  const d = draft.trim();
  if (!d || d === message.trim()) return message;
  return `${message}\n\n${d}`;
}
