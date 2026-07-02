// Wire Monaco to load entirely from local node_modules (no CDN) and to spin up
// its language workers via Vite's `?worker` imports. Electron may run offline and
// from a non-http origin, so the default @monaco-editor/react CDN loader won't do.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "json") return new jsonWorker();
    if (label === "css" || label === "scss" || label === "less") return new cssWorker();
    if (label === "html" || label === "handlebars" || label === "razor") return new htmlWorker();
    if (label === "typescript" || label === "javascript") return new tsWorker();
    return new editorWorker();
  },
};

/** Warm Ink editor theme — matches the app's liquid-glass tokens instead of vs-dark. */
export const RCW_MONACO_THEME = "rcw-warm-ink";

let configured = false;
/** Idempotently point @monaco-editor/react at the bundled monaco instance + theme. */
export function ensureMonaco(): void {
  if (configured) return;
  loader.config({ monaco });
  monaco.editor.defineTheme(RCW_MONACO_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6B6052", fontStyle: "italic" },
      { token: "keyword", foreground: "E4A672" },
      { token: "string", foreground: "9DBFA8" },
      { token: "number", foreground: "D8A76A" },
      { token: "type", foreground: "C8B08A" },
      { token: "function", foreground: "E8D9BE" },
      { token: "variable", foreground: "F0ECE1" },
      { token: "delimiter", foreground: "A89A85" },
    ],
    colors: {
      // A SOLID warm-ink background — a transparent editor made Monaco's minimap /
      // scrollbar render black bars. Solid matches the theme without artifacts.
      "editor.background": "#17130E",
      "editor.foreground": "#F0ECE1",
      "editorLineNumber.foreground": "#5A5145",
      "editorLineNumber.activeForeground": "#B7A98F",
      "editorCursor.foreground": "#E4A672",
      "editor.selectionBackground": "#E4A67233",
      "editor.lineHighlightBackground": "#FFFFFF08",
      "editorIndentGuide.background1": "#FFFFFF0D",
      "editorGutter.background": "#17130E",
      "minimap.background": "#17130E",
      "minimapSlider.background": "#FFFFFF12",
      "minimapSlider.hoverBackground": "#FFFFFF20",
      "editorOverviewRuler.background": "#17130E",
      "editorWidget.background": "#1B1712",
      "editorWidget.border": "#3A3228",
      "scrollbarSlider.background": "#FFFFFF14",
      "scrollbarSlider.hoverBackground": "#FFFFFF24",
    },
  });
  configured = true;
}

/** Map a file name to a Monaco language id for syntax highlighting. */
export function languageForFile(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const byExt: Record<string, string> = {
    ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
    js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
    json: "json", jsonc: "json",
    md: "markdown", markdown: "markdown",
    css: "css", scss: "scss", less: "less",
    html: "html", htm: "html",
    xml: "xml", svg: "xml",
    yml: "yaml", yaml: "yaml",
    py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
    c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp",
    cs: "csharp", php: "php", swift: "swift", kt: "kotlin",
    sh: "shell", bash: "shell", zsh: "shell", fish: "shell",
    sql: "sql", toml: "ini", ini: "ini", env: "ini",
    dockerfile: "dockerfile", makefile: "makefile",
  };
  if (byExt[ext]) return byExt[ext];
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "makefile") return "makefile";
  return "plaintext";
}
