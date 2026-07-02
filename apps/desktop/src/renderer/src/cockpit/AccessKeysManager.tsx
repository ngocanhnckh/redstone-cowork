import { useEffect, useState } from "react";

type Key = { id: string; name: string; prefix: string; scope: string; lastUsedAt: string | null; revokedAt: string | null };

/**
 * Manage external access keys — create scoped (read | control) keys for external
 * servers / the Redstone agent to call the inventory API, and revoke them. The
 * plaintext key is shown exactly once, at creation.
 */
export default function AccessKeysManager() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "control">("read");
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => { window.cowork.listAccessKeys().then(setKeys).catch(() => {}); };
  useEffect(load, []);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setFresh(null);
    try {
      const r = await window.cowork.createAccessKey(name.trim(), scope);
      setFresh(r.key);
      setName("");
      load();
    } finally { setBusy(false); }
  };
  const revoke = async (id: string) => { await window.cowork.revokeAccessKey(id); load(); };

  return (
    <div style={{ marginTop: 22, borderTop: "1px solid var(--border)", paddingTop: 18 }}>
      <div className="kicker" style={{ marginBottom: 4 }}>External access keys</div>
      <p className="faint" style={{ fontSize: 11, margin: "0 0 12px", lineHeight: 1.5 }}>
        Keys for external servers / the Redstone agent to call the session-inventory API. <b>control</b> can also send one-shot messages.
      </p>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} placeholder="Key name (e.g. redstone-agent)"
          style={{ flex: 1, border: "1px solid var(--border)", background: "transparent", borderRadius: 8, padding: "8px 11px", fontSize: 12.5, color: "var(--text)", outline: "none" }} />
        <select value={scope} onChange={(e) => setScope(e.target.value as "read" | "control")}
          style={{ border: "1px solid var(--border)", background: "transparent", borderRadius: 8, padding: "0 8px", fontSize: 12.5, color: "var(--text)" }}>
          <option value="read">read</option>
          <option value="control">control</option>
        </select>
        <button onClick={create} disabled={busy || !name.trim()} className="glass-btn--clay" style={{ padding: "0 16px", borderRadius: 8, fontSize: 13, fontWeight: 600 }}>Create</button>
      </div>

      {fresh && (
        <div className="glass-inset" style={{ padding: "10px 12px", borderRadius: 9, marginBottom: 12 }}>
          <div className="faint" style={{ fontSize: 10.5, marginBottom: 4 }}>Copy this now — it won't be shown again:</div>
          <code className="mono" style={{ fontSize: 11.5, wordBreak: "break-all", color: "rgb(var(--accent))" }}>{fresh}</code>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {keys.length === 0 && <span className="faint" style={{ fontSize: 12, fontStyle: "italic" }}>No keys yet.</span>}
        {keys.map((k) => (
          <div key={k.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, opacity: k.revokedAt ? 0.5 : 1 }}>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.name}</span>
            <span className="mono faint" style={{ fontSize: 10.5 }}>{k.prefix}…</span>
            <span className="mono" style={{ fontSize: 9.5, padding: "1px 6px", borderRadius: 999, background: "rgb(var(--primary) / 0.16)" }}>{k.scope}</span>
            {k.revokedAt ? <span className="mono faint" style={{ fontSize: 10 }}>revoked</span>
              : <button onClick={() => revoke(k.id)} style={{ border: 0, background: "transparent", color: "#e0736a", cursor: "pointer", fontSize: 11 }}>revoke</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
