import { useEffect, useState } from "react";

/**
 * Manager for Chrome extensions loaded into the shared workspace browser session.
 * Extensions are partition-wide (they apply to every browser tab + custom app), so
 * this is a global panel, opened from the browser tab row. Add an unpacked folder
 * or a .crx/.zip; enable/disable/remove; load errors surface inline.
 */
export default function ExtensionsPanel({ onClose }: { onClose: () => void }) {
  const [exts, setExts] = useState<BrowserExtension[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storeUrl, setStoreUrl] = useState("");

  const refresh = () => window.cowork.extensionsList().then(setExts).catch(() => {});
  useEffect(() => { refresh(); }, []);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await window.cowork.extensionAdd();
      if (r.error) setError(r.error);
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const installFromStore = async () => {
    if (!storeUrl.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await window.cowork.extensionInstallWebStore(storeUrl.trim());
      if (r.error) setError(r.error);
      else setStoreUrl("");
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (e: BrowserExtension) => {
    await window.cowork.extensionSetEnabled(e.id, !e.enabled);
    await refresh();
  };
  const remove = async (e: BrowserExtension) => {
    await window.cowork.extensionRemove(e.id);
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
          <span style={{ fontSize: 18 }}>🧩</span>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, flex: 1 }}>Browser extensions</h2>
          <button onClick={onClose} className="glass-inset-hover" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "var(--text-soft)" }}>Done</button>
        </div>
        <p className="faint" style={{ fontSize: 11.5, lineHeight: 1.5, margin: "0 0 14px" }}>
          Loaded into the shared workspace browser — they apply to every tab. Add an unpacked
          folder or a <span className="mono">.crx</span>/<span className="mono">.zip</span>.
          Note: extensions that use <b>native messaging</b> (1Password, Dashlane, Bitwarden desktop)
          can’t run in an embedded browser — use the built-in vault instead.
        </p>

        <button
          onClick={add}
          disabled={busy}
          className="glass-btn--clay"
          style={{ padding: "9px 16px", fontSize: 13, fontWeight: 600, marginBottom: 14, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Adding…" : "+ Add unpacked / .crx"}
        </button>

        {/* Install straight from a Chrome Web Store link (the store hides its own
            "Add to Chrome" button for non-Chrome browsers). */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <input
            value={storeUrl}
            onChange={(e) => setStoreUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") installFromStore(); }}
            placeholder="Paste a Chrome Web Store link or extension id…"
            className="mono"
            style={{ flex: 1, minWidth: 0, border: "1px solid var(--border)", background: "rgba(255,255,255,0.03)", color: "var(--text)", borderRadius: 8, padding: "8px 11px", fontSize: 11.5, outline: "none" }}
          />
          <button onClick={installFromStore} disabled={busy || !storeUrl.trim()} className="glass-inset-hover"
            style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "0 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "var(--text)", opacity: busy || !storeUrl.trim() ? 0.5 : 1 }}>
            Install
          </button>
        </div>

        {error && (
          <div style={{ fontSize: 11.5, color: "#e0736a", marginBottom: 12, lineHeight: 1.5 }}>⚠ {error}</div>
        )}

        {exts.length === 0 ? (
          <div className="faint" style={{ fontSize: 12.5, fontStyle: "italic", padding: "10px 0" }}>No extensions yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {exts.map((e) => (
              <div
                key={e.id}
                className="glass-inset"
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 13px", borderRadius: 12 }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</div>
                  <div className="mono faint" style={{ fontSize: 10.5, marginTop: 2 }}>
                    v{e.version}
                    {" · "}
                    {e.error ? <span style={{ color: "#e0736a" }}>load failed</span> : e.enabled ? (e.loaded ? <span style={{ color: "rgb(var(--accent))" }}>active</span> : "enabled") : "disabled"}
                  </div>
                  {e.error && <div style={{ fontSize: 10.5, color: "#e0736a", marginTop: 3, lineHeight: 1.4 }}>{e.error}</div>}
                </div>
                <button
                  onClick={() => toggle(e)}
                  className="glass-inset-hover"
                  title={e.enabled ? "Disable" : "Enable"}
                  style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "5px 11px", fontSize: 11.5, cursor: "pointer", color: e.enabled ? "rgb(var(--accent))" : "var(--text-soft)", flexShrink: 0 }}
                >
                  {e.enabled ? "On" : "Off"}
                </button>
                <button
                  onClick={() => remove(e)}
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
