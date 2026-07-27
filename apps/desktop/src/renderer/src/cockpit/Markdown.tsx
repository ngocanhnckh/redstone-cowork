import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "../store";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

// Only the languages this cockpit actually shows — highlight.js's full bundle is
// ~1MB and most of it is dead weight here.
for (const [name, lang] of [
  ["bash", bash], ["css", css], ["go", go], ["ini", ini], ["java", java],
  ["javascript", javascript], ["json", json], ["markdown", markdown], ["php", php],
  ["python", python], ["rust", rust], ["sql", sql], ["typescript", typescript],
  ["xml", xml], ["yaml", yaml],
] as const) hljs.registerLanguage(name, lang as never);
// Common aliases seen in Claude's fences.
const ALIAS: Record<string, string> = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript", sh: "bash", shell: "bash", zsh: "bash",
  console: "bash", py: "python", rs: "rust", yml: "yaml", html: "xml", vue: "xml",
  md: "markdown", env: "ini", toml: "ini", golang: "go",
};

/** Syntax-highlighted fenced block. Falls back to plain text for unknown languages
 *  or if highlighting throws — a code block must never break the transcript. */
function HighlightedCode({ lang, text, className, props }:
  { lang: string; text: string; className?: string; props: Record<string, unknown> }) {
  const id = ALIAS[lang] ?? lang;
  if (!hljs.getLanguage(id)) return <code className={className} {...props}>{text}</code>;
  let html: string;
  try {
    html = hljs.highlight(text, { language: id, ignoreIllegals: true }).value;
  } catch {
    return <code className={className} {...props}>{text}</code>;
  }
  // hljs escapes the source, so the result is markup-safe token spans only.
  return <code className={`${className ?? ""} hljs`} {...props} dangerouslySetInnerHTML={{ __html: html }} />;
}

// Color each line of a ```diff fenced block: additions green, removals red,
// everything else default. Keeps the monospace layout react-markdown gives us.
function DiffCode({ text }: { text: string }) {
  const lines = text.replace(/\n$/, "").split("\n");
  return (
    <>
      {lines.map((line, i) => {
        // Additions used to be var(--accent); that token is now signal red, so
        // added and removed lines rendered identically. Removals keep red (the
        // "something went away" signal), additions read as bright chalk.
        const color = line.startsWith("+")
          ? "var(--text)"
          : line.startsWith("-")
            ? "#e63b2e"
            : undefined;
        return (
          <span key={i} style={color ? { color } : undefined}>
            {line}
            {i < lines.length - 1 ? "\n" : ""}
          </span>
        );
      })}
    </>
  );
}

// A plain left-click on a chat/preview link opens it in the focused session's
// IN-APP workspace browser (a new tab) rather than kicking out to the OS browser.
// Modifier-clicks (⌘/Ctrl/Shift), middle-click, and right-click fall through to
// default handling — the main-process context menu still offers "Open in Real
// Browser". Non-http(s) links (mailto:, etc.) also fall through to the OS.
function onLinkClick(e: React.MouseEvent<HTMLAnchorElement>, href?: string) {
  if (!href) return;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (!/^https?:\/\//i.test(href)) return; // let the OS handle mailto:/tel:/etc.
  e.preventDefault();
  const st = useStore.getState();
  const sid = st.focusId;
  if (sid) {
    st.openUrlInBrowser(sid, href);
    if (st.mode !== "hud") st.setActiveTab(sid, "browser");
  } else {
    window.cowork.openExternal(href).catch(() => {});
  }
}

const components: Components = {
  a({ href, children, ...props }) {
    return (
      <a href={href} {...props} onClick={(e) => onLinkClick(e, href)}>
        {children}
      </a>
    );
  },
  code({ className, children, ...props }) {
    if (className?.includes("language-diff")) {
      return (
        <code className={className} {...props}>
          <DiffCode text={String(children)} />
        </code>
      );
    }
    const lang = /language-([\w+-]+)/.exec(className ?? "")?.[1];
    // Only fenced blocks carry a language class; inline `code` stays plain.
    if (lang) {
      return <HighlightedCode lang={lang} text={String(children).replace(/\n$/, "")} className={className} props={props} />;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

// Above this, parsing markdown into a React tree gets heavy enough to stutter the
// single renderer thread — so we render it as plain text instead. Real chat messages
// are capped far below this; only pathological content (a huge pasted blob / file)
// trips it, and a frozen app is worse than unformatted text.
const MD_MAX = 80_000;

// Renders Claude's markdown output (headings, lists, bold, inline + fenced code,
// tables via GFM) styled to the liquid-glass theme via the `.md` CSS class.
// react-markdown does not render raw HTML by default, so this is XSS-safe.
// Fenced ```diff blocks get per-line +/- coloring.
export default function Markdown({ children }: { children: string }) {
  if (children && children.length > MD_MAX) {
    // Defensive: never let one giant blob block the whole UI. Show it as plain text.
    return <pre className="md" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>{children}</pre>;
  }
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
