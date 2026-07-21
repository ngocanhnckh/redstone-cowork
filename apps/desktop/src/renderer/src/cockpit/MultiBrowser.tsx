import { useEffect, useRef, useState } from "react";
import BrowserPanel from "./BrowserPanel";
import { IconMenu, IconIncognito, IconKey, IconPuzzle, IconLaptop, IconPhone, IconPlus, IconMinus, IconEyeOff, IconExternal, IconComment, IconCrop } from "./Icons";
import ExtensionsPanel from "./ExtensionsPanel";
import VaultPanel from "./VaultPanel";
import { useStore } from "../store";
import { tabsToDiscard } from "./tabDiscard";

/** How often we re-evaluate which hidden tabs have aged past the grace period. */
const DISCARD_SWEEP_MS = 15_000;

/** Short label for a URL tab: its hostname, or a truncated string as a fallback. */
function urlLabel(url: string): string {
  try { return new URL(url).hostname || url; } catch { return url.slice(0, 24); }
}

type Tab = { id: number; url?: string; temp?: boolean };
type SavedTabs = { tabs: Tab[]; active: number; seq: number };
const TABS_KEY = "rcw.browser.tabs.v1";

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
 * A tabbed set of browser previews for one session — like Chrome tabs. The active
 * tab of a visible browser stays mounted and is toggled with `display` so switching
 * back and forth never reloads it; tabs hidden for a while (or pushed out by the
 * LRU cap) are DISCARDED — their <webview> unmounts so the guest process and its
 * GPU tiles are freed — and reload from their last URL when clicked, like Chrome.
 * Tab 0 is the session's primary preview (persists the saved URL/port config);
 * extra tabs are ephemeral (navigate freely, don't overwrite it).
 *
 * `visible` = this session's browser layer is the one actually on screen.
 */
export default function MultiBrowser({ sessionId, cwd, machine, visible }: { sessionId: string; cwd: string; machine: string; visible: boolean }) {
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
  // Active "point & prompt" tool for the visible tab (comment/inspect or region shot).
  const [annotate, setAnnotate] = useState<"off" | "dom" | "region">("off");
  // Leaving a tab exits any active tool so it never carries over to the next tab.
  useEffect(() => { setAnnotate("off"); }, [active]);
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
  // ── Chrome-style discarding ────────────────────────────────────────────────
  // `lastLiveAt[id]` = the last moment that tab was the on-screen one. The effect
  // below stamps it while a tab is live AND on the way out, so for a hidden tab it
  // reads as "hidden since". `discarded` holds the ids whose <webview> is unmounted.
  const lastLiveAt = useRef<Record<number, number>>({});
  const [discarded, setDiscarded] = useState<number[]>([]);
  useEffect(() => {
    if (!visible) return;
    lastLiveAt.current[active] = Date.now();
    return () => { lastLiveAt.current[active] = Date.now(); };
  }, [visible, active]);
  // The sweep runs on every visibility/active change too, so a discarded tab is
  // re-mounted the instant it becomes live again (it is never a discard candidate).
  useEffect(() => {
    const sweep = () => {
      const drop = tabsToDiscard({ tabs, activeId: active, visible, lastLiveAt: lastLiveAt.current, now: Date.now() });
      setDiscarded((prev) => (prev.length === drop.length && drop.every((id) => prev.includes(id)) ? prev : drop));
      // Freeze each newly discarded tab's live URL onto the tab itself, so the
      // re-mount (and localStorage) restores it where the user left off.
      if (drop.length) {
        setTabs((t) => {
          let changed = false;
          const next = t.map((tab) => {
            const u = urlByTab[tab.id];
            if (!drop.includes(tab.id) || !u || tab.url === u) return tab;
            changed = true;
            return { ...tab, url: u };
          });
          return changed ? next : t;
        });
      }
    };
    sweep();
    const h = setInterval(sweep, DISCARD_SWEEP_MS);
    return () => clearInterval(h);
  }, [tabs, active, visible, urlByTab]);

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
          // A discarded tab has no live page (freed to save memory) — dim it so the
          // reload on click isn't a surprise.
          const asleep = discarded.includes(tab.id);
          const tip = [tab.temp ? "Incognito — isolated cookies/storage" : null, asleep ? "Discarded to save memory — click to reload" : null, title, url].filter(Boolean).join("\n") || label;
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
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: asleep ? 0.5 : 1 }}>{label}</span>
              {tabs.length > 1 && (
                <span onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }} title="Close tab" style={{ opacity: 0.55, fontSize: 12, lineHeight: 1, flexShrink: 0 }}>✕</span>
              )}
            </span>
          );
        })}
        <button onClick={addTab} title="New browser tab" style={{ ...tabBtn, gap: 5, background: "transparent", color: "var(--text-soft)", border: "1px dashed var(--border-strong)" }}><IconPlus size={12} /> new</button>
        <button onClick={addTempTab} title="New incognito tab — a fresh, isolated profile (separate cookies/logins) for testing another account" style={{ ...tabBtn, gap: 5, background: "transparent", color: "rgb(168 130 255)", border: "1px dashed rgb(168 130 255 / 0.5)" }}><IconIncognito size={13} /> incognito</button>
        <span style={{ flex: 1 }} />
        {/* Zoom lives in the toolbar (not the menu) so it previews live on the page —
            the tools menu hides the webview while open, which would otherwise stop you
            seeing the zoom change. */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
          <button onClick={() => bumpZoom(-1)} title="Zoom out" style={{ ...menuIconBtn }}><IconMinus size={12} /></button>
          <button onClick={() => setZoom(1)} title={`Effective viewport ${vp ? `${vp.w}×${vp.h}px` : ""} · zoom ${Math.round(zoom * 100)}% — click to reset`} style={{ ...ctrlBtn, minWidth: 74, textAlign: "center" }}>{vp ? `${vp.w}×${vp.h}` : `${Math.round(zoom * 100)}%`}</button>
          <button onClick={() => bumpZoom(1)} title="Zoom in" style={{ ...menuIconBtn }}><IconPlus size={12} /></button>
        </div>
        {/* Remaining secondary controls collapse into one menu. The dropdown OVERLAPS
            the page (webview hidden while open) — an Electron <webview> paints above all
            DOM, so it can't sit under a normal z-indexed dropdown. Hiding preserves the
            webview's SIZE, so the page's width/responsive layout stays accurate. */}
        {/* Point & prompt: DOM comment/inspect and region screenshot → prompt the
            session's agent with exact context. Toggle off by clicking again / Esc. */}
        <button onClick={() => setAnnotate((m) => (m === "dom" ? "off" : "dom"))} title="Comment on elements → prompt the agent"
          style={{ ...ctrlBtn, flexShrink: 0, padding: "4px 7px", background: annotate === "dom" ? "rgb(var(--accent) / 0.22)" : "transparent", color: annotate === "dom" ? "var(--text)" : "var(--text-soft)" }}>
          <IconComment size={15} />
        </button>
        <button onClick={() => setAnnotate((m) => (m === "region" ? "off" : "region"))} title="Screenshot an area → prompt the agent"
          style={{ ...ctrlBtn, flexShrink: 0, padding: "4px 7px", background: annotate === "region" ? "rgb(var(--accent) / 0.22)" : "transparent", color: annotate === "region" ? "var(--text)" : "var(--text-soft)" }}>
          <IconCrop size={15} />
        </button>
        <button onClick={() => setMenuOpen((v) => !v)} title="Browser tools" aria-expanded={menuOpen}
          style={{ ...ctrlBtn, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 7px", background: menuOpen ? "rgb(var(--primary) / 0.18)" : "transparent", color: menuOpen ? "var(--text)" : "var(--text-soft)" }}>
          <IconMenu size={15} />
        </button>
      </div>
      {extOpen && <ExtensionsPanel onClose={() => setExtOpen(false)} />}
      {vaultOpen && <VaultPanel onClose={() => setVaultOpen(false)} />}
      {/* The menu OVERLAPS the page: an Electron <webview> paints above all DOM, so
          while the menu is open we hide the active webview (visibility:hidden). That
          hides the paint but PRESERVES the webview's size — so the page's width /
          responsive (email) layout is unchanged; it's overlapped, not pushed. The menu
          (visibility:visible) shows over the blanked area. */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", visibility: menuOpen ? "hidden" : "visible" }}>
        {tabs.filter((tab) => !discarded.includes(tab.id)).map((tab) => (
          <div key={tab.id} style={{ position: "absolute", inset: 0, display: tab.id === active ? "flex" : "none", flexDirection: "column" }}>
            <BrowserPanel
              sessionId={sessionId} cwd={cwd} machine={machine}
              ephemeral={tab.id !== 0} isActive={tab.id === active} chromeHidden={chromeHidden} initialUrl={tab.url}
              partition={partitionFor(sessionId, tab)} incognito={tab.temp}
              zoom={zoomByTab[tab.id] ?? 1} device={deviceByTab[tab.id] ?? "laptop"}
              annotateMode={tab.id === active ? annotate : "off"}
              onExitAnnotate={() => setAnnotate("off")}
              onViewport={(w, h) => setVpByTab((m) => (m[tab.id]?.w === w && m[tab.id]?.h === h ? m : { ...m, [tab.id]: { w, h } }))}
              onTitle={(t) => setTitleByTab((m) => (m[tab.id] === t ? m : { ...m, [tab.id]: t }))}
              onUrl={(u) => setUrlByTab((m) => (m[tab.id] === u ? m : { ...m, [tab.id]: u }))}
            />
          </div>
        ))}
        {menuOpen && (
          <div className="glass-menu" style={{ position: "absolute", top: 8, right: 12, zIndex: 41, visibility: "visible", minWidth: 216, borderRadius: 11, border: "1px solid var(--border-strong)", boxShadow: "0 16px 44px rgba(0,0,0,0.55)", padding: 6, display: "flex", flexDirection: "column", gap: 2 }}>
            <MenuItem icon={<IconExternal size={15} />} label="Open in new window" onClick={() => { const url = urlByTab[active] ?? tabs.find((t) => t.id === active)?.url ?? ""; window.cowork.openBrowserWindow(url, partitionFor(sessionId, tabs.find((t) => t.id === active) ?? { id: active })).catch(() => {}); setMenuOpen(false); }} />
            <MenuItem icon={device === "mobile" ? <IconLaptop size={15} /> : <IconPhone size={15} />} label={device === "mobile" ? "Switch to laptop view" : "Switch to mobile view"} onClick={() => { toggleDevice(); setMenuOpen(false); }} />
            <MenuItem icon={<IconKey size={15} />} label="Passwords & vault" onClick={() => { setVaultOpen(true); setMenuOpen(false); }} />
            <MenuItem icon={<IconPuzzle size={15} />} label="Extensions" onClick={() => { setExtOpen(true); setMenuOpen(false); }} />
            <MenuItem icon={<IconEyeOff size={15} />} label={chromeHidden ? "Show address bar" : "Hide address bar"} onClick={() => { toggleChrome(); setMenuOpen(false); }} />
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
