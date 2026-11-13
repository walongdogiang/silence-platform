/**
 * Studio preferences that are not appearance: chat view, code/terminal fonts, notifications,
 * startup. Stored in `silence.prefs.v1`; every field falls back to its default on bad data.
 */
export type TranscriptView = "compact" | "thinking" | "verbose";
export type ResponseStyle = "default" | "concise" | "explanatory";
/** Days to keep chat history; 0 = forever. */
export type RetentionDays = 0 | 90 | 30 | 7;

export type Prefs = {
  version: 1;
  transcript: TranscriptView;
  autoTitle: boolean;
  responseStyle: ResponseStyle;
  restoreSession: boolean;
  codeFont: string;
  codeFontSize: number;
  minimap: boolean;
  notifyPermission: boolean;
  notifyDone: boolean;
  flashTaskbar: boolean;
  keepAwake: boolean;
  retentionDays: RetentionDays;
};

export const DEFAULT_CODE_FONT = "Cascadia Code, Consolas, monospace";
export const CODE_FONT_SIZES = [12, 13, 14, 15] as const;
export const TRANSCRIPT_VIEWS: TranscriptView[] = ["compact", "thinking", "verbose"];
export const RESPONSE_STYLES: ResponseStyle[] = ["default", "concise", "explanatory"];
export const RETENTION_DAYS: RetentionDays[] = [0, 90, 30, 7];

export const DEFAULT_PREFS: Prefs = {
  version: 1,
  transcript: "compact",
  autoTitle: true,
  responseStyle: "default",
  restoreSession: true,
  codeFont: DEFAULT_CODE_FONT,
  codeFontSize: 13,
  minimap: false,
  notifyPermission: true,
  notifyDone: true,
  flashTaskbar: true,
  keepAwake: false,
  retentionDays: 0,
};

const KEY = "silence.prefs.v1";
const MAX_FONT_LEN = 200;

function pick<V>(v: unknown, allowed: readonly V[], fallback: V): V {
  return allowed.includes(v as V) ? (v as V) : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

/** Keep only valid fields; anything else gets its default. */
export function normalizePrefs(raw: unknown): Prefs {
  const p = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_PREFS;
  const font = typeof p.codeFont === "string" ? p.codeFont.trim().slice(0, MAX_FONT_LEN) : "";
  return {
    version: 1,
    transcript: pick(p.transcript, TRANSCRIPT_VIEWS, d.transcript),
    autoTitle: bool(p.autoTitle, d.autoTitle),
    responseStyle: pick(p.responseStyle, RESPONSE_STYLES, d.responseStyle),
    restoreSession: bool(p.restoreSession, d.restoreSession),
    codeFont: font || d.codeFont,
    codeFontSize: pick(p.codeFontSize, CODE_FONT_SIZES as readonly number[], d.codeFontSize),
    minimap: bool(p.minimap, d.minimap),
    notifyPermission: bool(p.notifyPermission, d.notifyPermission),
    notifyDone: bool(p.notifyDone, d.notifyDone),
    flashTaskbar: bool(p.flashTaskbar, d.flashTaskbar),
    keepAwake: bool(p.keepAwake, d.keepAwake),
    retentionDays: pick(p.retentionDays, RETENTION_DAYS, d.retentionDays),
  };
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizePrefs(JSON.parse(raw)) : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(next: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: preferences last for this run only */
  }
}


/**
 * Which parts of an agent turn start open, per Settings → Chat → default view.
 * compact = today's behaviour (open while live, thought opens once it has text);
 * thinking = the turn and its thought stay open; verbose = everything open, tool output too.
 * The user can still fold any block by hand.
 */
export function transcriptOpen(
  view: TranscriptView,
  s: { live: boolean; thoughtHasBody: boolean; thinkingLive: boolean; hasSteps: boolean; hasThought: boolean },
) {
  const thought = s.thoughtHasBody || s.thinkingLive;
  if (view === "verbose") return { meta: true, thought: true, explored: s.hasSteps, tools: true };
  if (view === "thinking") return { meta: s.live || s.hasThought, thought, explored: s.live && s.hasSteps, tools: false };
  return { meta: s.live, thought, explored: s.live && s.hasSteps, tools: false };
}
