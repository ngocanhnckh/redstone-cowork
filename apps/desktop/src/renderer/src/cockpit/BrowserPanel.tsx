import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { wireOpenTab } from "./openTabIntercept";
import { fillJs, SAVE_DETECT_JS, decodeCred } from "./credAutofill";

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
  /** Reports the webview's effective viewport (CSS px the page sees, i.e. rendered
   * size ÷ zoom) so the tab row can show it instead of a bare zoom %. */
  onViewport?: (w: number, h: number) => void;
  /** Reports the page's <title> so the tab can be labelled with the site title. */
  onTitle?: (title: string) => void;
  /** Reports the current URL on navigation, so tabs can be persisted/restored. */
  onUrl?: (url: string) => void;
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
  cut(): void;
  copy(): void;
  paste(): void;
  selectAll(): void;
  inspectElement(x: number, y: number): void;
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

/**
 * Turn whatever the user typed in the address bar into a URL, like a real browser:
 * an existing scheme is kept; a bare host/domain gets a scheme prepended (http for
 * localhost/IPs, https otherwise); anything else becomes a Google search.
 */
export function normalizeAddress(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  // Already a full URL / special scheme — leave it alone.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(about|data|blob|chrome|view-source|file):/i.test(s)) return s;
  const isLocal = /^localhost(:\d+)?(\/.*)?$/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(s);
  // A host looks like: localhost[:port], an IPv4[:port], or something with a dot in
  // its first segment (a domain) — and never contains a space.
  const looksLikeHost = !/\s/.test(s) && (isLocal || /^[^\s/]+\.[^\s/.]{2,}(:\d+)?(\/.*)?$/.test(s));
  if (looksLikeHost) return (isLocal ? "http://" : "https://") + s;
  // Otherwise: search it.
  return "https://www.google.com/search?q=" + encodeURIComponent(s);
}

