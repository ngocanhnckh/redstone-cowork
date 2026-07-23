import { useCallback, useEffect, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { ensureMonaco, languageForFile, RCW_MONACO_THEME } from "./monaco-setup";
import OfficeViewer, { isOfficeFile } from "./OfficeViewer";
import Markdown from "./Markdown";
import { playSfx } from "../sfx";

ensureMonaco();

const isMarkdown = (n: string): boolean => /\.(md|markdown)$/i.test(n);

// An eDEX-style file browser: a single-directory navigator of glowing tiles (folders
// first) that reveal with a stagger + a scan cue when a directory loads. Clicking a
// FOLDER descends into it (with the folder cue); clicking a FILE opens a preview/editor
// pane. Separate from the tree-style Files panel — a "mode" you can use instead.

const dirName = (p: string): string => p.replace(/\/+$/, "").split("/").filter(Boolean).pop() || "/";
const parentOf = (p: string): string => { const t = p.replace(/\/+$/, ""); const i = t.lastIndexOf("/"); return i <= 0 ? "/" : t.slice(0, i); };
const ext = (n: string): string => (n.includes(".") ? n.split(".").pop()!.toLowerCase() : "");

// Colored per-type icons (the file-icons look, our own glyph/colour map). Learned from
// eDEX which colours icons by file type; we key on extension groups.
type Ico = { ch: string; c: string };
const IMG = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "heic"];
const VIDEO = ["mp4", "mov", "mkv", "webm", "avi", "m4v"];
const AUDIO = ["mp3", "wav", "flac", "ogg", "m4a", "aac"];
const CODE = ["js", "ts", "tsx", "jsx", "mjs", "cjs", "py", "go", "rs", "c", "h", "cpp", "hpp", "cc", "java", "kt", "rb", "php", "swift", "scala", "lua", "dart", "vue", "svelte"];
const SHELL = ["sh", "bash", "zsh", "fish", "ps1", "bat", "cmd"];
const CONFIG = ["json", "yml", "yaml", "toml", "ini", "cfg", "conf", "xml", "env", "properties"];
const DOC = ["md", "markdown", "txt", "rst", "pdf", "doc", "docx", "rtf"];
const SHEET = ["csv", "tsv", "xls", "xlsx", "ods"];
const ARCHIVE = ["zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar"];
const STYLE = ["css", "scss", "sass", "less"];
const WEB = ["html", "htm"];
const LOCK = ["lock", "sum"];

function iconFor(e: DirEntry): Ico {
  if (e.kind === "dir") return { ch: "▸", c: "rgb(var(--accent))" };
  const x = ext(e.name);
  const name = e.name.toLowerCase();
  if (name.startsWith(".git") || name === ".gitignore") return { ch: "⎇", c: "#e0736a" };
  if (name.startsWith("dockerfile") || name === "docker-compose.yml") return { ch: "❒", c: "#59a7e0" };
  if (IMG.includes(x)) return { ch: "▦", c: "#7fd18b" };
  if (VIDEO.includes(x)) return { ch: "▶", c: "#c8a0f0" };
  if (AUDIO.includes(x)) return { ch: "♪", c: "#e58fc4" };
  if (STYLE.includes(x)) return { ch: "❖", c: "#59a7e0" };
  if (WEB.includes(x)) return { ch: "◍", c: "#e0a24a" };
  if (CODE.includes(x)) return { ch: "‹›", c: "rgb(var(--primary-soft))" };
  if (SHELL.includes(x)) return { ch: "❯", c: "#7fd18b" };
  if (CONFIG.includes(x)) return { ch: "⚙", c: "#e0a24a" };
  if (SHEET.includes(x)) return { ch: "▦", c: "#7fd18b" };
  if (DOC.includes(x)) return { ch: "≣", c: "var(--text-soft)" };
  if (ARCHIVE.includes(x)) return { ch: "▤", c: "#e0a24a" };
  if (LOCK.includes(x)) return { ch: "⎉", c: "var(--text-faint)" };
  return { ch: "◈", c: "rgb(var(--primary-soft))" };
}

