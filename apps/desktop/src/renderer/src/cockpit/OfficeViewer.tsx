import { useEffect, useMemo, useState } from "react";

/** Office file types we render inline (Tier 1: client-side, no server). */
export function isOfficeFile(name: string): boolean {
  return /\.(xlsx|xlsm|xls|docx|pptx)$/i.test(name);
}
function extOf(name: string): string {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}
function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

interface Props {
  cwd: string;
  machine: string;
  path: string;
  base64: string;
  name: string;
}

/**
 * Inline viewer/editor for Office documents in the file browser (Tier 1, all
 * client-side). Excel is a real editable grid that saves back; Word and PowerPoint
 * are faithful-ish read-only previews (round-tripping those formats needs a document
 * server, which is a separate feature).
 */
export default function OfficeViewer(props: Props) {
  const ext = extOf(props.name);
  if (ext === "docx") return <WordPreview {...props} />;
  if (ext === "pptx") return <PptxPreview {...props} />;
  return <ExcelGrid {...props} />; // xlsx/xlsm/xls
}

const wrapStyle: React.CSSProperties = { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" };
const barStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, padding: "7px 12px",
  borderBottom: "1px solid var(--border)", flexShrink: 0, flexWrap: "wrap",
};

function Loading({ label }: { label: string }) {
  return <div className="faint mono hud-blink" style={{ fontSize: 12, padding: 16 }}>{label}</div>;
}
function ErrBox({ msg }: { msg: string }) {
  return <div style={{ fontSize: 12.5, color: "#e0736a", padding: 16, lineHeight: 1.5 }}>⚠ {msg}</div>;
}

/* ------------------------------ Excel ------------------------------ */

type Grid = string[][];

