import { useEffect, useState } from "react";
import { useStore } from "./store";

/**
 * Host picker for entering offline mode (direct SSH, no cowork server). Lists
 * ~/.ssh/config aliases as toggles, allows manual `alias / user@host` entry, and
 * connects via store.enterOffline. Shared by the login screen and the in-cockpit
 * "Go offline" modal.
 */
export default function OfflinePicker({ onDone }: { onDone?: () => void }) {
  const enterOffline = useStore((s) => s.enterOffline);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [selected, setSelected] = useState<OfflineHost[]>([]);
  const [manual, setManual] = useState("");

  useEffect(() => {
    window.cowork.offlineSshConfig().then(setCandidates).catch(() => {});
    window.cowork.offlineHostsList().then((h) => { if (h.length) setSelected(h); }).catch(() => {});
  }, []);

  const addHost = (target: string) => {
    const t = target.trim();
    if (!t) return;
    setSelected((prev) => (prev.some((h) => h.host === t || h.alias === t) ? prev : [...prev, { alias: t, host: t }]));
  };
  const removeHost = (alias: string) => setSelected((prev) => prev.filter((h) => h.alias !== alias));

  const inputStyle: React.CSSProperties = {
    padding: "10px 12px", borderRadius: 10, fontSize: 13.5, fontFamily: "var(--font-mono)",
    border: "1px solid var(--border, rgba(255,255,255,0.12))", background: "rgba(0,0,0,0.18)", color: "inherit",
  };

  return (
    <div>
      <p className="soft" style={{ fontSize: 12.5, lineHeight: 1.55, margin: "0 0 14px" }}>
        No cowork server — discover and answer Claude sessions running in tmux on hosts you can reach over SSH.
      </p>

      {candidates.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <label className="soft" style={{ display: "block", marginBottom: 6, fontSize: 12.5 }}>From your ~/.ssh/config</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {candidates.map((c) => {
              const on = selected.some((h) => h.alias === c || h.host === c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => (on ? removeHost(c) : addHost(c))}
                  style={{
                    padding: "4px 10px", borderRadius: 999, fontSize: 12, cursor: "pointer",
                    border: "1px solid var(--border, rgba(255,255,255,0.12))",
                    background: on ? "rgba(var(--primary), 0.22)" : "transparent",
                    color: "inherit", fontFamily: "var(--font-mono)",
                  }}
                >
                  {on ? "✓ " : ""}{c}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <label className="soft" style={{ display: "block", marginBottom: 6, fontSize: 12.5 }}>Add a host</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addHost(manual); setManual(""); } }}
            placeholder="alias / user@host"
            autoCapitalize="off" autoCorrect="off" spellCheck={false}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            type="button"
            onClick={() => { addHost(manual); setManual(""); }}
            style={{
              padding: "0 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
              border: "1px solid var(--border, rgba(255,255,255,0.12))", background: "transparent", color: "inherit",
            }}
          >
            Add
          </button>
        </div>
      </div>

      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
          {selected.map((h) => (
            <span
              key={h.alias}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 8px 4px 10px", borderRadius: 999,
                fontSize: 12, fontFamily: "var(--font-mono)", background: "rgba(var(--primary), 0.18)",
                border: "1px solid var(--border, rgba(255,255,255,0.12))",
              }}
            >
              {h.alias}
              <button
                type="button"
                onClick={() => removeHost(h.alias)}
                title="Remove"
                style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button
          type="button"
          onClick={() => { enterOffline(selected); onDone?.(); }}
          disabled={selected.length === 0}
          className="glass-btn--clay"
          style={{
            flex: 1, padding: "12px 0", borderRadius: 10, fontSize: 14, fontWeight: 600, border: "none",
            cursor: selected.length ? "pointer" : "not-allowed", opacity: selected.length ? 1 : 0.5,
          }}
        >
          Connect offline{selected.length ? ` (${selected.length})` : ""}
        </button>
      </div>
    </div>
  );
}