const CSS = `
@keyframes rcw-fb-in { from { opacity:0; transform: translateY(6px) scale(.98); } to { opacity:1; transform:none; } }
@keyframes rcw-fb-scan { 0% { top:-4%; } 100% { top:104%; } }
@keyframes rcw-fb-blink { 0%,100% { background: rgb(var(--primary) / 0); } 50% { background: rgb(var(--primary) / 0.7); } }
.rcw-fb { display:flex; flex-direction:column; height:100%; min-height:0; position:relative; }
.rcw-fb-bar { display:flex; align-items:center; gap:6px; padding:8px 12px; border-bottom:1px solid var(--border); flex-shrink:0; font-family:var(--font-mono); font-size:11px; overflow-x:auto; }
.rcw-fb-crumb { cursor:pointer; color:var(--text-soft); white-space:nowrap; }
.rcw-fb-crumb:hover { color: rgb(var(--primary-soft)); }
.rcw-fb-grid { flex:1; min-height:0; overflow-y:auto; padding:12px; display:grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap:10px; align-content:start; position:relative; }
.rcw-fb-scan { position:absolute; left:0; right:0; height:2px; z-index:2; pointer-events:none; opacity:.6;
  background: linear-gradient(90deg, transparent, rgb(var(--primary-soft) / 0.6), transparent); box-shadow:0 0 14px 2px rgb(var(--primary-soft)/0.35); animation: rcw-fb-scan .7s linear; }
.rcw-fb-tile { display:flex; flex-direction:column; align-items:center; gap:7px; padding:14px 8px 11px; border-radius:11px; cursor:pointer;
  border:1px solid var(--border); background: rgb(var(--primary) / 0.04); transition: transform .12s, border-color .12s, box-shadow .12s; animation: rcw-fb-in .2s both; }
.rcw-fb-tile:hover { transform: translateY(-2px); border-color: rgb(var(--primary) / 0.5); box-shadow: 0 0 22px -8px rgb(var(--primary) / 0.7); }
.rcw-fb-tile.dir { border-color: rgb(var(--accent) / 0.28); }
.rcw-fb-tile.dir:hover { border-color: rgb(var(--accent) / 0.6); box-shadow: 0 0 22px -8px rgb(var(--accent) / 0.7); }
.rcw-fb-ico { font-family:var(--font-mono); font-size:24px; line-height:1; text-shadow:0 0 14px currentColor; }
.rcw-fb-name { font-family:var(--font-mono); font-size:10.5px; text-align:center; word-break:break-all; line-height:1.35; max-height:2.7em; overflow:hidden; }
.rcw-fb-preview { position:absolute; inset:0; z-index:5; display:flex; flex-direction:column; background: color-mix(in srgb, var(--app-panel) 96%, transparent); animation: rcw-fb-in .18s ease both; }
.rcw-fb-phd { display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid var(--border); flex-shrink:0; }
`;