function ExcelGrid({ cwd, machine, path, base64, name }: Props) {
  const [state, setState] = useState<"loading" | "ok" | "err">("loading");
  const [err, setErr] = useState("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [grids, setGrids] = useState<Record<string, Grid>>({});
  const [edit, setEdit] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    setState("loading");
    (async () => {
      try {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(base64, { type: "base64" });
        const next: Record<string, Grid> = {};
        for (const n of wb.SheetNames) {
          next[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: "", blankrows: true }) as unknown as Grid;
        }
        if (!alive) return;
        setSheetNames(wb.SheetNames);
        setGrids(next);
        setActive(0);
        setState("ok");
      } catch (e) {
        if (alive) { setErr(e instanceof Error ? e.message : String(e)); setState("err"); }
      }
    })();
    return () => { alive = false; };
  }, [base64]);

  const sheet = sheetNames[active];
  const grid = sheet ? grids[sheet] ?? [] : [];
  const cols = useMemo(() => grid.reduce((m, r) => Math.max(m, r.length), 0), [grid]);

  const setCell = (r: number, c: number, v: string) => {
    setDirty(true);
    setGrids((cur) => {
      const g = (cur[sheet] ?? []).map((row) => row.slice());
      while (g.length <= r) g.push([]);
      while (g[r].length <= c) g[r].push("");
      g[r][c] = v;
      return { ...cur, [sheet]: g };
    });
  };

  const save = async () => {
    if (!edit || saving) return;
    setSaving(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      for (const n of sheetNames) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grids[n] ?? []), n.slice(0, 31));
      }
      const out = XLSX.write(wb, { type: "base64", bookType: "xlsx" }) as string;
      const res = await window.cowork.writeFileBase64({ cwd, machine, file: path, base64: out });
      if (!res.ok) throw new Error(res.error ?? "write failed");
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setState("err");
    } finally {
      setSaving(false);
    }
  };

  if (state === "loading") return <Loading label="parsing spreadsheet…" />;
  if (state === "err") return <ErrBox msg={err || "Could not read this spreadsheet."} />;

  return (
    <div style={wrapStyle}>
      <div style={barStyle}>
        <span className="mono faint" style={{ fontSize: 11 }}>{name}</span>
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
          {sheetNames.map((n, i) => (
            <button key={n} onClick={() => setActive(i)} className={i === active ? undefined : "glass-inset-hover"}
              style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "2px 9px", fontSize: 11, cursor: "pointer",
                background: i === active ? "rgb(var(--primary) / 0.22)" : "transparent", color: i === active ? "var(--text)" : "var(--text-soft)" }}>
              {n}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-soft)", cursor: "pointer" }}>
          <input type="checkbox" checked={edit} onChange={(e) => setEdit(e.target.checked)} /> Edit
        </label>
        {edit && (
          <button className="glass-btn--clay" onClick={save} disabled={!dirty || saving}
            style={{ padding: "5px 13px", fontSize: 12, fontWeight: 600, opacity: !dirty || saving ? 0.55 : 1 }}>
            {saving ? "Saving…" : saved ? "✓ Saved" : "Save"}
          </button>
        )}
      </div>
      {edit && (
        <div className="faint" style={{ fontSize: 10.5, padding: "5px 12px", borderBottom: "1px solid var(--border)", lineHeight: 1.4 }}>
          Editing saves values + formulas back to the file. Cell styling/formatting and charts are not preserved (client-side limitation).
        </div>
      )}
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, fontFamily: "var(--font-mono)" }}>
          <tbody>
            {grid.map((row, r) => (
              <tr key={r}>
                <td style={{ position: "sticky", left: 0, background: "var(--app-panel)", color: "var(--text-faint)", padding: "2px 6px", border: "1px solid var(--border)", textAlign: "right", fontSize: 10, minWidth: 34, zIndex: 1 }}>{r + 1}</td>
                {Array.from({ length: cols }).map((_, c) => (
                  <td key={c} style={{ border: "1px solid var(--border)", padding: 0, minWidth: 72, maxWidth: 320 }}>
                    {edit ? (
                      <input
                        value={row[c] ?? ""}
                        onChange={(e) => setCell(r, c, e.target.value)}
                        style={{ width: "100%", minWidth: 72, border: "none", background: "transparent", color: "var(--text)", padding: "3px 6px", fontSize: 12, fontFamily: "var(--font-mono)", outline: "none" }}
                      />
                    ) : (
                      <div style={{ padding: "3px 6px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 320 }}>{row[c] ?? ""}</div>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {grid.length === 0 && <div className="faint" style={{ padding: 16, fontSize: 12, fontStyle: "italic" }}>Empty sheet.</div>}
      </div>
    </div>
  );
}

/* ------------------------------ Word ------------------------------ */

function WordPreview({ base64, name }: Props) {
  const [state, setState] = useState<"loading" | "ok" | "err">("loading");
  const [html, setHtml] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setState("loading");
    (async () => {
      try {
        const mammoth = (await import("mammoth")).default ?? (await import("mammoth"));
        const res = await mammoth.convertToHtml({ arrayBuffer: b64ToArrayBuffer(base64) });
        if (alive) { setHtml(res.value); setState("ok"); }
      } catch (e) {
        if (alive) { setErr(e instanceof Error ? e.message : String(e)); setState("err"); }
      }
    })();
    return () => { alive = false; };
  }, [base64]);

  if (state === "loading") return <Loading label="rendering document…" />;
  if (state === "err") return <ErrBox msg={err || "Could not render this document."} />;
  return (
    <div style={wrapStyle}>
      <div style={barStyle}>
        <span className="mono faint" style={{ fontSize: 11 }}>{name}</span>
        <span className="faint" style={{ fontSize: 10.5 }}>· read-only preview</span>
      </div>
      <div className="no-scrollbar jira-rich" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "22px 28px", fontSize: 14, lineHeight: 1.7, color: "var(--text)", background: "rgba(255,255,255,0.02)" }}
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
    </div>
  );
}

/* ---------------------------- PowerPoint ---------------------------- */

function PptxPreview({ base64, name }: Props) {
  const [state, setState] = useState<"loading" | "ok" | "err">("loading");
  const [slides, setSlides] = useState<string[][]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    setState("loading");
    (async () => {
      try {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(b64ToArrayBuffer(base64));
        // Slides are ppt/slides/slideN.xml — sort numerically, extract <a:t> text runs.
        const names = Object.keys(zip.files)
          .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
          .sort((a, b) => (parseInt(a.match(/slide(\d+)/)![1]) - parseInt(b.match(/slide(\d+)/)![1])));
        const out: string[][] = [];
        for (const f of names) {
          const xml = await zip.files[f].async("string");
          const runs = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1])).filter((t) => t.trim());
          out.push(runs);
        }
        if (alive) { setSlides(out); setState("ok"); }
      } catch (e) {
        if (alive) { setErr(e instanceof Error ? e.message : String(e)); setState("err"); }
      }
    })();
    return () => { alive = false; };
  }, [base64]);

  if (state === "loading") return <Loading label="reading slides…" />;
  if (state === "err") return <ErrBox msg={err || "Could not read this presentation."} />;
  return (
    <div style={wrapStyle}>
      <div style={barStyle}>
        <span className="mono faint" style={{ fontSize: 11 }}>{name}</span>
        <span className="faint" style={{ fontSize: 10.5 }}>· {slides.length} slides · text-only preview</span>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
        {slides.map((runs, i) => (
          <div key={i} className="glass-inset" style={{ borderRadius: 12, padding: "16px 18px", border: "1px solid var(--border)" }}>
            <div className="mono faint" style={{ fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: 10 }}>Slide {i + 1}</div>
            {runs.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {runs.map((t, j) => (
                  <div key={j} style={{ fontSize: j === 0 ? 16 : 13, fontWeight: j === 0 ? 600 : 400, color: j === 0 ? "var(--text)" : "var(--text-soft)", lineHeight: 1.5 }}>{t}</div>
                ))}
              </div>
            ) : (
              <div className="faint" style={{ fontSize: 12, fontStyle: "italic" }}>(no text on this slide)</div>
            )}
          </div>
        ))}
        {slides.length === 0 && <div className="faint" style={{ fontSize: 12, fontStyle: "italic", padding: 16 }}>No slides found.</div>}
      </div>
    </div>
  );
}

/* ------------------------------ utils ------------------------------ */

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
}

/** Strip scripts/handlers from mammoth's HTML (it's the user's own doc, but never
 * inject live script). */
function sanitizeHtml(html: string): string {
  return (html || "")
    .replace(/<\s*(script|style|iframe|object|embed)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"');
}
