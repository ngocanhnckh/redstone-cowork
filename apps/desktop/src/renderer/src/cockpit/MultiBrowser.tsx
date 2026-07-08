import { useEffect, useRef, useState } from "react";
import BrowserPanel from "./BrowserPanel";
import { useStore } from "../store";

/** Short label for a URL tab: its hostname, or a truncated string as a fallback. */
function urlLabel(url: string): string {
  try { return new URL(url).hostname || url; } catch { return url.slice(0, 24); }
}

/**
 * A tabbed set of browser previews for one session — like Chrome tabs. Each tab is
 * its own <webview>, all kept mounted and toggled with `display` so switching tabs
 * never reloads a page. Tab 0 is the session's primary preview (persists the saved
 * URL/port config); extra tabs are ephemeral (navigate freely, don't overwrite it).
 */
export default function MultiBrowser({ sessionId, cwd, machine }: { sessionId: string; cwd: string; machine: string }) {
  const seq = useRef(0);
  // Tab 0 is the session's primary preview (config-driven, no url). Extra tabs may
  // carry a url when opened for an external link ("open in the workspace browser").
  const [tabs, setTabs] = useState<{ id: number; url?: string }[]>([{ id: 0 }]);
  const [active, setActive] = useState(0);

  // Per-tab page zoom + responsive device mode (applied to that tab's <webview>).
  const [zoomByTab, setZoomByTab] = useState<Record<number, number>>({});
  const [deviceByTab, setDeviceByTab] = useState<Record<number, "laptop" | "mobile">>({});
  // Effective viewport (CSS px the page sees) per tab, reported by each BrowserPanel.
  const [vpByTab, setVpByTab] = useState<Record<number, { w: number; h: number }>>({});
  const zoom = zoomByTab[active] ?? 1;
  const device = deviceByTab[active] ?? "laptop";
  const vp = vpByTab[active];
  const setZoom = (z: number) => setZoomByTab((m) => ({ ...m, [active]: Math.min(3, Math.max(0.25, +z.toFixed(2))) }));
  const bumpZoom = (dir: 1 | -1) => setZoom(zoom * (dir > 0 ? 1.1 : 1 / 1.1));
  const toggleDevice = () => setDeviceByTab((m) => ({ ...m, [active]: (m[active] ?? "laptop") === "mobile" ? "laptop" : "mobile" }));

  // React to "open this URL in the session's browser" requests (from the git
  // widget's GitHub link, or a custom app's cross-domain link): add a tab at that
  // URL and focus it. Guarded by the request nonce so each fires exactly once.
  const pendingBrowserOpen = useStore((s) => s.pendingBrowserOpen);
  const seenNonce = useRef(0);
  useEffect(() => {
    const p = pendingBrowserOpen;
    if (!p || p.sessionId !== sessionId || p.nonce === seenNonce.current) return;
    seenNonce.current = p.nonce;
    const n = ++seq.current;
    setTabs((t) => [...t, { id: n, url: p.url }]);
    setActive(n);
  }, [pendingBrowserOpen, sessionId]);
  // Collapse the per-page chrome (connection bar + address toolbar) down to just
  // this tab row, to reclaim vertical space. Persisted, shared across browsers.
  const [chromeHidden, setChromeHidden] = useState(() => {
    try { return localStorage.getItem("rcw.browser.chromeHidden") === "1"; } catch { return false; }
  });
  const toggleChrome = () => {
    setChromeHidden((h) => {
      const next = !h;
      try { localStorage.setItem("rcw.browser.chromeHidden", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  const addTab = () => { const n = ++seq.current; setTabs((t) => [...t, { id: n }]); setActive(n); };
  const closeTab = (n: number) => {
    setTabs((t) => {
      const next = t.filter((x) => x.id !== n);
      if (active === n) setActive(next[next.length - 1]?.id ?? 0);
      return next.length ? next : [{ id: 0 }];
    });
  };

  const tabBtn: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 7,
    fontFamily: "var(--font-mono)", fontSize: 11, cursor: "pointer", border: "1px solid transparent",
  };
  const ctrlBtn: React.CSSProperties = {
    border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)",
    borderRadius: 6, padding: "3px 7px", fontSize: 11, fontFamily: "var(--font-mono)", cursor: "pointer", lineHeight: 1.3, flexShrink: 0,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div className="no-scrollbar" style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderBottom: "1px solid var(--border)", flexShrink: 0, overflowX: "auto" }}>
        {tabs.map((tab, i) => {
          const on = tab.id === active;
          const label = i === 0 ? "preview" : tab.url ? urlLabel(tab.url) : `tab ${i + 1}`;
          return (
            <span key={tab.id} onClick={() => setActive(tab.id)} title={tab.url ?? label}
              style={{ ...tabBtn, maxWidth: 160, background: on ? "rgb(var(--primary) / 0.22)" : "transparent", color: on ? "var(--text)" : "var(--text-soft)", borderColor: on ? "rgb(var(--primary-soft) / 0.4)" : "transparent" }}>
              <span style={{ width: 5, height: 5, borderRadius: 999, background: on ? "rgb(var(--accent))" : "var(--border-strong)", flexShrink: 0 }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
              {tabs.length > 1 && (
                <span onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }} title="Close tab" style={{ opacity: 0.55, fontSize: 12, lineHeight: 1, flexShrink: 0 }}>✕</span>
              )}
            </span>
          );
        })}
        <button onClick={addTab} title="New browser tab" style={{ ...tabBtn, background: "transparent", color: "var(--text-soft)", border: "1px dashed var(--border-strong)" }}>+ new</button>
        <span style={{ flex: 1 }} />
        {/* Zoom controls for the active tab — the middle shows the effective viewport
            size (px the page sees, changes as you zoom); click it to reset to 100%. */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
          <button onClick={() => bumpZoom(-1)} title="Zoom out" style={ctrlBtn}>−</button>
          <button onClick={() => setZoom(1)} title={`Effective viewport ${vp ? `${vp.w}×${vp.h}px` : ""} · zoom ${Math.round(zoom * 100)}% — click to reset`} style={{ ...ctrlBtn, minWidth: 74, textAlign: "center" }}>{vp ? `${vp.w}×${vp.h}` : `${Math.round(zoom * 100)}%`}</button>
          <button onClick={() => bumpZoom(1)} title="Zoom in" style={ctrlBtn}>+</button>
        </div>
        {/* Responsive device switch (laptop ⇄ mobile) */}
        <button
          onClick={toggleDevice}
          title={device === "mobile" ? "Mobile view — click for laptop" : "Laptop view — click for mobile"}
          style={{ ...ctrlBtn, background: device === "mobile" ? "rgb(var(--primary) / 0.22)" : "transparent", color: device === "mobile" ? "var(--text)" : "var(--text-soft)" }}
        >
          {device === "mobile" ? "📱 mobile" : "🖥 laptop"}
        </button>
        <button
          onClick={toggleChrome}
          title={chromeHidden ? "Show address bar & connection" : "Hide address bar & connection (tabs only)"}
          style={{ ...tabBtn, background: "transparent", color: "var(--text-soft)", border: "1px solid var(--border)", flexShrink: 0 }}
        >
          {chromeHidden ? "▾ bar" : "▴ bar"}
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {tabs.map((tab) => (
          <div key={tab.id} style={{ position: "absolute", inset: 0, display: tab.id === active ? "flex" : "none", flexDirection: "column" }}>
            <BrowserPanel
              sessionId={sessionId} cwd={cwd} machine={machine}
              ephemeral={tab.id !== 0} chromeHidden={chromeHidden} initialUrl={tab.url}
              zoom={zoomByTab[tab.id] ?? 1} device={deviceByTab[tab.id] ?? "laptop"}
              onViewport={(w, h) => setVpByTab((m) => (m[tab.id]?.w === w && m[tab.id]?.h === h ? m : { ...m, [tab.id]: { w, h } }))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
