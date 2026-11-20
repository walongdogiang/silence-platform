// Conservative shell command splitter for risk classification (PowerShell + POSIX subset).
// Port of crates/runtime/src/risk/command.rs. It never tries to fully understand a shell: it splits a
// command line into segments (`|`, `;`, `&&`, `||`, `&`, newline, `(`, `)`, `{`, `}`), keeps quoted
// text together and flags constructs it cannot see through (`$(…)`, backtick subshells, process
// substitution). Anything flagged is classified at least `ask` by the caller.

export interface Segment {
  /** Words with surrounding quotes removed. `tokens[0]` is the program (if any). */
  tokens: string[];
  /** stdin of this segment is the stdout of the previous one (`a | b`). */
  piped: boolean;
}

export interface Parsed {
  segments: Segment[];
  /** `$(…)`, backtick subshell, `<(…)`/`>(…)`, or unbalanced quotes. */
  dynamic: boolean;
  /** Targets of `>`/`>>` (and `2>`), except null devices. */
  redirects: string[];
}

const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

export function parse(cmd: string): Parsed {
  const p: Parsed = { segments: [], dynamic: false, redirects: [] };
  let cur: string[] = [];
  let word = "";
  let hasWord = false;
  let pipedNext = false;
  let pendingRedirect = false;
  const chars = Array.from(cmd);
  let single = false;
  let double = false;
  let i = 0;

  const endWord = () => {
    if (!hasWord) return;
    if (pendingRedirect) {
      if (!isNullDevice(word)) p.redirects.push(word);
      word = "";
      pendingRedirect = false;
    } else {
      cur.push(word);
      word = "";
    }
    hasWord = false;
  };
  const endSegment = () => {
    if (cur.length) p.segments.push({ tokens: cur, piped: pipedNext });
    cur = [];
    pipedNext = false;
  };

  while (i < chars.length) {
    const c = chars[i]!;
    const next = chars[i + 1];
    if (single) {
      if (c === "'") single = false;
      else word += c;
      i++;
      continue;
    }
    if (double) {
      if (c === '"') double = false;
      else if (c === "$" && next === "(") {
        p.dynamic = true;
        word += c;
      } else if (c === "`") {
        // PowerShell escapes inside double quotes (`n, `t, `", ``) are harmless;
        // anything else may be a POSIX command substitution.
        if (next !== undefined && "ntr0\"'`$".includes(next)) {
          word += c + next;
          i += 2;
          continue;
        }
        p.dynamic = true;
        word += c;
      } else word += c;
      i++;
      continue;
    }
    switch (c) {
      case "'":
        single = true;
        hasWord = true;
        break;
      case '"':
        double = true;
        hasWord = true;
        break;
      case "`":
        p.dynamic = true;
        word += c;
        hasWord = true;
        break;
      case "$":
        if (next === "(") p.dynamic = true;
        word += c;
        hasWord = true;
        break;
      case " ":
      case "\t":
      case "\r":
        endWord();
        break;
      case "\n":
      case ";":
      case "(":
      case ")":
      case "{":
      case "}":
        endWord();
        endSegment();
        break;
      case "|":
        endWord();
        endSegment();
        if (next === "|") i++;
        else pipedNext = true;
        break;
      case "&":
        // `2>&1` / `>&2` are stream merges, not separators.
        if (word.endsWith(">")) {
          word += c;
          hasWord = true;
        } else {
          endWord();
          endSegment();
          if (next === "&") i++;
        }
        break;
      case "<":
      case ">": {
        if (next === "(") {
          p.dynamic = true;
          i++;
          break;
        }
        if (c === "<") {
          word += c;
          hasWord = true;
          break;
        }
        // `2>`, `>>`, `>` start a redirect; `2>&1` is handled here.
        const streamPrefix = Array.from(word).every((ch) => isDigit(ch) || ch === "*");
        if (hasWord && !streamPrefix) endWord();
        else {
          word = "";
          hasWord = false;
        }
        if (next === ">") i++;
        if (chars[i + 1] === "&") {
          // `>&1`: merge, consume the stream number.
          i += 2;
          while (isDigit(chars[i + 1])) i++;
        } else pendingRedirect = true;
        break;
      }
      default:
        word += c;
        hasWord = true;
    }
    i++;
  }
  if (single || double) p.dynamic = true;
  endWord();
  endSegment();
  return p;
}

function isNullDevice(w: string): boolean {
  return ["$null", "/dev/null", "nul", "null"].includes(w.toLowerCase());
}

/** Canonical program name: basename, lowercase, no Windows extension. */
export function programName(tok: string): string {
  const parts = tok.split(/[/\\]/);
  const base = (parts[parts.length - 1] ?? tok).toLowerCase();
  for (const ext of [".exe", ".cmd", ".bat", ".com", ".ps1"]) {
    if (base.endsWith(ext)) return base.slice(0, -ext.length);
  }
  return base;
}