export default function BrowserPanel({ sessionId, cwd, machine, ephemeral, chromeHidden, initialUrl, zoom = 1, device = "laptop", onViewport, onTitle, onUrl }: Props) {
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
  const [loading, setLoading] = useState(false); // page in flight — drives the sci-fi loader
  const webviewRef = useRef<WebviewEl | null>(null);

  // In-page find (Cmd/Ctrl+F). `find` is the query; matches tracks active/total
  // from the webview's found-in-page event. The input is focused when opened.
  const [findOpen, setFindOpen] = useState(false);
  const [find, setFind] = useState("");
  const [matches, setMatches] = useState<{ active: number; total: number }>({ active: 0, total: 0 });
  const findInputRef = useRef<HTMLInputElement | null>(null);

  // "Save password?" banner, shown when a login form submits with new credentials.
  const [savePrompt, setSavePrompt] = useState<{ origin: string; username: string; password: string } | null>(null);

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

  // Track page load state to drive the sci-fi loading overlay. `did-start-loading`
  // fires the moment a navigation begins (before the site paints anything), and
  // `did-stop-loading` when it settles; a fail also ends the loader.
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const start = () => setLoading(true);
    const stop = () => setLoading(false);
    wv.addEventListener("did-start-loading", start as EventListener);
    wv.addEventListener("did-stop-loading", stop as EventListener);
    wv.addEventListener("did-finish-load", stop as EventListener);
    wv.addEventListener("did-fail-load", stop as EventListener);
    wv.addEventListener("crashed", stop as EventListener);
    return () => {
      wv.removeEventListener("did-start-loading", start as EventListener);
      wv.removeEventListener("did-stop-loading", stop as EventListener);
      wv.removeEventListener("did-finish-load", stop as EventListener);
      wv.removeEventListener("did-fail-load", stop as EventListener);
      wv.removeEventListener("crashed", stop as EventListener);
    };
  }, [loadUrl]);

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

  // Callbacks held in refs so re-renders don't churn the webview event listeners.
  const onTitleRef = useRef(onTitle);
  onTitleRef.current = onTitle;
  const onUrlRef = useRef(onUrl);
  onUrlRef.current = onUrl;

  // Keep the address bar synced from live webview navigation, and report the URL up
  // (for tab persistence) and the page title (for the tab label).
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const onNav = (e: Event) => {
      const url = (e as unknown as { url?: string }).url;
      if (url) { setAddress(url); onUrlRef.current?.(url); }
    };
    const onTitleEv = (e: Event) => {
      const t = (e as unknown as { title?: string }).title;
      if (typeof t !== "string" || !t) return;
      // A credential-capture marker (a login form was submitted) → offer to save.
      const cred = decodeCred(t);
      if (cred) {
        try {
          const origin = new URL(wv.getURL()).origin;
          if (origin && origin !== "null") setSavePrompt({ origin, ...cred });
        } catch { /* no origin — skip */ }
        return;
      }
      // Ignore the open-in-new-tab title marker (see openTabIntercept.ts).
      if (!t.startsWith("__RCW_OPEN_TAB__::")) onTitleRef.current?.(t);
    };
    wv.addEventListener("did-navigate", onNav as EventListener);
    wv.addEventListener("did-navigate-in-page", onNav as EventListener);
    wv.addEventListener("page-title-updated", onTitleEv as EventListener);
    return () => {
      wv.removeEventListener("did-navigate", onNav as EventListener);
      wv.removeEventListener("did-navigate-in-page", onNav as EventListener);
      wv.removeEventListener("page-title-updated", onTitleEv as EventListener);
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
  const openInNewTab = (url: string) => {
    const st = useStore.getState();
    st.openUrlInBrowser(sessionId, url);
    if (st.mode !== "hud") st.setActiveTab(sessionId, "browser");
  };
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    return wireOpenTab(wv, openInNewTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadUrl, sessionId]);

  // Password autofill: on each document, fill saved credentials for the current
  // origin and install the save-detector (which signals new logins back via the
  // title marker, handled above). Runs on dom-ready and every navigation.
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const apply = () => {
      let origin = "";
      try { origin = new URL(wv.getURL()).origin; } catch { return; }
      if (!origin || origin === "null") return;
      try { void wv.executeJavaScript(SAVE_DETECT_JS); } catch { /* not ready */ }
      window.cowork.vaultGetForOrigin(origin).then((cred) => {
        if (cred) { try { void wv.executeJavaScript(fillJs(cred.username, cred.password)); } catch { /* ignore */ } }
      }).catch(() => {});
    };
    wv.addEventListener("dom-ready", apply as EventListener);
    return () => wv.removeEventListener("dom-ready", apply as EventListener);
  }, [loadUrl]);

  // The right-click menu is built in the main process on the guest's webContents
  // (see index.ts `context-menu`) — a <webview> does NOT forward that event to the
  // renderer DOM, so it must live in main.

  // Report the webview's effective viewport (what the page sees = rendered px ÷ zoom)
  // so the tab row can show "1280×720" instead of a bare zoom %. Recomputed on resize
  // (window/layout change) and whenever zoom or device mode changes. The callback is
  // held in a ref so re-renders don't churn the ResizeObserver.
  const onViewportRef = useRef(onViewport);
  onViewportRef.current = onViewport;
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const report = () => {
      const cb = onViewportRef.current;
      if (!cb) return;
      const w = Math.round(wv.clientWidth / zoom);
      const h = Math.round(wv.clientHeight / zoom);
      if (w > 0 && h > 0) cb(w, h);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(wv);
    return () => ro.disconnect();
  }, [zoom, device, loadUrl]);

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

  // Go: normalize the address-bar text into a URL (bare domain → https, non-URL →
  // Google search), save it as the override, and load it.
  async function handleGo() {
    const url = normalizeAddress(address);
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

      {savePrompt && (
        <div
          className="glass-surface"
          style={{
            position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", zIndex: 7,
            display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", borderRadius: 12,
            border: "1px solid var(--border)", boxShadow: "0 10px 32px rgba(0,0,0,0.45)", maxWidth: "92%",
          }}
        >
          <span style={{ fontSize: 15 }}>🔑</span>
          <span style={{ fontSize: 12.5, minWidth: 0 }}>
            Save password for <b style={{ overflowWrap: "anywhere" }}>{hostLabel(savePrompt.origin)}</b>
            {savePrompt.username ? <span className="faint"> · {savePrompt.username}</span> : null}?
          </span>
          <button
            className="glass-btn--clay"
            style={{ padding: "5px 13px", fontSize: 12, fontWeight: 600, flexShrink: 0 }}
            onClick={() => {
              const p = savePrompt;
              window.cowork.vaultSave(p.origin, p.username, p.password).catch(() => {});
              setSavePrompt(null);
            }}
          >
            Save
          </button>
          <button
            onClick={() => setSavePrompt(null)}
            title="Not now"
            style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 8, padding: "5px 9px", fontSize: 12, cursor: "pointer", flexShrink: 0 }}
          >
            ✕
          </button>
        </div>
      )}

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
          <div style={{ display: "none" }} />
        )}
        {/* Sci-fi loading overlay — covers the preview until the page paints. */}
        {hasUrl && loading && <BrowserLoader url={address || loadUrl} />}
        {!hasUrl && (
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

/** Short host label for the loader status line. */
function hostLabel(url: string): string {
  try { return new URL(url).host || url; } catch { return url.replace(/^https?:\/\//, "").split("/")[0] || "target"; }
}

const LOADER_CSS = `
@keyframes rcwl-spin { to { transform: rotate(360deg); } }
@keyframes rcwl-spin-rev { to { transform: rotate(-360deg); } }
@keyframes rcwl-sweep { to { transform: rotate(360deg); } }
@keyframes rcwl-pulse { 0%,100% { opacity:.35; transform: scale(.9); } 50% { opacity:1; transform: scale(1.05); } }
@keyframes rcwl-bar { 0% { left:-40%; } 100% { left:100%; } }
@keyframes rcwl-grid { to { background-position: 0 -34px, -34px 0; } }
@keyframes rcwl-blink { 0%,100% { opacity:1; } 50% { opacity:.2; } }
@keyframes rcwl-in { from { opacity:0; } to { opacity:1; } }
.rcwl { position:absolute; inset:0; z-index:6; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:22px;
  overflow:hidden; animation: rcwl-in .18s ease both;
  background: radial-gradient(120% 90% at 50% 42%, rgb(var(--primary) / 0.10), rgba(0,0,0,0.55) 72%), #0b0a09; }
.rcwl-grid { position:absolute; inset:0; opacity:.5; pointer-events:none;
  background-image:
    linear-gradient(rgb(var(--primary-soft) / 0.09) 1px, transparent 1px),
    linear-gradient(90deg, rgb(var(--primary-soft) / 0.09) 1px, transparent 1px);
  background-size: 34px 34px, 34px 34px;
  mask-image: radial-gradient(70% 60% at 50% 45%, #000 30%, transparent 78%);
  -webkit-mask-image: radial-gradient(70% 60% at 50% 45%, #000 30%, transparent 78%);
  animation: rcwl-grid 3.2s linear infinite; }
.rcwl-reticle { position:relative; width:118px; height:118px; }
.rcwl-ring { position:absolute; inset:0; border-radius:50%; }
.rcwl-ring.r1 { border:1.5px solid rgb(var(--primary-soft) / 0.18); border-top-color: rgb(var(--primary-soft)); animation: rcwl-spin 1.15s cubic-bezier(.5,.1,.4,.9) infinite; box-shadow: 0 0 18px -6px rgb(var(--primary-soft)); }
.rcwl-ring.r2 { inset:18px; border:1.5px dashed rgb(var(--accent) / 0.4); border-bottom-color: rgb(var(--accent)); animation: rcwl-spin-rev 1.9s linear infinite; }
.rcwl-ring.r3 { inset:36px; border:1px solid rgb(var(--primary-soft) / 0.14); border-left-color: rgb(var(--primary-soft) / 0.8); animation: rcwl-spin 2.6s linear infinite; }
.rcwl-sweep { position:absolute; inset:0; border-radius:50%; animation: rcwl-sweep 1.6s linear infinite;
  background: conic-gradient(from 0deg, transparent 0deg, rgb(var(--primary-soft) / 0.28) 40deg, transparent 70deg);
  mask: radial-gradient(circle, transparent 26px, #000 27px);
  -webkit-mask: radial-gradient(circle, transparent 26px, #000 27px); }
.rcwl-core { position:absolute; top:50%; left:50%; width:16px; height:16px; margin:-8px 0 0 -8px; border-radius:50%;
  background: radial-gradient(circle, #fff, rgb(var(--accent)) 55%, transparent 72%);
  box-shadow: 0 0 22px 4px rgb(var(--accent) / 0.7); animation: rcwl-pulse 1.1s ease-in-out infinite; }
.rcwl-track { position:relative; width:min(58%, 340px); height:3px; border-radius:999px; overflow:hidden;
  background: rgb(var(--primary-soft) / 0.12); box-shadow: inset 0 0 0 1px rgb(var(--primary-soft) / 0.1); }
.rcwl-track > i { position:absolute; top:0; height:100%; width:38%; border-radius:999px;
  background: linear-gradient(90deg, transparent, rgb(var(--primary-soft)), rgb(var(--accent)), transparent);
  box-shadow: 0 0 14px 1px rgb(var(--primary-soft) / 0.8); animation: rcwl-bar 1.15s cubic-bezier(.6,0,.4,1) infinite; }
.rcwl-label { display:flex; align-items:center; gap:9px; font-family:var(--font-mono); font-size:10.5px; letter-spacing:.28em;
  text-transform:uppercase; color: rgb(var(--primary-soft)); text-shadow: 0 0 12px rgb(var(--primary-soft) / 0.6); }
.rcwl-label b { color: var(--text-soft); font-weight:500; letter-spacing:.12em; text-transform:none; }
.rcwl-dot { width:6px; height:6px; border-radius:50%; background: rgb(var(--accent)); box-shadow:0 0 10px 1px rgb(var(--accent)); animation: rcwl-blink 1s steps(1) infinite; }
`;

/** A self-contained sci-fi loading overlay shown while a page is in flight. */
function BrowserLoader({ url }: { url: string }) {
  return (
    <div className="rcwl no-scrollbar">
      <style>{LOADER_CSS}</style>
      <span className="rcwl-grid" />
      <div className="rcwl-reticle">
        <span className="rcwl-sweep" />
        <span className="rcwl-ring r1" />
        <span className="rcwl-ring r2" />
        <span className="rcwl-ring r3" />
        <span className="rcwl-core" />
      </div>
      <div className="rcwl-track"><i /></div>
      <div className="rcwl-label">
        <span className="rcwl-dot" />
        Establishing link<b style={{ marginLeft: 4 }}>{hostLabel(url)}</b>
      </div>
    </div>
  );
}
