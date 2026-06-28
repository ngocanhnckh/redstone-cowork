import { useEffect, useRef, useState } from "react";
import ConnectionBar from "./ConnectionBar";

interface Props {
  sessionId: string;
  cwd: string;
  machine: string;
}

// Minimal typing for Electron's <webview> so JSX type-checks. We only use the
// handful of imperative methods/events we actually call below.
type WebviewEl = HTMLElement & {
  src: string;
  goBack(): void;
  goForward(): void;
  reload(): void;
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

export default function BrowserPanel({ sessionId, cwd, machine }: Props) {
  // Saved override URL (a typed address); when empty the preview is port-driven.
  const [browserUrl, setBrowserUrl] = useState("");
  const [forwardPorts, setForwardPorts] = useState<number[]>([]);
  const [previewPort, setPreviewPort] = useState<number | null>(null);
  // The URL the webview is actually showing.
  const [loadUrl, setLoadUrl] = useState("");
  // The text shown in the address bar — tracks the live/loaded URL, editable.
  const [address, setAddress] = useState("");
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
      <ConnectionBar
        sessionId={sessionId}
        machine={machine}
        onHostChange={() => {
          if (previewPort != null) ensureForward(previewPort);
          webviewRef.current?.reload();
        }}
      />

      {/* Address + nav controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 32px",
          borderBottom: "1px solid var(--border)",
          minWidth: 0,
        }}
      >
        <button style={navBtn} title="Back" onClick={() => webviewRef.current?.goBack()}>
          ◀
        </button>
        <button style={navBtn} title="Forward" onClick={() => webviewRef.current?.goForward()}>
          ▶
        </button>
        <button style={navBtn} title="Reload" onClick={() => webviewRef.current?.reload()}>
          ⟳
        </button>
        <input
          className="reply-input"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleGo();
          }}
          placeholder="http://localhost:5173"
          style={inputStyle}
        />
        <button
          className="glass-btn--clay"
          onClick={handleGo}
          disabled={saving}
          style={{ padding: "9px 16px", fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1, flexShrink: 0 }}
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
        {status && (
          <span
            className="mono"
            style={{ fontSize: 11, color: status.kind === "ok" ? "rgb(var(--accent))" : "#e0736a", flexShrink: 0 }}
          >
            {status.text}
          </span>
        )}
      </div>

      {/* Preview port selector */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          padding: "8px 32px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span className="faint" style={{ fontSize: 11, letterSpacing: 0.3 }}>
          Preview port
        </span>
        {forwardPorts.length === 0 ? (
          <span className="faint" style={{ fontSize: 11, fontStyle: "italic" }}>
            Forward a port in the Ports tab to preview it here.
          </span>
        ) : (
          forwardPorts.map((p) => {
            const active = previewPort === p && !browserUrl;
            return (
              <button
                key={p}
                onClick={() => selectPreview(p)}
                className="mono"
                style={{
                  border: "1px solid var(--border)",
                  background: active ? "rgb(var(--primary)/0.32)" : "transparent",
                  color: active ? "var(--text)" : "var(--text-soft)",
                  borderRadius: 999,
                  padding: "3px 11px",
                  fontSize: 11.5,
                  cursor: "pointer",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {p}
              </button>
            );
          })
        )}
      </div>

      {/* Preview */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", background: "rgba(0,0,0,0.18)" }}>
        {hasUrl ? (
          <webview
            ref={webviewRef as unknown as React.Ref<HTMLElement>}
            src={loadUrl}
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

      <p
        className="faint"
        style={{ fontSize: 11, lineHeight: 1.5, margin: 0, padding: "8px 32px", borderTop: "1px solid var(--border)" }}
      >
        The preview hits <span className="mono">localhost:&lt;port&gt;</span> — for remote sessions that
        port must be forwarded in the Ports tab.
      </p>
    </div>
  );
}
