import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

// Initialize mermaid once, lazily, with a dark theme that fits the HUD.
let mermaidReady = false;
function initMermaid(): void {
  if (mermaidReady) return;
  mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "loose", fontFamily: "ui-monospace, monospace" });
  mermaidReady = true;
}

let mermaidSeq = 0;

/** Render mermaid source to inline SVG, surfacing syntax errors instead of throwing. */
export default function MermaidView({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const idRef = useRef(`mmd-${++mermaidSeq}`);
  useEffect(() => {
    const src = code.trim();
    if (!src) { setSvg(""); setErr(null); return; }
    let alive = true;
    initMermaid();
    mermaid
      .render(idRef.current, src)
      .then((r) => { if (alive) { setSvg(r.svg); setErr(null); } })
      .catch((e) => { if (alive) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [code]);

  if (!code.trim()) return <span className="mono faint" style={{ fontSize: 11 }}>empty diagram</span>;
  if (err) {
    return (
      <pre className="mono" style={{ color: "#e0736a", fontSize: 11, whiteSpace: "pre-wrap", margin: 0 }}>
        mermaid error: {err}
      </pre>
    );
  }
  return <div style={{ display: "flex", justifyContent: "center" }} dangerouslySetInnerHTML={{ __html: svg }} />;
}
