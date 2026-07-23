import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { wireOpenTab } from "./openTabIntercept";
import { themeCss, isThemed, type AppTheme } from "./appTheme";

// Reuse the same imperative <webview> surface as BrowserPanel (its `declare global`
// augments JSX for the whole app, so the intrinsic + partition/allowpopups exist).
type WebviewEl = HTMLElement & {
  src: string;
  goBack(): void;
  goForward(): void;
  reload(): void;
  reloadIgnoringCache(): void;
  loadURL(url: string): Promise<void>;
  getURL(): string;
  getWebContentsId(): number;
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean }): number;
  stopFindInPage(action: "clearSelection" | "keepSelection" | "activateSelection"): void;
  executeJavaScript(code: string): Promise<unknown>;
  insertCSS(css: string): Promise<string>;
  removeInsertedCSS(key: string): Promise<void>;
};

export type CustomApp = {
  id: string;
  name: string;
  url: string;
  icon: string | null;
  /** When set, the app only shows in this workspace's dock (a `machine:cwd` key).
   * Null/absent = global (shows in every workspace). */
  workspace?: string | null;
  /** When true, the app uses its OWN persistent browser profile (isolated cookies,
   * storage, logins, cache) instead of the shared global one. */
  sessionProfile?: boolean;
  /** Cosmetic theme injected into the app's page to match the cockpit. "off" (default)
   * leaves the site untouched; "dark"/"hitech" inject a universal restyle (appTheme.ts). */
  theme?: AppTheme;
  /** Optional per-app CSS, appended after the theme (always wins). */
  customCss?: string | null;
};

/** The webview partition for an app: its own persistent profile, or the shared one. */
export function appPartition(app: CustomApp): string {
  return app.sessionProfile ? `persist:app-${app.id}` : "persist:rcw-web";
}

const navBtn: React.CSSProperties = {
  border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)",
  borderRadius: 8, padding: "4px 9px", fontSize: 13, fontFamily: "var(--font-mono)", cursor: "pointer", lineHeight: 1,
};

const findNavBtn: React.CSSProperties = {
  border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)",
  borderRadius: 6, padding: "3px 7px", fontSize: 11, fontFamily: "var(--font-mono)", cursor: "pointer", lineHeight: 1.3,
};

/**
 * A custom "app": a chrome-less Chromium view of a fixed URL. No address bar — just
 * a slim nav strip (back / forward / reload / home / open-in-real-browser) so it
 * reads like a native mini-app while keeping full browser behaviour. It shares the
 * persistent `persist:rcw-web` partition, so cookies, localStorage, HTTP auth and
 * logins work and persist exactly like a normal browser. Reports the site favicon
 * back so the dock can use it when the user didn't pick an icon.
 */
