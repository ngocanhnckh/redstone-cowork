import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { wireOpenTab } from "./openTabIntercept";

interface Props {
  sessionId: string;
  cwd: string;
  machine: string;
  /** Extra tabs are ephemeral: they read the session's URL to start, but don't
   * overwrite the saved workspace config when navigated. */
  ephemeral?: boolean;
  /** When true, hide the connection bar + address toolbar (driven from the tab
   * row) so only the webview shows — reclaims vertical space. */
  chromeHidden?: boolean;
  /** When set, this (ephemeral) tab starts at this URL instead of the session's
   * saved preview/port — used when opening an external link in the workspace. */
  initialUrl?: string;
  /** Page zoom factor for the webview (1 = 100%). Driven from the tab row. */
  zoom?: number;
  /** Responsive preview mode — "mobile" constrains the view to a phone width so
   * responsive sites render their mobile layout. */
  device?: "laptop" | "mobile";
}

// Minimal typing for Electron's <webview> so JSX type-checks. We only use the
// handful of imperative methods/events we actually call below.
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
  setZoomFactor(factor: number): void;
  executeJavaScript(code: string): Promise<unknown>;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        partition?: string;
        allowpopups?: boolean;
      };
    }
  }
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  borderRadius: 12,
  border: "1px solid var(--border)",
  padding: "10px 13px",
  color: "var(--text)",
  caretColor: "rgb(var(--primary-soft))",
  fontSize: 13,
  background: "rgba(255,255,255,0.03)",
  outline: "none",
  fontFamily: "var(--font-mono)",
};

const navBtn: React.CSSProperties = {
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-soft)",
  borderRadius: 8,
  padding: "6px 11px",
  fontSize: 14,
  fontFamily: "var(--font-mono)",
  cursor: "pointer",
  lineHeight: 1,
};

const findNavBtn: React.CSSProperties = {
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-soft)",
  borderRadius: 6,
  padding: "3px 7px",
  fontSize: 11,
  fontFamily: "var(--font-mono)",
  cursor: "pointer",
  lineHeight: 1.3,
};

function portUrl(port: number): string {
  return `http://localhost:${port}`;
}