export default function FileBrowserEdex({ cwd, machine, active = true }: { sessionId?: string; cwd: string; machine: string; active?: boolean }) {
  const [dir, setDir] = useState(cwd);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanKey, setScanKey] = useState(0);

  const [query, setQuery] = useState("");

  const [openFile, setOpenFile] = useState<string | null>(null);
  const [read, setRead] = useState<FileRead | null>(null);
  const [reading, setReading] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "ok" | "err">("idle");
  const [mdMode, setMdMode] = useState<"preview" | "edit">("preview");
  const gridRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (d: string) => {
    setLoading(true); setError(null);
    playSfx("scan");
    setScanKey((k) => k + 1);
    try {
      const r = await window.cowork.listFiles({ cwd, machine, dir: d });
      if (r.ok) {
        const es = [...r.entries].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
        setEntries(es);
      } else setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [cwd, machine]);

  useEffect(() => { if (active) load(dir); }, [dir, active, load]);
  useEffect(() => { if (gridRef.current) gridRef.current.scrollTop = 0; }, [dir]);

  const enter = (e: DirEntry) => {
    if (e.kind === "dir") { playSfx("folder"); setDir(e.path); return; }
    void openTheFile(e.path);
  };

  async function openTheFile(path: string) {
    setOpenFile(path); setReading(true); setRead(null); setDraft(null); setSaving("idle");
    setMdMode(isMarkdown(path) ? "preview" : "edit");
    try {
      const r = await window.cowork.readFile({ cwd, machine, file: path });
      setRead(r);
      if (r.ok && r.encoding === "text") setDraft(r.content);
    } catch (e) {
      setRead({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally { setReading(false); }
  }

  async function save() {
    if (openFile === null || draft === null) return;
    setSaving("saving");
    try {
      const r = await window.cowork.writeFile({ cwd, machine, file: openFile, content: draft });
      setSaving(r.ok ? "ok" : "err");
      setTimeout(() => setSaving("idle"), 1400);
    } catch { setSaving("err"); setTimeout(() => setSaving("idle"), 1400); }
  }

  // Breadcrumb segments from cwd (root) down to the current dir.
  const rel = dir.startsWith(cwd) ? dir.slice(cwd.length).replace(/^\/+/, "") : dir;
  const segs = rel ? rel.split("/") : [];
  const crumb = (i: number) => setDir(i < 0 ? cwd : cwd + "/" + segs.slice(0, i + 1).join("/"));

  const q = query.trim().toLowerCase();
  const shown = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : entries;

  return (
    <div className="rcw-fb">
      <style>{CSS}</style>
      <div className="rcw-fb-bar no-scrollbar">
        <button
          onClick={() => dir !== cwd && setDir(parentOf(dir))}
          disabled={dir === cwd}
          title="Up one folder"
          style={{ flexShrink: 0, padding: "3px 9px", borderRadius: 7, cursor: dir === cwd ? "not-allowed" : "pointer", opacity: dir === cwd ? 0.4 : 1, border: "1px solid var(--border)", background: "transparent", color: "inherit", fontFamily: "var(--font-mono)", fontSize: 11 }}
        >↑ ..</button>
        <span className="rcw-fb-crumb" onClick={() => crumb(-1)} style={{ color: "rgb(var(--primary-soft))" }}>{dirName(cwd)}</span>
        {segs.map((s, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ opacity: 0.4 }}>/</span>
            <span className="rcw-fb-crumb" onClick={() => crumb(i)}>{s}</span>
          </span>
        ))}
        <span style={{ flex: 1 }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="filter…"
          autoCapitalize="off" autoCorrect="off" spellCheck={false}
          style={{ flexShrink: 0, width: 120, padding: "3px 9px", borderRadius: 7, fontFamily: "var(--font-mono)", fontSize: 11, border: "1px solid var(--border)", background: "rgb(0,0,0,0.18)", color: "inherit", outline: "none" }}
        />
        <span className="mono faint" style={{ fontSize: 9.5, flexShrink: 0 }}>{shown.length}{q ? `/${entries.length}` : ""} items</span>
      </div>

      <div className="rcw-fb-grid no-scrollbar" ref={gridRef}>
        <span key={scanKey} className="rcw-fb-scan" />
        {loading && entries.length === 0 && <span className="mono faint" style={{ fontSize: 11.5, gridColumn: "1/-1", padding: "10px 2px" }}>Scanning…</span>}
        {error && <span className="mono" style={{ color: "#e0736a", fontSize: 11.5, gridColumn: "1/-1", padding: "10px 2px" }}>{error}</span>}
        {!loading && !error && entries.length === 0 && <span className="mono faint" style={{ fontSize: 11.5, gridColumn: "1/-1", padding: "10px 2px" }}>Empty folder.</span>}
        {!loading && !error && entries.length > 0 && shown.length === 0 && <span className="mono faint" style={{ fontSize: 11.5, gridColumn: "1/-1", padding: "10px 2px" }}>No match for “{query}”.</span>}
        {shown.map((e, i) => {
          const ico = iconFor(e);
          return (
            <div
              key={e.path}
              className={`rcw-fb-tile ${e.kind}`}
              style={{ animationDelay: `${Math.min(i, 40) * 18}ms` }}
              onClick={() => enter(e)}
              title={e.name}
            >
              <span className="rcw-fb-ico" style={{ color: ico.c }}>{ico.ch}</span>
              <span className="rcw-fb-name">{e.name}</span>
            </div>
          );
        })}
      </div>

      {openFile !== null && (() => {
        const name = openFile.split("/").pop() ?? openFile;
        const md = isMarkdown(name);
        return (
        <div className="rcw-fb-preview">
          <div className="rcw-fb-phd">
            <button onClick={() => setOpenFile(null)} title="Back to files" style={{ padding: "3px 10px", borderRadius: 7, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "inherit", fontFamily: "var(--font-mono)", fontSize: 11 }}>← files</button>
            <span className="mono" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
            <span style={{ flex: 1 }} />
            {read?.ok && read.encoding === "text" && md && (
              <button onClick={() => setMdMode((m) => (m === "preview" ? "edit" : "preview"))} style={{ padding: "3px 10px", borderRadius: 7, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "inherit", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                {mdMode === "preview" ? "✎ edit" : "▤ preview"}
              </button>
            )}
            {read?.ok && read.encoding === "text" && (
              <button onClick={save} className="glass-btn--clay" style={{ padding: "4px 14px", borderRadius: 8, fontSize: 11.5, fontWeight: 600, border: "none", cursor: "pointer" }}>
                {saving === "saving" ? "Saving…" : saving === "ok" ? "✓ Saved" : saving === "err" ? "✗ Error" : "Save"}
              </button>
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            {reading ? (
              <span className="mono faint" style={{ fontSize: 11.5, padding: 14, display: "block" }}>Reading…</span>
            ) : !read?.ok ? (
              <span className="mono" style={{ color: "#e0736a", fontSize: 12, padding: 14, display: "block" }}>{read?.error ?? "Failed to read."}</span>
            ) : isOfficeFile(name) && read.encoding === "base64" ? (
              <OfficeViewer cwd={cwd} machine={machine} path={openFile} base64={read.content} name={name} />
            ) : read.encoding === "base64" && read.mime === "application/pdf" ? (
              <iframe src={`data:application/pdf;base64,${read.content}`} title={name} style={{ width: "100%", height: "100%", border: 0 }} />
            ) : read.encoding === "base64" && read.mime.startsWith("image/") ? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overflow: "auto" }}>
                <img src={`data:${read.mime};base64,${read.content}`} style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8, boxShadow: "0 0 40px -12px rgb(var(--primary)/0.6)" }} />
              </div>
            ) : read.encoding === "base64" ? (
              <span className="mono faint" style={{ fontSize: 12, padding: 14, display: "block" }}>No inline preview · {(read.size / 1024).toFixed(1)} KB · {read.mime}</span>
            ) : read.encoding === "binary" ? (
              <span className="mono faint" style={{ fontSize: 12, padding: 14, display: "block" }}>Binary file · {(read.size / 1024).toFixed(1)} KB · {read.mime}</span>
            ) : md && mdMode === "preview" ? (
              <div className="md no-scrollbar" style={{ height: "100%", overflowY: "auto", padding: "12px 16px" }}>
                <Markdown>{draft ?? read.content}</Markdown>
              </div>
            ) : (
              <Editor
                height="100%"
                theme={RCW_MONACO_THEME}
                language={languageForFile(openFile)}
                value={draft ?? read.content}
                onChange={(v) => setDraft(v ?? "")}
                options={{ fontSize: 12.5, minimap: { enabled: false }, scrollBeyondLastLine: false, fontFamily: "var(--font-mono)", padding: { top: 10 } }}
              />
            )}
          </div>
        </div>
        );
      })()}
    </div>
  );
}
