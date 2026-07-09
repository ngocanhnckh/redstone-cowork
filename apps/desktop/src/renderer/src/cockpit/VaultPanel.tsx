import { useEffect, useState } from "react";

/** Short host label for an origin (drops the scheme). */
function hostOf(origin: string): string {
  try { return new URL(origin).host || origin; } catch { return origin.replace(/^https?:\/\//, ""); }
}

/**
 * The workspace browser's credential vault — the built-in replacement for a
 * password-manager extension (which can't run embedded). Passwords are stored
 * OS-keychain-encrypted and autofilled on matching login forms. (Passkeys get
 * their own tab.)
 */
export default function VaultPanel({ onClose }: { onClose: () => void }) {
  const [creds, setCreds] = useState<Array<{ origin: string; username: string }>>([]);
  const [available, setAvailable] = useState(true);

  const refresh = () => window.cowork.vaultList().then(setCreds).catch(() => {});
  useEffect(() => {
    refresh();
    window.cowork.vaultAvailable().then(setAvailable).catch(() => {});
  }, []);

  const del = async (origin: string, username: string) => {
    await window.cowork.vaultDelete(origin, username);
    await refresh();
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9998, display: "flex",
        alignItems: "center", justifyContent: "center", padding: 24,
        background: "rgba(0,0,0,0.42)", WebkitBackdropFilter: "blur(4px)", backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-surface no-scrollbar"
        style={{
          width: "min(560px, 100%)", maxHeight: "80vh", overflowY: "auto",
          borderRadius: 18, border: "1px solid var(--border)", padding: "20px 22px",
          boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 18 }}>🔑</span>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, flex: 1 }}>Saved passwords</h2>
          <button onClick={onClose} className="glass-inset-hover" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "var(--text-soft)" }}>Done</button>
        </div>
        <p className="faint" style={{ fontSize: 11.5, lineHeight: 1.5, margin: "0 0 14px" }}>
          {available
            ? "Stored encrypted in your OS keychain and autofilled on matching login forms. Save one by logging in — you’ll be asked."
            : "⚠ OS encryption isn’t available here — passwords are stored obfuscated, not encrypted. Use with care."}
        </p>

        {creds.length === 0 ? (
          <div className="faint" style={{ fontSize: 12.5, fontStyle: "italic", padding: "10px 0" }}>
            No saved passwords yet. Log in to a site and choose “Save”.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {creds.map((c, i) => (
              <div
                key={`${c.origin}::${c.username}::${i}`}
                className="glass-inset"
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", borderRadius: 12 }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hostOf(c.origin)}</div>
                  <div className="mono faint" style={{ fontSize: 10.5, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.username || "—"} · ••••••••
                  </div>
                </div>
                <button
                  onClick={() => del(c.origin, c.username)}
                  className="glass-inset-hover"
                  title="Remove"
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "5px 9px", fontSize: 12, cursor: "pointer", color: "var(--text-soft)", flexShrink: 0 }}
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
