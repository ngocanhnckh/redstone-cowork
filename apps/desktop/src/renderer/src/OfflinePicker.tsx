import { useEffect, useState } from "react";
import { useStore } from "./store";

/**
 * VS Code Remote-SSH style host list for offline mode. Shows your saved hosts and
 * ~/.ssh/config aliases as a list; click ONE to connect to it (open that host).
 * The "+" adds a new host to your saved list. Selective — one host at a time, not
 * "grab everything and connect to all".
 */
export default function OfflinePicker({ onDone }: { onDone?: () => void }) {
  const enterOffline = useStore((s) => s.enterOffline);
  const [saved, setSaved] = useState<OfflineHost[]>([]);
  const [configHosts, setConfigHosts] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

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

  const connect = (h: OfflineHost) => { enterOffline([h]); onDone?.(); };

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

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <p className="soft" style={{ fontSize: 12.5, lineHeight: 1.5, margin: 0, maxWidth: 320 }}>
          Pick a host to open its Claude sessions over SSH — no cowork server.
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
            <button type="button" onClick={() => connect(h)} style={rowBtn}>
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
