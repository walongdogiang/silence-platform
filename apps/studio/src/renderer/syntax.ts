import { useEffect, useState } from "react";

export type Tok = { text: string; cls: string };

/** Alias fence / đuôi file → id ngôn ngữ Monaco. */
const LANG: Record<string, string> = {
  py: "python", python: "python", pyw: "python",
  ts: "typescript", tsx: "typescript", typescript: "typescript", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript", javascript: "javascript", node: "javascript",
  rs: "rust", rust: "rust",
  go: "go", golang: "go",
  java: "java", kt: "kotlin", kts: "kotlin", kotlin: "kotlin", swift: "swift",
  c: "cpp", h: "cpp", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", "c++": "cpp",
  cs: "csharp", csharp: "csharp",
  rb: "ruby", ruby: "ruby", php: "php",
  json: "json", jsonc: "json", json5: "json",
  css: "css", scss: "scss", less: "less",
  html: "html", htm: "html", vue: "html", svelte: "html",
  xml: "xml", svg: "xml",
  md: "markdown", markdown: "markdown",
  sh: "shell", bash: "shell", zsh: "shell", shell: "shell", console: "shell",
  ps1: "powershell", psm1: "powershell", powershell: "powershell", pwsh: "powershell",
  bat: "bat", cmd: "bat",
  yaml: "yaml", yml: "yaml",
  toml: "ini", ini: "ini", cfg: "ini", conf: "ini", env: "ini",
  sql: "sql", dockerfile: "dockerfile", graphql: "graphql", gql: "graphql",
  lua: "lua", r: "r", dart: "dart", scala: "scala",
};

/** Id ngôn ngữ Monaco từ tên fence (`python`) hoặc đường dẫn (`src/a.tsx`). */
export function languageFor(hint: string | undefined): string {
  if (!hint) return "plaintext";
  const h = hint.trim().toLowerCase();
  if (LANG[h]) return LANG[h];
  const base = h.split(/[\\/]/).pop() ?? h;
  if (base === "dockerfile") return "dockerfile";
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
  return LANG[ext] ?? "plaintext";
}

/** `keyword.python` → `tk-keyword`; `delimiter.parenthesis` → `tk-punct`. */
export function tokenClass(type: string): string {
  const t = type.toLowerCase();
  if (!t) return "";
  if (t.startsWith("comment")) return "tk-comment";
  if (t.startsWith("string") || t.startsWith("attribute.value")) return "tk-string";
  if (t.startsWith("keyword") || t.startsWith("storage")) return "tk-keyword";
  if (t.startsWith("number") || t.startsWith("constant")) return "tk-number";
  if (t.startsWith("type") || t.startsWith("annotation") || t.startsWith("predefined")) return "tk-type";
  if (t.startsWith("regexp")) return "tk-regexp";
  if (t.startsWith("tag") || t.startsWith("metatag")) return "tk-tag";
  if (t.startsWith("attribute")) return "tk-attr";
  if (t.startsWith("delimiter") || t.startsWith("operator")) return "tk-punct";
  if (t.startsWith("variable")) return "tk-attr";
  return "";
}

const ready = new Map<string, Promise<void>>();

/** Tách `text` thành token theo dòng bằng tokenizer của Monaco (nạp động, không innerHTML). */
export async function tokenizeLines(text: string, lang: string): Promise<Tok[][]> {
  const lines = text.split("\n");
  if (lang === "plaintext") return lines.map((l) => [{ text: l, cls: "" }]);
  const { monaco } = await import("./monaco");
  if (!ready.has(lang)) ready.set(lang, monaco.editor.colorize("", lang, {}).then(() => undefined));
  await ready.get(lang);
  const all = monaco.editor.tokenize(text, lang);
  return lines.map((line, i) => {
    const toks = all[i] ?? [];
    if (toks.length === 0) return [{ text: line, cls: "" }];
    return toks.map((t, k) => ({
      text: line.slice(t.offset, k + 1 < toks.length ? toks[k + 1].offset : line.length),
      cls: tokenClass(t.type),
    }));
  });
}

/** Token theo dòng; `null` khi chưa có (UI hiện chữ thường trước). Debounce khi đang stream. */
export function useTokens(text: string, lang: string): Tok[][] | null {
  const [state, setState] = useState<{ key: string; toks: Tok[][] } | null>(null);
  const key = `${lang}\u0000${text}`;
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      tokenizeLines(text, lang)
        .then((toks) => {
          if (alive) setState({ key, toks });
        })
        .catch(() => {
          /* tokenizer lỗi → giữ chữ thường */
        });
    }, 120);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, text, lang]);
  if (!state) return null;
  if (state.key === key) return state.toks;
  // Đang stream: giữ token cũ cho dòng nào nội dung chưa đổi, dòng mới hiện chữ thường (tránh nháy).
  return text.split("\n").map((line, i) => {
    const old = state.toks[i];
    return old && old.map((t) => t.text).join("") === line ? old : [{ text: line, cls: "" }];
  });
}
