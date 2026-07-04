import { useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import mermaid from "mermaid";

// Initialize mermaid once, lazily, with a dark theme that fits the HUD. securityLevel
// "loose" lets diagrams use the full syntax; we only ever feed it the user's own notes.
let mermaidReady = false;
function initMermaid(): void {
  if (mermaidReady) return;
  mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose", fontFamily: "ui-monospace, monospace" });
  mermaidReady = true;
}

let mermaidSeq = 0;

/** Render one ```mermaid fenced block to SVG, surfacing syntax errors inline. */
function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const idRef = useRef(`mmd-${++mermaidSeq}`);
  useEffect(() => {
    let alive = true;
    initMermaid();
    mermaid
      .render(idRef.current, code)
      .then((r) => { if (alive) { setSvg(r.svg); setErr(null); } })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [code]);
  if (err) {
    return (
      <pre className="mono" style={{ color: "#e0736a", fontSize: 11, whiteSpace: "pre-wrap", padding: "8px 10px", border: "1px solid rgb(224 115 106 / 0.4)", borderRadius: 8 }}>
        mermaid error: {err}
      </pre>
    );
  }
  return <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

const components: Components = {
  code({ className, children, ...props }) {
    if (className?.includes("language-mermaid")) {
      return <Mermaid code={String(children).replace(/\n$/, "")} />;
    }
    return <code className={className} {...props}>{children}</code>;
  },
};

/**
 * Markdown preview for the Notes app: GFM plus live-rendered ```mermaid diagrams.
 * Styled via the shared `.md` class. react-markdown does not render raw HTML, so
 * this stays XSS-safe apart from the SVG mermaid itself produces from note text.
 */
export default function NotesMarkdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