export default function BrowserPanel({ sessionId, cwd, machine, ephemeral, chromeHidden, initialUrl, zoom = 1, device = "laptop" }: Props) {
  // Saved override URL (a typed address); when empty the preview is port-driven.
  const [browserUrl, setBrowserUrl] = useState("");
  const [forwardPorts, setForwardPorts] = useState<number[]>([]);
  const [previewPort, setPreviewPort] = useState<number | null>(null);
  // The URL the webview is actually showing. Seeds from initialUrl (a link opened
  // in the workspace) so the tab paints its target immediately.
  const [loadUrl, setLoadUrl] = useState(initialUrl?.trim() ? initialUrl : "");
  // The text shown in the address bar — tracks the live/loaded URL, editable.
  const [address, setAddress] = useState(initialUrl?.trim() ? initialUrl : "");
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const webviewRef = useRef<WebviewEl | null>(null);

  // In-page find (Cmd/Ctrl+F). `find` is the query; matches tracks active/total
  // from the webview's found-in-page event. The input is focused when opened.
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
    webviewRef.current?.stopFindInPage("clearSelection");
  };
  // Search: findInPage is a no-op on empty text, so clear the highlight instead.
  const runFind = (text: string, forward = true, findNext = false) => {
    const wv = webviewRef.current;
    if (!wv) return;
    if (!text) { wv.stopFindInPage("clearSelection"); setMatches({ active: 0, total: 0 }); return; }
    try { wv.findInPage(text, { forward, findNext }); } catch { /* guest not ready */ }
  };

  // Ensure the preview port's tunnel is up before loading (idempotent; no-op when local).
  async function ensureForward(port: number) {
    try {
      const local = await window.cowork.isLocalMachine(machine);
      if (local) return;
      await window.cowork.startForward({ sessionId, machine, port });
    } catch {
      /* best-effort — webview load may still succeed if already forwarded */
    }
  }

  // Point the webview at a URL: update bar + src + imperative load.
  function navigate(url: string) {
    setLoadUrl(url);
    setAddress(url);
    if (url) {
      webviewRef.current?.loadURL(url).catch(() => {/* not ready / bad url — src covers mount */});
    }
  }

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    window.cowork
      .getWorkspaceConfig({ sessionId, cwd, machine })
      .then((cfg) => {
        if (cancelled || !cfg) return;
        const url = (cfg.browserUrl ?? "").trim();
        const preview = cfg.previewPort ?? null;
        setBrowserUrl(url);
        setForwardPorts(cfg.forwardPorts ?? []);
        setPreviewPort(preview);
        // An explicit initialUrl (external link opened in the workspace) wins over
        // the saved config — load it and don't touch the session's saved preview.
        if (initialUrl && initialUrl.trim().length > 0) {
          setLoadUrl(initialUrl);
          setAddress(initialUrl);
          return;
        }
        // Resolve the URL to load: explicit override wins, else the preview port.
        if (url.length > 0) {
          setLoadUrl(url);
          setAddress(url);
        } else if (preview != null) {
          const u = portUrl(preview);
          setLoadUrl(u);
          setAddress(u);
          ensureForward(preview);
        }
      })
      .catch(() => {
        /* ignore — treat as unconfigured */
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, cwd, machine]);

  // Report the primary browser guest's webContents id so the Inspector (DevTools)
  // panel can attach console/network capture to it. Only the primary tab (not
  // ephemeral extra tabs) is the session's canonical browser.
  // Depends on loadUrl because the <webview> is only mounted once there's a URL;
  // re-running when it mounts (and on each navigation) ensures we capture the ref
  // and (re)register. register() runs immediately AND on dom-ready to cover both
  // "guest already created" and "not attached yet" timing.
  useEffect(() => {
    if (ephemeral) return;
    const wv = webviewRef.current;
    if (!wv) return;
    const register = () => {
      try { window.cowork.registerSessionBrowser(sessionId, wv.getWebContentsId()).catch(() => {}); }
      catch { /* guest not attached yet — dom-ready fires again */ }
    };
    register();
    wv.addEventListener("dom-ready", register as EventListener);
    return () => {
      wv.removeEventListener("dom-ready", register as EventListener);
      window.cowork.unregisterSessionBrowser(sessionId).catch(() => {});
    };
  }, [ephemeral, sessionId, loadUrl]);

  // Keep the address bar synced from live webview navigation.
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const onNav = (e: Event) => {
      const url = (e as unknown as { url?: string }).url;
      if (url) setAddress(url);
    };
    wv.addEventListener("did-navigate", onNav as EventListener);
    wv.addEventListener("did-navigate-in-page", onNav as EventListener);
    return () => {
      wv.removeEventListener("did-navigate", onNav as EventListener);
      wv.removeEventListener("did-navigate-in-page", onNav as EventListener);
    };
  }, [loadUrl]);

  // Update the match counter from the webview's found-in-page results.
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const onFound = (e: Event) => {
      const r = (e as unknown as { result?: { activeMatchOrdinal?: number; matches?: number } }).result;
      if (r) setMatches({ active: r.activeMatchOrdinal ?? 0, total: r.matches ?? 0 });
    };
    wv.addEventListener("found-in-page", onFound as EventListener);
    return () => wv.removeEventListener("found-in-page", onFound as EventListener);
  }, [loadUrl]);

  // Cmd/Ctrl+F from a focused guest is intercepted in main and forwarded here;
  // only the panel whose webview matches the guest id reacts. Esc closes.
  useEffect(() => {
    const off = window.cowork.onBrowserFind((a) => {
      const wv = webviewRef.current;
      if (!wv) return;
      let id = -1;
      try { id = wv.getWebContentsId(); } catch { return; }
      if (a.guestId !== id) return;
      if (a.action === "open") openFind();
      else closeFind();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadUrl]);

  // Re-run the search as the query changes while the bar is open.
  useEffect(() => {
    if (findOpen) runFind(find, true, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [find]);

  // "Open in a new tab" from links inside the page → a new tab in this session's
  // workspace browser (renderer-side, so no full app relaunch needed).
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    return wireOpenTab(wv, (url) => {
      const st = useStore.getState();
      st.openUrlInBrowser(sessionId, url);
      if (st.mode !== "hud") st.setActiveTab(sessionId, "browser");
    });
  }, [loadUrl, sessionId]);

  // Apply the page zoom factor — on change and on each navigation (a fresh document
  // resets the webContents zoom back to 1).
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const apply = () => { try { wv.setZoomFactor(zoom); } catch { /* guest not ready */ } };
    apply();
    wv.addEventListener("dom-ready", apply as EventListener);
    return () => wv.removeEventListener("dom-ready", apply as EventListener);
  }, [zoom, loadUrl]);

  async function saveConfig(next: { browserUrl: string; previewPort: number | null }) {
    if (ephemeral) return; // extra tabs navigate freely but don't touch saved config
    try {
      const config = { forwardPorts, browserUrl: next.browserUrl, previewPort: next.previewPort };
      const res = await window.cowork.saveWorkspaceConfig({ sessionId, cwd, machine, config });
      if (res.ok) setStatus({ kind: "ok", text: "✓ saved" });
      else setStatus({ kind: "err", text: res.error ?? "save failed" });
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    }
  }

  // Go: treat the address-bar text as a saved override URL and load it.
  async function handleGo() {
    const url = address.trim();
    if (!url) return;
    setSaving(true);
    setStatus(null);
    setBrowserUrl(url);
    await saveConfig({ browserUrl: url, previewPort });
    setSaving(false);
    navigate(url);
  }

  // Pick a forwarded port as the default preview: clear the override and load it.
  async function selectPreview(port: number) {
    setStatus(null);
    setPreviewPort(port);
    setBrowserUrl("");
    await saveConfig({ browserUrl: "", previewPort: port });
    await ensureForward(port);
    navigate(portUrl(port));
  }

  const hasUrl = loadUrl.trim().length > 0;

  const gotoMatch = (forward: boolean) => { if (find) runFind(find, forward, true); };

  return (
    <div
      style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}
      // Cmd/Ctrl+F when focus is on host chrome (address bar etc.); the guest-focus
      // case is handled in main via before-input-event → onBrowserFind.
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "f" || e.key === "F")) {
          e.preventDefault();
          openFind();
        }
      }}
    >
      {/* The SSH-connection bar lives in the Ports tab (where port/ssh config
          belongs) — it's just wasted space in the browser, so it's not shown here. */}

      {/* Single compact toolbar: nav · address · go · open · preview-port */}
      {!chromeHidden && (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 14px",
          borderBottom: "1px solid var(--border)",
          minWidth: 0,
        }}
      >
        <button style={navBtn} title="Back" onClick={() => webviewRef.current?.goBack()}>◀</button>
        <button style={navBtn} title="Forward" onClick={() => webviewRef.current?.goForward()}>▶</button>
        <button style={navBtn} title="Reload" onClick={() => webviewRef.current?.reload()}>⟳</button>
        <button style={navBtn} title="Hard reload (bypass cache)" onClick={() => webviewRef.current?.reloadIgnoringCache()}>⤿</button>
        <input
          className="reply-input"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleGo();
          }}
          placeholder="http://localhost:5173"
          style={{ ...inputStyle, padding: "7px 11px" }}
        />
        <button
          className="glass-btn--clay"
          onClick={handleGo}
          disabled={saving}
          title="Load this URL"
          style={{ padding: "7px 13px", fontSize: 12.5, fontWeight: 600, opacity: saving ? 0.6 : 1, flexShrink: 0 }}
        >
          {saving ? "…" : "Go"}
        </button>
        <button
          style={navBtn}
          title="Open in real browser"
          onClick={() => {
            const url = address.trim();
            if (url) window.cowork.openExternal(url).catch(() => {/* ignore */});
          }}
        >
          ⧉
        </button>
        {/* Preview port — a compact dropdown instead of a separate chip row */}
        <select
          title="Preview port (forwarded ports)"
          value={browserUrl ? "" : previewPort ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v) selectPreview(Number(v));
          }}
          className="mono"
          style={{
            flexShrink: 0,
            border: "1px solid var(--border)",
            background: "rgba(255,255,255,0.03)",
            color: "var(--text-soft)",
            borderRadius: 8,
            padding: "6px 8px",
            fontSize: 11.5,
            outline: "none",
            cursor: "pointer",
          }}
        >
          <option value="">{forwardPorts.length ? "port…" : "no ports"}</option>
          {forwardPorts.map((p) => (
            <option key={p} value={p}>:{p}</option>
          ))}
        </select>
        {status && (
          <span
            className="mono"
            title={status.text}
            style={{ fontSize: 11, color: status.kind === "ok" ? "rgb(var(--accent))" : "#e0736a", flexShrink: 0 }}
          >
            {status.kind === "ok" ? "✓" : "⚠"}
          </span>
        )}
      </div>
      )}

      {/* Preview — in "mobile" mode the webview is constrained to a phone width and
          centered on a darker backdrop so responsive sites render their mobile layout. */}
      <div style={{
        flex: 1, minHeight: 0, position: "relative", background: "rgba(0,0,0,0.18)",
        display: "flex", justifyContent: device === "mobile" ? "center" : "stretch",
      }}>
        {/* In-page find bar (Cmd/Ctrl+F) — floats over the top-right of the preview */}
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
        {hasUrl ? (
          <webview
            ref={webviewRef as unknown as React.Ref<HTMLElement>}
            src={loadUrl}
            // Shared on-disk profile so cookies / localStorage / logins persist
            // across tabs, custom apps, and app restarts — like a normal browser.
            partition="persist:rcw-web"
            allowpopups
            style={device === "mobile"
              ? { width: 390, maxWidth: "100%", height: "100%", border: 0, flex: "0 0 390px", boxShadow: "0 0 0 1px var(--border), 0 12px 40px rgba(0,0,0,0.5)" }
              : { width: "100%", height: "100%", border: 0, flex: 1 }}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span className="faint" style={{ fontSize: 13, fontStyle: "italic" }}>
              Forward a port (Ports tab) or type a URL above to preview it here.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
