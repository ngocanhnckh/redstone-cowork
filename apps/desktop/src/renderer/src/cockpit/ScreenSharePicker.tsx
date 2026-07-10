import { useEffect, useState } from "react";

type Req = {
  screens: Array<{ id: string; name: string; kind: string; thumb: string }>;
  tabs: Array<{ id: string; title: string; url: string }>;
};

/**
 * Custom source picker for screen sharing (getDisplayMedia). Electron's OS picker
 * can't see our in-app browser tabs, so we present our own: Entire Screen(s),
 * Windows, and this app's browser Tabs. Mounted once at the app root; it shows only
 * while main has a pending request. Returning a tab captures that <webview>'s frame.
 */
export default function ScreenSharePicker() {
  const [req, setReq] = useState<Req | null>(null);
  const [tab, setTab] = useState<"screen" | "tab">("screen");

  useEffect(() => {
    return window.cowork.onDisplayMediaRequest((a) => { setReq(a); setTab(a.tabs.length ? "tab" : "screen"); });
  }, []);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  if (!req) return null;

  const pick = (kind: "screen" | "window" | "tab", id: string) => {
    window.cowork.displayMediaPick({ kind, id }).catch(() => {});
    setReq(null);
  };
  const cancel = () => { window.cowork.displayMediaCancel().catch(() => {}); setReq(null); };

  const screens = req.screens.filter((s) => s.kind === "screen");
  const windows = req.screens.filter((s) => s.kind === "window");

  const chip = (on: boolean): React.CSSProperties => ({
    border: "1px solid var(--border)", borderRadius: 8, padding: "5px 12px", fontSize: 12, cursor: "pointer",
    background: on ? "rgb(var(--primary) / 0.22)" : "transparent", color: on ? "var(--text)" : "var(--text-soft)",
  });

  return (
    <div onClick={cancel} style={{ position: "fixed", inset: 0, zIndex: 12000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-surface no-scrollbar"
        style={{
          width: "min(720px, 96vw)", maxHeight: "84vh", overflowY: "auto", borderRadius: 18,
          border: "1px solid var(--border-strong)", boxShadow: "0 24px 70px rgba(0,0,0,0.6)", padding: "20px 22px",
          background: "color-mix(in srgb, var(--app-panel, #1b1712) 94%, transparent)",
          backdropFilter: "blur(26px) saturate(1.4)", WebkitBackdropFilter: "blur(26px) saturate(1.4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ fontSize: 17 }}>🖥️</span>
          <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, flex: 1 }}>Choose what to share</h2>
          <button onClick={cancel} className="glass-inset-hover" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "4px 12px", fontSize: 12, cursor: "pointer", color: "var(--text-soft)" }}>Cancel</button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
          <button onClick={() => setTab("tab")} style={chip(tab === "tab")}>🌐 Browser tab ({req.tabs.length})</button>
          <button onClick={() => setTab("screen")} style={chip(tab === "screen")}>🖥 Screen &amp; window ({req.screens.length})</button>
        </div>

        {tab === "tab" ? (
          req.tabs.length === 0 ? (
            <div className="faint" style={{ fontSize: 12.5, fontStyle: "italic", padding: "10px 0" }}>No open browser tabs to share.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {req.tabs.map((t) => (
                <div key={t.id} onClick={() => pick("tab", t.id)} className="glass-inset glass-inset-hover"
                  style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", borderRadius: 11, cursor: "pointer" }}>
                  <span style={{ fontSize: 15 }}>🌐</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                    <div className="mono faint" style={{ fontSize: 10, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.url}</div>
                  </div>
                  <span className="mono faint" style={{ fontSize: 10.5, flexShrink: 0 }}>Share →</span>
                </div>
              ))}
            </div>
          )
        ) : (
          <>
            {[{ label: "Entire screen", items: screens, kind: "screen" as const }, { label: "Window", items: windows, kind: "window" as const }].map((group) =>
              group.items.length === 0 ? null : (
                <div key={group.kind} style={{ marginBottom: 14 }}>
                  <div className="mono faint" style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 8 }}>{group.label}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
                    {group.items.map((s) => (
                      <div key={s.id} onClick={() => pick(group.kind, s.id)} className="glass-inset glass-inset-hover"
                        style={{ padding: 8, borderRadius: 11, cursor: "pointer" }}>
                        <img src={s.thumb} alt={s.name} style={{ width: "100%", height: 96, objectFit: "cover", borderRadius: 7, background: "#000", display: "block" }} />
                        <div style={{ fontSize: 11.5, marginTop: 7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            )}
          </>
        )}
      </div>
    </div>
  );
}
