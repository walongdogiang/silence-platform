/**
 * Message context menu (right-click a chat message): text helpers and history cuts.
 * Spec: docs/frontend/chat.md → "Menu chuột phải trên tin nhắn".
 */
import type { ChatLine } from "./models";

/** Markdown → plain text for "Copy message". Keeps code as is, drops markup. */
export function stripMarkdown(md: string): string {
  const out: string[] = [];
  let fence = false;
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence;
      continue;
    }
    if (fence) {
      out.push(raw);
      continue;
    }
    let s = raw;
    s = s.replace(/^\s{0,3}#{1,6}\s+/, ""); // headings
    s = s.replace(/^\s{0,3}>\s?/, ""); // quotes
    s = s.replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, "$1"); // task list
    s = s.replace(/^(\s*)[-*+]\s+/, "$1• "); // bullets
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(s)) s = ""; // rules
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(s)) continue; // table separator
    if (/^\s*\|.*\|\s*$/.test(s)) s = s.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join("\t");
    s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1"); // images
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text: string, url: string) => (text === url ? text : `${text} (${url})`));
    s = s.replace(/`([^`]+)`/g, "$1");
    s = s.replace(/(\*\*|__)(.+?)\1/g, "$2");
    s = s.replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?!\w)/g, "$1$2");
    s = s.replace(/(^|[^\w_])_(?!\s)([^_]+?)_(?!\w)/g, "$1$2");
    s = s.replace(/~~(.+?)~~/g, "$1");
    out.push(s);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
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
