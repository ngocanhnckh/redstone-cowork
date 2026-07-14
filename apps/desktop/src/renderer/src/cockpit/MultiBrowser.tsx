import { useEffect, useRef, useState } from "react";
import BrowserPanel from "./BrowserPanel";
import { IconMenu, IconIncognito, IconKey, IconPuzzle, IconLaptop, IconPhone, IconPlus, IconMinus, IconEyeOff, IconExternal } from "./Icons";
import ExtensionsPanel from "./ExtensionsPanel";
import VaultPanel from "./VaultPanel";
import { useStore } from "../store";

/** Short label for a URL tab: its hostname, or a truncated string as a fallback. */
function urlLabel(url: string): string {
  try { return new URL(url).hostname || url; } catch { return url.slice(0, 24); }
}

type Tab = { id: number; url?: string; temp?: boolean };
type SavedTabs = { tabs: Tab[]; active: number; seq: number };
const TABS_KEY = "rcw.browser.tabs.v1";
// Width of the docked strip the tools menu opens into (the webview shrinks by this).
const MENU_STRIP = 240;

/** The webview storage partition for a tab. Temp/incognito tabs get a UNIQUE
 * non-persistent partition (no `persist:` prefix) → isolated cookies/storage that
 * are wiped when the tab (and app) closes, so several throwaway logins coexist. */
function partitionFor(sessionId: string, tab: Tab): string {
  return tab.temp ? `rcw-temp-${sessionId}-${tab.id}` : "persist:rcw-web";
}

/** Load a session's persisted open tabs (so reopening Redstone restores them). */
function loadSavedTabs(sessionId: string): SavedTabs | null {
  try {
    const all = JSON.parse(localStorage.getItem(TABS_KEY) || "{}") as Record<string, SavedTabs>;
    const s = all[sessionId];
    if (s && Array.isArray(s.tabs) && s.tabs.some((t) => t.id === 0)) return s;
  } catch { /* ignore */ }
  return null;
}

/**
 * A tabbed set of browser previews for one session — like Chrome tabs. Each tab is
 * its own <webview>, all kept mounted and toggled with `display` so switching tabs
 * never reloads a page. Tab 0 is the session's primary preview (persists the saved
 * URL/port config); extra tabs are ephemeral (navigate freely, don't overwrite it).
 */
