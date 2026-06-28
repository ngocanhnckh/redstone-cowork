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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export default function BrowserPanel({ sessionId, cwd, machine }: Props) {
  const [browserUrl, setBrowserUrl] = useState("");
  const [forwardPorts, setForwardPorts] = useState<number[]>([]);
  const [currentUrl, setCurrentUrl] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const webviewRef = useRef<WebviewEl | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    window.cowork
      .getWorkspaceConfig({ sessionId, cwd, machine })
      .then((cfg) => {
        if (cancelled || !cfg) return;
        setBrowserUrl(cfg.browserUrl ?? "");
        setCurrentUrl(cfg.browserUrl ?? "");
        setForwardPorts(cfg.forwardPorts ?? []);
      })
      .catch(() => {
        /* ignore — treat as unconfigured */
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, cwd, machine]);

  // Keep `currentUrl` synced from the live webview navigation.
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const onNav = (e: Event) => {
      const url = (e as unknown as { url?: string }).url;
      if (url) setCurrentUrl(url);
    };
    wv.addEventListener("did-navigate", onNav as EventListener);
    wv.addEventListener("did-navigate-in-page", onNav as EventListener);
    return () => {
      wv.removeEventListener("did-navigate", onNav as EventListener);
      wv.removeEventListener("did-navigate-in-page", onNav as EventListener);
    };
  }, [browserUrl]);

  async function handleSave() {
    setSaving(true);
    setStatus(null);
    const url = browserUrl.trim();
    try {
      const config = { forwardPorts, browserUrl: url };
      const res = await window.cowork.saveWorkspaceConfig({ sessionId, cwd, machine, config });
      if (res.ok) setStatus({ kind: "ok", text: "✓ saved" });
      else setStatus({ kind: "err", text: res.error ?? "save failed" });
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
    // Navigate the preview to the entered URL.
    if (url) {
      setCurrentUrl(url);
      try {
        await webviewRef.current?.loadURL(url);
      } catch {
        /* webview not ready / bad url — ignore */
      }
    }
  }

  const hasUrl = browserUrl.trim().length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <ConnectionBar machine={machine} />

      {/* Address + nav controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 32px",
          borderBottom: "1px solid var(--border)",
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
          value={browserUrl}
          onChange={(e) => setBrowserUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
          }}
          placeholder="http://localhost:5173"
          style={inputStyle}
        />
        <button
          className="glass-btn--clay"
          onClick={handleSave}
          disabled={saving}
          style={{ padding: "9px 16px", fontSize: 13, fontWeight: 600, opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "…" : "Go"}
        </button>
        <button
          style={navBtn}
          title="Open in real browser"
          onClick={() => {
            const url = currentUrl || browserUrl.trim();
            if (url) window.cowork.openExternal(url).catch(() => {/* ignore */});
          }}
        >
          ⧉
        </button>
        {status && (
          <span
            className="mono"
            style={{ fontSize: 11, color: status.kind === "ok" ? "rgb(var(--accent))" : "#e0736a" }}
          >
            {status.text}
          </span>
        )}
      </div>

      {/* Preview */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", background: "rgba(0,0,0,0.18)" }}>
        {hasUrl ? (
          <webview
            ref={webviewRef as unknown as React.Ref<HTMLElement>}
            src={browserUrl.trim()}
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
              Set a URL above to preview it here.
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
