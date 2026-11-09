// Nạp Monaco từ gói cục bộ thay vì CDN jsdelivr (CSP chỉ cho script 'self', CDN bị chặn nên editor treo ở "Loading...").
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { useEffect, useState } from "react";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

(self as unknown as { MonacoEnvironment: unknown }).MonacoEnvironment = {
  getWorker(_id: string, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

loader.config({ monaco });

// ---- Theme Monaco lấy màu từ token CSS của app (dark/light, đổi palette thì đổi theo) ----

export type SilenceTheme = "silence-dark" | "silence-light";

function parseColor(raw: string): [number, number, number] | null {
  const s = raw.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

/** Mã `#rrggbbaa` cho Monaco (Monaco không hiểu `var()` hay `color-mix`). */
function hex(raw: string, alpha = 1, fallback = "#808080"): string {
  const rgb = parseColor(raw) ?? parseColor(fallback)!;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return "#" + [...rgb, a].map((n) => n.toString(16).padStart(2, "0")).join("");
}

/** Alpha của `rgba(r, g, b, a)`; màu không có alpha thì 1. */
function alphaOf(raw: string): number {
  const m = /^rgba\([^)]*,\s*([\d.]+)\s*\)$/i.exec(raw.trim());
  return m ? Number(m[1]) : 1;
}

function currentMode(): "dark" | "light" {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function defineSilenceThemes(m: typeof monaco = monaco) {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name);
  const mode = currentMode();
  const name: SilenceTheme = mode === "light" ? "silence-light" : "silence-dark";
  // Cùng màu với bảng diff trong chat (token --diff-*), giữ alpha của rgba().
  const keep = (name: string) => hex(v(name), alphaOf(v(name)));
  m.editor.defineTheme(name, {
    base: mode === "light" ? "vs" : "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": hex(v("--workspace")),
      "editorGutter.background": hex(v("--workspace")),
      "editor.foreground": hex(v("--text-primary")),
      "editorLineNumber.foreground": hex(v("--text-muted"), 0.7),
      "editorLineNumber.activeForeground": hex(v("--text-secondary")),
      "editor.lineHighlightBackground": "#00000000",
      "editor.lineHighlightBorder": "#00000000",
      "editorIndentGuide.background1": hex(v("--border-subtle")),
      "editorWidget.background": hex(v("--surface-2")),
      "editorWidget.border": hex(v("--border-ui")),
      "diffEditor.insertedLineBackground": keep("--diff-add-bg"),
      "diffEditor.removedLineBackground": keep("--diff-del-bg"),
      "diffEditor.insertedTextBackground": keep("--diff-add-chg"),
      "diffEditor.removedTextBackground": keep("--diff-del-chg"),
      "diffEditorGutter.insertedLineBackground": keep("--diff-add-bg"),
      "diffEditorGutter.removedLineBackground": keep("--diff-del-bg"),
      "diffEditor.diagonalFill": "#00000000",
      "diffEditor.border": hex(v("--border-subtle")),
      "diffEditor.unchangedRegionBackground": hex(v("--surface-1")),
      "diffEditor.unchangedRegionForeground": hex(v("--text-muted")),
      "diffEditor.unchangedCodeBackground": "#00000000",
      "scrollbarSlider.background": hex(v("--text-primary"), 0.12),
      "scrollbarSlider.hoverBackground": hex(v("--text-primary"), 0.28),
      "scrollbarSlider.activeBackground": hex(v("--text-primary"), 0.42),
    },
  });
  return name;
}

/** Tên theme Monaco theo `data-theme`/`data-palette` của app; định nghĩa lại khi appearance đổi. */
export function useMonacoTheme(): SilenceTheme {
  const [theme, setTheme] = useState<SilenceTheme>(() => defineSilenceThemes());
  useEffect(() => {
    const obs = new MutationObserver(() => {
      const name = defineSilenceThemes();
      monaco.editor.setTheme(name);
      setTheme(name);
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-palette", "style", "class"],
    });
    return () => obs.disconnect();
  }, []);
  return theme;
}

export { monaco };