export default function CustomAppPanel({ app, onFavicon }: { app: CustomApp; onFavicon: (id: string, url: string) => void }) {
  const ref = useRef<WebviewEl | null>(null);

  // In-page find (Cmd/Ctrl+F) — mirrors BrowserPanel. Cmd+F while the guest has
  // focus is intercepted in main and forwarded via onBrowserFind; when host chrome
  // has focus the root onKeyDown handles it.
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState("");
  const [matches, setMatches] = useState<{ active: number; total: number }>({ active: 0, total: 0 });
  const findInputRef = useRef<HTMLInputElement | null>(null);

  const openFind = () => {
    setFindOpen(true);
    setTimeout(() => { findInputRef.current?.focus(); findInputRef.current?.select(); }, 0);
  };
  const closeFind = () => {
    setFindOpen(false);
    setMatches({ active: 0, total: 0 });
    ref.current?.stopFindInPage("clearSelection");
  };
  const runFind = (text: string, forward = true, findNext = false) => {
    const wv = ref.current;
    if (!wv) return;
    if (!text) { wv.stopFindInPage("clearSelection"); setMatches({ active: 0, total: 0 }); return; }
    try { wv.findInPage(text, { forward, findNext }); } catch { /* guest not ready */ }
  };
  const gotoMatch = (forward: boolean) => { if (find) runFind(find, forward, true); };

  // Match counter from the webview's found-in-page results.
  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    const onFound = (e: Event) => {
      const r = (e as unknown as { result?: { activeMatchOrdinal?: number; matches?: number } }).result;
      if (r) setMatches({ active: r.activeMatchOrdinal ?? 0, total: r.matches ?? 0 });
    };
    wv.addEventListener("found-in-page", onFound as EventListener);
    return () => wv.removeEventListener("found-in-page", onFound as EventListener);
  }, [app.id]);

  // Cmd/Ctrl+F forwarded from main for this guest; Esc closes.
  useEffect(() => {
    const off = window.cowork.onBrowserFind((a) => {
      const wv = ref.current;
      if (!wv) return;
      let id = -1;
      try { id = wv.getWebContentsId(); } catch { return; }
      if (a.guestId !== id) return;
      if (a.action === "open") openFind();
      else closeFind();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.id]);

  // Re-run the search as the query changes while the bar is open.
  useEffect(() => {
    if (findOpen) runFind(find, true, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [find]);

  // Links that open a new tab → a new tab in the focused session's workspace
  // browser (renderer-side; works on reload without a full relaunch).
  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    return wireOpenTab(wv, (url) => {
      const st = useStore.getState();
      const sid = st.focusId;
      if (sid) { st.openUrlInBrowser(sid, url); if (st.mode !== "hud") st.setActiveTab(sid, "browser"); }
      else window.cowork.openExternal(url).catch(() => {});
    });
  }, [app.id]);

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    const onFav = (e: Event) => {
      const favicons = (e as unknown as { favicons?: string[] }).favicons;
      if (favicons && favicons.length) onFavicon(app.id, favicons[0]);
    };
    wv.addEventListener("page-favicon-updated", onFav as EventListener);
    return () => wv.removeEventListener("page-favicon-updated", onFav as EventListener);
  }, [app.id, onFavicon]);

  // Theme injection: restyle the guest page to match the cockpit. The inserted-CSS
  // key is kept so we can swap it out live when the theme/customCss change (no reload)
  // and re-apply on every fresh document (dom-ready). All guarded — never throws.
  const cssKeyRef = useRef<string | null>(null);
  const css = themeCss(app.theme, app.customCss);
  const themed = isThemed(app.theme);
  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    let disposed = false;
    const apply = async () => {
      try {
        // Composite the guest transparently while themed so the cockpit glass shows
        // through the (CSS-transparent) page; opaque again when the theme is off.
        try { window.cowork.setAppTransparent(wv.getWebContentsId(), themed).catch(() => {}); } catch { /* not ready */ }
        const prev = cssKeyRef.current;
        cssKeyRef.current = null;
        if (prev) { try { await wv.removeInsertedCSS(prev); } catch { /* stale doc */ } }
        if (!disposed && css) cssKeyRef.current = await wv.insertCSS(css);
      } catch { /* guest not ready — dom-ready will fire again */ }
    };
    // Apply now (theme/customCss changed on an already-loaded page) and on each new doc.
    void apply();
    wv.addEventListener("dom-ready", apply as EventListener);
    return () => {
      disposed = true;
      wv.removeEventListener("dom-ready", apply as EventListener);
    };
  }, [app.id, css, themed]);

  // Keep the mini-app pinned to its own domain: register this guest's home URL so
  // the main process pops cross-domain links out to the real browser. dom-ready
  // fires once the guest exists (and on every document), so we (re-)assert the
  // home each time; we unregister on unmount so a closed app frees the entry.
  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    let id: number | null = null;
    const register = () => {
      try {
        id = wv.getWebContentsId();
        window.cowork.registerAppGuest(id, app.url).catch(() => {});
      } catch {
        /* guest not attached yet — dom-ready will fire again */
      }
    };
    wv.addEventListener("dom-ready", register as EventListener);
    return () => {
      wv.removeEventListener("dom-ready", register as EventListener);
      if (id != null) window.cowork.unregisterAppGuest(id).catch(() => {});
    };
  }, [app.id, app.url]);

  return (
    <div
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "f" || e.key === "F")) {
          e.preventDefault();
          openFind();
        }
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <button style={navBtn} title="Back" onClick={() => ref.current?.goBack()}>◀</button>
        <button style={navBtn} title="Forward" onClick={() => ref.current?.goForward()}>▶</button>
        <button style={navBtn} title="Reload" onClick={() => ref.current?.reload()}>⟳</button>
        <button style={navBtn} title="Home" onClick={() => ref.current?.loadURL(app.url).catch(() => {})}>⌂</button>
        <span className="mono" style={{ flex: 1, minWidth: 0, fontSize: 11, color: "var(--text-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={app.url}>
          {app.name}
        </span>
        <button style={navBtn} title="Open in real browser" onClick={() => window.cowork.openExternal(app.url).catch(() => {})}>⧉</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: "relative", background: themed ? "color-mix(in srgb, var(--app-panel) 52%, transparent)" : "rgba(0,0,0,0.18)", backdropFilter: themed ? "blur(6px)" : undefined }}>
        {/* In-page find bar (Cmd/Ctrl+F) — floats over the top-right of the app */}
        {findOpen && (
          <div
            className="glass-surface"
            style={{
              position: "absolute", top: 10, right: 12, zIndex: 5,
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 8px", borderRadius: 12, border: "1px solid var(--border)",
              boxShadow: "0 8px 28px rgba(0,0,0,0.4)",
            }}
          >
            <input
              ref={findInputRef}
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); gotoMatch(!e.shiftKey); }
                else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
              }}
              placeholder="Find in page…"
              className="mono"
              style={{
                width: 190, minWidth: 0, background: "rgba(255,255,255,0.04)",
                border: "1px solid var(--border)", borderRadius: 8, padding: "5px 9px",
                fontSize: 12, color: "var(--text)", outline: "none",
              }}
            />
            <span className="mono faint" style={{ fontSize: 10.5, minWidth: 44, textAlign: "right" }}>
              {matches.total ? `${matches.active}/${matches.total}` : find ? "0/0" : ""}
            </span>
            <button onClick={() => gotoMatch(false)} disabled={!matches.total} title="Previous (⇧⏎)" style={findNavBtn}>▲</button>
            <button onClick={() => gotoMatch(true)} disabled={!matches.total} title="Next (⏎)" style={findNavBtn}>▼</button>
            <button onClick={closeFind} title="Close (Esc)" style={findNavBtn}>✕</button>
          </div>
        )}
        <webview
          ref={ref as unknown as React.Ref<HTMLElement>}
          src={app.url}
          partition={appPartition(app)}
          allowpopups
          // Transparent while themed so the guest's CSS-transparent page composites over
          // the glass panel behind it (see setAppTransparent); opaque otherwise.
          style={{ width: "100%", height: "100%", border: 0, backgroundColor: themed ? "transparent" : undefined }}
        />
      </div>
    </div>
  );
}
