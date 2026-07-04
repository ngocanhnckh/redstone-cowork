import { useEffect, useMemo, useRef, useState } from "react";

type Match = { path: string; line: number; text: string };

const trimSlash = (s: string): string => s.replace(/\/+$/, "");

function toRegExp(query: string, regex: boolean, caseSensitive: boolean): RegExp {
  const src = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(src, caseSensitive ? "g" : "gi");
}

const field: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: "1px solid var(--border)", background: "rgba(255,255,255,0.03)",
  color: "var(--text)", borderRadius: 8, padding: "6px 9px", fontSize: 12, outline: "none", fontFamily: "var(--font-mono)",
};
const iconBtn = (on: boolean): React.CSSProperties => ({
  border: on ? "1px solid rgb(var(--primary-soft) / 0.6)" : "1px solid var(--border)",
  background: on ? "rgb(var(--primary) / 0.22)" : "transparent",
  color: on ? "var(--text)" : "var(--text-soft)", borderRadius: 6, padding: "2px 7px",
  fontSize: 11, fontFamily: "var(--font-mono)", cursor: "pointer",
});

/**
 * Project-wide find & replace for the file app. Searches (grep) under the session
 * cwd on its host; results group by file and open at the line on click. Replace-all
 * rewrites each matching file over the existing file IPC.
 */
export default function FileSearch({
  cwd, machine, autoFocus, onOpen, onReplaced, onClose,
}: {
  cwd: string;
  machine: string;
  autoFocus?: boolean;
  onOpen: (path: string, line: number) => void;
  onReplaced: (paths: string[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  const runSearch = async () => {
    const q = query;
    if (!q.trim()) { setMatches([]); setTruncated(false); setMsg(null); return; }
    const mine = ++seq.current;
    setBusy(true);
    setMsg(null);
    try {
      const r = await window.cowork.searchFiles({ cwd, machine, query: q, caseSensitive, regex });
      if (mine !== seq.current) return; // a newer search superseded this one
      if (r.ok) { setMatches(r.matches); setTruncated(r.truncated); if (!r.matches.length) setMsg("No results"); }
      else { setMatches([]); setMsg(r.error); }
    } catch (e) {
      if (mine === seq.current) { setMatches([]); setMsg(e instanceof Error ? e.message : String(e)); }
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  };

  // Debounced live search as you type / toggle options.
  useEffect(() => {
    const t = setTimeout(runSearch, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, caseSensitive, regex]);

  const grouped = useMemo(() => {
    const by = new Map<string, Match[]>();
    for (const m of matches) { const a = by.get(m.path) ?? []; a.push(m); by.set(m.path, a); }
    return [...by.entries()];
  }, [matches]);

  const rel = (p: string) => (p.startsWith(trimSlash(cwd) + "/") ? p.slice(trimSlash(cwd).length + 1) : p);

  const replaceAll = async () => {
    if (!query.trim() || !matches.length || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const re = toRegExp(query, regex, caseSensitive);
      const files = [...new Set(matches.map((m) => m.path))];
      const changedFiles: string[] = [];
      for (const f of files) {
        const r = await window.cowork.readFile({ cwd, machine, file: f });
        if (!(r.ok && r.encoding === "text")) continue;
        const next = r.content.replace(re, replace);
        if (next !== r.content) {
          const w = await window.cowork.writeFile({ cwd, machine, file: f, content: next });
          if (w.ok) changedFiles.push(f);
        }
      }
      onReplaced(changedFiles);
      setMsg(`Replaced in ${changedFiles.length} file${changedFiles.length === 1 ? "" : "s"}`);
      await runSearch();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleGroup = (path: string) =>
    setCollapsed((c) => { const n = new Set(c); n.has(path) ? n.delete(path) : n.add(path); return n; });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ padding: "8px 8px 10px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="mono" style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-soft)", flex: 1 }}>Search project</span>
          <button onClick={() => setCaseSensitive((v) => !v)} title="Match case" style={iconBtn(caseSensitive)}>Aa</button>
          <button onClick={() => setRegex((v) => !v)} title="Regular expression" style={iconBtn(regex)}>.*</button>
          <button onClick={onClose} title="Close search (Esc)" style={{ ...iconBtn(false), padding: "2px 6px" }}>✕</button>
        </div>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") runSearch(); if (e.key === "Escape") onClose(); }}
          placeholder="Find in all files…"
          style={field}
        />
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={replace}
            onChange={(e) => setReplace(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) replaceAll(); if (e.key === "Escape") onClose(); }}
            placeholder="Replace with…"
            style={{ ...field, flex: 1 }}
          />
          <button onClick={replaceAll} disabled={busy || !matches.length} title="Replace all (⌘⏎)"
            className="glass-btn--clay" style={{ padding: "5px 11px", fontSize: 11.5, fontWeight: 600, flexShrink: 0, opacity: busy || !matches.length ? 0.5 : 1 }}>
            Replace all
          </button>
        </div>
        <div className="mono faint" style={{ fontSize: 10, minHeight: 13 }}>
          {busy ? "searching…" : msg ? msg : matches.length ? `${matches.length} match${matches.length === 1 ? "" : "es"} in ${grouped.length} file${grouped.length === 1 ? "" : "s"}${truncated ? " (truncated)" : ""}` : ""}
        </div>
      </div>

      <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", padding: 6 }}>
        {grouped.map(([path, ms]) => {
          const open = !collapsed.has(path);
          return (
            <div key={path} style={{ marginBottom: 4 }}>
              <div onClick={() => toggleGroup(path)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", borderRadius: 6, cursor: "pointer", background: "rgb(var(--primary) / 0.05)" }}>
                <span className="mono faint" style={{ fontSize: 10 }}>{open ? "▾" : "▸"}</span>
                <span className="mono" style={{ fontSize: 11, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left" }} title={rel(path)}>
                  {rel(path)}
                </span>
                <span className="mono faint" style={{ fontSize: 9.5 }}>{ms.length}</span>
              </div>
              {open && ms.map((m, i) => (
                <div key={i} onClick={() => onOpen(m.path, m.line)}
                  className="glass-inset-hover"
                  style={{ display: "flex", gap: 8, padding: "3px 8px 3px 22px", borderRadius: 5, cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11 }}>
                  <span className="faint" style={{ minWidth: 30, textAlign: "right", flexShrink: 0 }}>{m.line}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-soft)" }}>{m.text.trim()}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