export default function MultiBrowser({ sessionId, cwd, machine }: { sessionId: string; cwd: string; machine: string }) {
  // Restore this session's tabs from a previous run (Redstone remembers them).
  const saved = useRef(loadSavedTabs(sessionId)).current;
  const seq = useRef(saved?.seq ?? 0);
  // Tab 0 is the session's primary preview (config-driven, no url). Extra tabs may
  // carry a url when opened for an external link ("open in the workspace browser").
  const [tabs, setTabs] = useState<Tab[]>(saved?.tabs?.length ? saved.tabs : [{ id: 0 }]);
  const [active, setActive] = useState(saved?.active ?? 0);

  // Per-tab page zoom + responsive device mode (applied to that tab's <webview>).
  // Global extensions manager + credential vault (partition-wide, shared).
  const [extOpen, setExtOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Esc closes the tools menu (there's no DOM click-away over a native webview).
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  const [zoomByTab, setZoomByTab] = useState<Record<number, number>>({});
  const [deviceByTab, setDeviceByTab] = useState<Record<number, "laptop" | "mobile">>({});
  // Effective viewport (CSS px the page sees) per tab, reported by each BrowserPanel.
  const [vpByTab, setVpByTab] = useState<Record<number, { w: number; h: number }>>({});
  // Page title + current URL per tab, reported by each BrowserPanel (title → tab
  // label; url → persistence so a tab restores to where you left it).
  const [titleByTab, setTitleByTab] = useState<Record<number, string>>({});
  const [urlByTab, setUrlByTab] = useState<Record<number, string>>({});
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

  // Persist this session's open tabs (+ active + seq) so reopening Redstone restores
  // them. Tab 0 stays config-driven (no saved url); extra tabs remember their current
  // URL so they reload where you left off.
  useEffect(() => {
    try {
      const all = JSON.parse(localStorage.getItem(TABS_KEY) || "{}") as Record<string, SavedTabs>;
      // Temp/incognito tabs are throwaway — never persist them (their partition is
      // wiped anyway, so restoring one would just be an empty tab).
      const persistable = tabs.filter((t) => !t.temp);
      all[sessionId] = {
        tabs: persistable.map((t) => (t.id === 0 ? { id: 0 } : { id: t.id, url: urlByTab[t.id] ?? t.url })),
        active: tabs.find((t) => t.id === active)?.temp ? 0 : active,
        seq: seq.current,
      };
      localStorage.setItem(TABS_KEY, JSON.stringify(all));
    } catch { /* ignore */ }
  }, [tabs, active, urlByTab, sessionId]);

  const addTab = () => { const n = ++seq.current; setTabs((t) => [...t, { id: n }]); setActive(n); };
  // Incognito tab: fresh isolated profile (unique non-persistent partition) so the
  // developer can be logged into a different account here than in every other tab.
  const addTempTab = () => {
    const n = ++seq.current;
    const tab: Tab = { id: n, temp: true };
    // Prime the partition's browser permissions before the webview mounts.
    window.cowork.prepareBrowserPartition(partitionFor(sessionId, tab)).catch(() => {/* ignore */});
    setTabs((t) => [...t, tab]);
    setActive(n);
  };
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
  const menuIconBtn: React.CSSProperties = {
    width: 24, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center",
    border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)",
    borderRadius: 6, cursor: "pointer", flexShrink: 0,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div className="no-scrollbar" style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderBottom: "1px solid var(--border)", flexShrink: 0, overflowX: "auto" }}>
        {tabs.map((tab, i) => {
          const on = tab.id === active;
          const url = urlByTab[tab.id] ?? tab.url;
          const title = titleByTab[tab.id];
          // Prefer the page title; fall back to the hostname, then "preview"/"tab N".
          const label = title || (url ? urlLabel(url) : tab.temp ? "incognito" : i === 0 ? "preview" : `tab ${i + 1}`);
          // Full title (+ url) on hover, since the label is truncated.
          const tip = [tab.temp ? "Incognito — isolated cookies/storage" : null, title, url].filter(Boolean).join("\n") || label;
          // Incognito tabs get a distinct violet tint so they're never confused with
          // your logged-in profile.
          const tint = tab.temp ? "rgb(168 130 255)" : "rgb(var(--accent))";
          return (
            <span key={tab.id} onClick={() => setActive(tab.id)} title={tip}
              style={{ ...tabBtn, maxWidth: 180,
                background: on ? (tab.temp ? "rgb(168 130 255 / 0.20)" : "rgb(var(--primary) / 0.22)") : "transparent",
                color: on ? "var(--text)" : "var(--text-soft)",
                borderColor: on ? (tab.temp ? "rgb(168 130 255 / 0.5)" : "rgb(var(--primary-soft) / 0.4)") : "transparent" }}>
              {tab.temp
                ? <IconIncognito size={12} style={{ color: on ? "rgb(168 130 255)" : "var(--text-faint)" }} />
                : <span style={{ width: 5, height: 5, borderRadius: 999, background: on ? tint : "var(--border-strong)", flexShrink: 0 }} />}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
              {tabs.length > 1 && (
                <span onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }} title="Close tab" style={{ opacity: 0.55, fontSize: 12, lineHeight: 1, flexShrink: 0 }}>✕</span>
              )}
            </span>
          );
        })}
        <button onClick={addTab} title="New browser tab" style={{ ...tabBtn, gap: 5, background: "transparent", color: "var(--text-soft)", border: "1px dashed var(--border-strong)" }}><IconPlus size={12} /> new</button>
        <button onClick={addTempTab} title="New incognito tab — a fresh, isolated profile (separate cookies/logins) for testing another account" style={{ ...tabBtn, gap: 5, background: "transparent", color: "rgb(168 130 255)", border: "1px dashed rgb(168 130 255 / 0.5)" }}><IconIncognito size={13} /> incognito</button>
        <span style={{ flex: 1 }} />
        {/* All secondary controls collapse into one menu to save toolbar space. The
            dropdown itself renders down in the webview area (below) — an Electron
            <webview> paints as a native layer ABOVE all DOM, so a normal dropdown
            here would be hidden behind the page regardless of z-index. */}
        <button onClick={() => setMenuOpen((v) => !v)} title="Browser tools" aria-expanded={menuOpen}
          style={{ ...ctrlBtn, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 7px", background: menuOpen ? "rgb(var(--primary) / 0.18)" : "transparent", color: menuOpen ? "var(--text)" : "var(--text-soft)" }}>
          <IconMenu size={15} />
        </button>
      </div>
      {extOpen && <ExtensionsPanel onClose={() => setExtOpen(false)} />}
      {vaultOpen && <VaultPanel onClose={() => setVaultOpen(false)} />}
      {/* While the menu is open the active webview is hidden (visibility:hidden — the
          ONLY way to stop the native guest layer painting over our DOM menu). The
          menu + backdrop force visibility:visible so they show over the blanked area. */}
      {/* When the menu is open we SHRINK the webview to open a side strip for it (a
          docked-panel pattern) rather than hiding the page — an Electron <webview>
          paints above all DOM, so the page has to physically not cover the menu. This
          keeps the page visible so zoom / device changes preview live. */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {tabs.map((tab) => (
          <div key={tab.id} style={{ position: "absolute", top: 0, left: 0, bottom: 0, right: menuOpen ? MENU_STRIP : 0, display: tab.id === active ? "flex" : "none", flexDirection: "column" }}>
            <BrowserPanel
              sessionId={sessionId} cwd={cwd} machine={machine}
              ephemeral={tab.id !== 0} isActive={tab.id === active} chromeHidden={chromeHidden} initialUrl={tab.url}
              partition={partitionFor(sessionId, tab)} incognito={tab.temp}
              zoom={zoomByTab[tab.id] ?? 1} device={deviceByTab[tab.id] ?? "laptop"}
              onViewport={(w, h) => setVpByTab((m) => (m[tab.id]?.w === w && m[tab.id]?.h === h ? m : { ...m, [tab.id]: { w, h } }))}
              onTitle={(t) => setTitleByTab((m) => (m[tab.id] === t ? m : { ...m, [tab.id]: t }))}
              onUrl={(u) => setUrlByTab((m) => (m[tab.id] === u ? m : { ...m, [tab.id]: u }))}
            />
          </div>
        ))}
        {menuOpen && (
          <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: MENU_STRIP, background: "color-mix(in srgb, var(--app-panel) 92%, transparent)", borderLeft: "1px solid var(--border)", zIndex: 41, padding: 8 }}>
            <div className="glass-menu" style={{ borderRadius: 11, border: "1px solid var(--border-strong)", boxShadow: "0 16px 44px rgba(0,0,0,0.5)", padding: 6, display: "flex", flexDirection: "column", gap: 2 }}>
              {/* Zoom row */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px" }}>
                <span className="mono faint" style={{ fontSize: 11, flex: 1 }}>Zoom {vp ? `· ${vp.w}×${vp.h}` : ""}</span>
                <button onClick={() => bumpZoom(-1)} title="Zoom out" style={menuIconBtn}><IconMinus size={13} /></button>
                <button onClick={() => setZoom(1)} title="Reset to 100%" style={{ ...menuIconBtn, width: "auto", padding: "0 8px", fontFamily: "var(--font-mono)", fontSize: 11 }}>{Math.round(zoom * 100)}%</button>
                <button onClick={() => bumpZoom(1)} title="Zoom in" style={menuIconBtn}><IconPlus size={13} /></button>
              </div>
              <MenuItem icon={<IconExternal size={15} />} label="Open in new window" onClick={() => { const url = urlByTab[active] ?? tabs.find((t) => t.id === active)?.url ?? ""; window.cowork.openBrowserWindow(url, partitionFor(sessionId, tabs.find((t) => t.id === active) ?? { id: active })).catch(() => {}); setMenuOpen(false); }} />
              <MenuItem icon={device === "mobile" ? <IconLaptop size={15} /> : <IconPhone size={15} />} label={device === "mobile" ? "Switch to laptop view" : "Switch to mobile view"} onClick={() => { toggleDevice(); }} />
              <MenuItem icon={<IconKey size={15} />} label="Passwords & vault" onClick={() => { setVaultOpen(true); setMenuOpen(false); }} />
              <MenuItem icon={<IconPuzzle size={15} />} label="Extensions" onClick={() => { setExtOpen(true); setMenuOpen(false); }} />
              <MenuItem icon={<IconEyeOff size={15} />} label={chromeHidden ? "Show address bar" : "Hide address bar"} onClick={() => { toggleChrome(); setMenuOpen(false); }} />
            </div>
            <button onClick={() => setMenuOpen(false)} className="mono faint" style={{ marginTop: 8, width: "100%", background: "transparent", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 0", fontSize: 10.5, color: "var(--text-soft)", cursor: "pointer" }}>close ✕</button>
          </div>
        )}
      </div>
    </div>
  );
}

/** A row in the browser tools dropdown: leading icon + label, full-width hover. */
function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="glass-inset-hover"
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "7px 9px", borderRadius: 8,
        background: "transparent", border: "1px solid transparent", color: "var(--text)",
        fontSize: 12.5, cursor: "pointer", textAlign: "left", width: "100%",
      }}
    >
      <span style={{ color: "var(--text-soft)", display: "inline-flex" }}>{icon}</span>
      {label}
    </button>
  );
}
