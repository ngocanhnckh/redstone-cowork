import { useEffect, useState } from "react";
import { useStore } from "./store";

/**
 * VS Code Remote-SSH style offline picker — TWO phases:
 *   1. HOST  — your saved hosts + ~/.ssh/config aliases as a list; pick ONE.
 *   2. FOLDER — browse that host's filesystem (directories only) and Open a folder.
 * "Open" enters offline mode scoped to {host, folder}; the cockpit then shows only
 * that folder's Claude sessions (and lets you start one there). One host + one folder,
 * never "grab every session on the box".
 */
export default function OfflinePicker({ onDone }: { onDone?: () => void }) {
  const enterOffline = useStore((s) => s.enterOffline);
  const [saved, setSaved] = useState<OfflineHost[]>([]);
  const [configHosts, setConfigHosts] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  // Folder phase — the host we're browsing and where we are in its tree.
  const [host, setHost] = useState<OfflineHost | null>(null);
  const [cwd, setCwd] = useState("");
  const [dirs, setDirs] = useState<DirEntry[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [browseErr, setBrowseErr] = useState("");

  useEffect(() => {
    window.cowork.offlineHostsList().then(setSaved).catch(() => {});
    window.cowork.offlineSshConfig().then(setConfigHosts).catch(() => {});
  }, []);

  const persist = (hosts: OfflineHost[]) => {
    setSaved(hosts);
    window.cowork.offlineHostsSet(hosts).catch(() => {});
  };

  // The merged list: saved hosts first, then ~/.ssh/config aliases not already saved.
  const savedAliases = new Set(saved.map((h) => h.alias));
  const rows: Array<OfflineHost & { fromConfig?: boolean }> = [
    ...saved,
    ...configHosts.filter((c) => !savedAliases.has(c)).map((c) => ({ alias: c, host: c, fromConfig: true })),
  ];

  // ---- folder browsing --------------------------------------------------------
  const parentOf = (p: string): string => {
    const t = p.replace(/\/+$/, "");
    const i = t.lastIndexOf("/");
    return i <= 0 ? "/" : t.slice(0, i);
  };

  const loadDir = async (h: OfflineHost, dir: string) => {
    setBrowsing(true);
    setBrowseErr("");
    try {
      const r = await window.cowork.listFiles({ cwd: dir, machine: h.alias, dir });
      if (r.ok) {
        setCwd(dir);
        setDirs(r.entries.filter((e) => e.kind === "dir"));
      } else {
        setBrowseErr(r.error);
      }
    } catch (e) {
      setBrowseErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBrowsing(false);
    }
  };

  // Pick a host → go to its FOLDER phase, starting at its (absolute) home dir.
  const pickHost = async (h: OfflineHost) => {
    setHost(h);
    setCwd("");
    setDirs([]);
    setBrowseErr("");
    setBrowsing(true);
    let home = "/";
    try { home = (await window.cowork.offlineHome(h.host)) || "/"; } catch { /* fall back to / */ }
    await loadDir(h, home);
  };

  const openHere = () => { if (host && cwd) { enterOffline(host, cwd); onDone?.(); } };

  const addNew = () => {
    const t = draft.trim();
    if (!t) { setAdding(false); return; }
    if (!saved.some((h) => h.alias === t || h.host === t)) persist([...saved, { alias: t, host: t }]);
    setDraft("");
    setAdding(false);
  };
  const removeSaved = (alias: string) => persist(saved.filter((h) => h.alias !== alias));

  const rowBtn: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
    padding: "10px 12px", borderRadius: 10, cursor: "pointer", fontSize: 13.5,
    border: "1px solid var(--border, rgba(255,255,255,0.10))", background: "rgba(255,255,255,0.03)", color: "inherit",
  };

  // ---------------------------- FOLDER PHASE ----------------------------------
  if (host) {
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            onClick={() => { setHost(null); setBrowseErr(""); }}
            title="Back to hosts"
            style={{
              flexShrink: 0, width: 30, height: 30, borderRadius: 8, cursor: "pointer", fontSize: 15, lineHeight: 1,
              border: "1px solid var(--border, rgba(255,255,255,0.12))", background: "transparent", color: "inherit",
            }}
          >
            ←
          </button>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span style={{ opacity: 0.7 }}>🖥 </span>{host.alias}
          </span>
        </div>

        {/* Current path + up */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <button
            type="button"
            onClick={() => host && loadDir(host, parentOf(cwd))}
            disabled={!cwd || cwd === "/" || browsing}
            title="Up one folder"
            style={{
              flexShrink: 0, padding: "5px 10px", borderRadius: 8, fontSize: 13, lineHeight: 1,
              cursor: !cwd || cwd === "/" || browsing ? "not-allowed" : "pointer", opacity: !cwd || cwd === "/" ? 0.4 : 1,
              border: "1px solid var(--border, rgba(255,255,255,0.12))", background: "transparent", color: "inherit",
            }}
          >
            ↑ ..
          </button>
          <span className="soft" style={{ fontSize: 12, fontFamily: "var(--font-mono)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", direction: "rtl", textAlign: "left" }}>
            {cwd || "…"}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "40vh", overflowY: "auto" }} className="no-scrollbar">
          {browsing && <p className="soft" style={{ fontSize: 12.5, textAlign: "center", padding: "18px 0", margin: 0 }}>Loading…</p>}
          {!browsing && browseErr && (
            <p className="mono" style={{ color: "#e0736a", fontSize: 12, padding: "6px 2px", margin: 0 }}>{browseErr}</p>
          )}
          {!browsing && !browseErr && dirs.length === 0 && (
            <p className="soft" style={{ fontSize: 12.5, textAlign: "center", padding: "18px 0", margin: 0 }}>No sub-folders here.</p>
          )}
          {!browsing && dirs.map((d) => (
            <button key={d.path} type="button" onClick={() => host && loadDir(host, d.path)} style={rowBtn}>
              <span style={{ opacity: 0.7 }}>📁</span>
              <span style={{ flex: 1, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
              <span style={{ opacity: 0.5 }}>→</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={openHere}
          disabled={!cwd || browsing}
          className="glass-btn--clay"
          style={{
            marginTop: 14, width: "100%", padding: "11px 0", borderRadius: 10, fontSize: 13.5, fontWeight: 600,
            cursor: !cwd || browsing ? "not-allowed" : "pointer", opacity: !cwd || browsing ? 0.5 : 1, border: "none",
          }}
        >
          Open this folder →
        </button>
      </div>
    );
  }

  // ----------------------------- HOST PHASE -----------------------------------
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <p className="soft" style={{ fontSize: 12.5, lineHeight: 1.5, margin: 0, maxWidth: 320 }}>
          Pick a host, then a folder — over SSH, no cowork server.
        </p>
        <button
          type="button"
          onClick={() => { setAdding((v) => !v); setDraft(""); }}
          title="Add a host"
          style={{
            flexShrink: 0, width: 30, height: 30, borderRadius: 8, cursor: "pointer", fontSize: 18, lineHeight: 1,
            border: "1px solid var(--border, rgba(255,255,255,0.12))", background: adding ? "rgba(var(--primary), 0.22)" : "transparent", color: "inherit",
          }}
        >
          +
        </button>
      </div>

      {adding && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNew(); } if (e.key === "Escape") setAdding(false); }}
            placeholder="alias  or  user@host"
            autoCapitalize="off" autoCorrect="off" spellCheck={false}
            style={{
              flex: 1, padding: "9px 12px", borderRadius: 9, fontSize: 13.5, fontFamily: "var(--font-mono)",
              border: "1px solid var(--border, rgba(255,255,255,0.12))", background: "rgba(0,0,0,0.18)", color: "inherit",
            }}
          />
          <button
            type="button"
            onClick={addNew}
            className="glass-btn--clay"
            style={{ padding: "0 16px", borderRadius: 9, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer" }}
          >
            Add
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "48vh", overflowY: "auto" }} className="no-scrollbar">
        {rows.length === 0 && !adding && (
          <p className="soft" style={{ fontSize: 12.5, textAlign: "center", padding: "18px 0", margin: 0 }}>
            No hosts yet — press <b>+</b> to add one (an alias from your ~/.ssh/config, or <code>user@host</code>).
          </p>
        )}
        {rows.map((h) => (
          <div key={h.alias} style={{ position: "relative", display: "flex", alignItems: "center", gap: 4 }}>
            <button type="button" onClick={() => pickHost(h)} style={rowBtn}>
              <span style={{ opacity: 0.7 }}>🖥</span>
              <span style={{ flex: 1, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.alias}</span>
              {h.fromConfig && <span className="soft" style={{ fontSize: 10.5, letterSpacing: "0.05em" }}>ssh config</span>}
              <span style={{ opacity: 0.5 }}>→</span>
            </button>
            {!h.fromConfig && (
              <button
                type="button"
                onClick={() => removeSaved(h.alias)}
                title="Remove from saved hosts"
                style={{ position: "absolute", right: 34, border: 0, background: "transparent", color: "var(--text-soft)", cursor: "pointer", fontSize: 15, padding: 4 }}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
