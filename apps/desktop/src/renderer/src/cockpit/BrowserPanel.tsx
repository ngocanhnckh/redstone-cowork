import { useEffect, useRef, useState } from "react";
import ConnectionBar from "./ConnectionBar";

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

function portUrl(port: number): string {
  return `http://localhost:${port}`;
}

export default function BrowserPanel({ sessionId, cwd, machine, ephemeral, chromeHidden, initialUrl }: Props) {
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

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}>
      {!chromeHidden && (
        <ConnectionBar
          sessionId={sessionId}
          machine={machine}
          onHostChange={() => {
            if (previewPort != null) ensureForward(previewPort);
            webviewRef.current?.reload();
          }}
        />
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

      {/* Preview */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", background: "rgba(0,0,0,0.18)" }}>
        {hasUrl ? (
          <webview
            ref={webviewRef as unknown as React.Ref<HTMLElement>}
            src={loadUrl}
            // Shared on-disk profile so cookies / localStorage / logins persist
            // across tabs, custom apps, and app restarts — like a normal browser.
            partition="persist:rcw-web"
            allowpopups
            style={{ width: "100%", height: "100%", border: 0 }}
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
