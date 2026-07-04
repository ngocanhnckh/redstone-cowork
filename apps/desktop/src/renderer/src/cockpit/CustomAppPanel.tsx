import { useEffect, useRef } from "react";

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
};

/** The webview partition for an app: its own persistent profile, or the shared one. */
export function appPartition(app: CustomApp): string {
  return app.sessionProfile ? `persist:app-${app.id}` : "persist:rcw-web";
}

const navBtn: React.CSSProperties = {
  border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)",
  borderRadius: 8, padding: "4px 9px", fontSize: 13, fontFamily: "var(--font-mono)", cursor: "pointer", lineHeight: 1,
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

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}>
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
      <div style={{ flex: 1, minHeight: 0, position: "relative", background: "rgba(0,0,0,0.18)" }}>
        <webview
          ref={ref as unknown as React.Ref<HTMLElement>}
          src={app.url}
          partition={appPartition(app)}
          allowpopups
          style={{ width: "100%", height: "100%", border: 0 }}
        />
      </div>
    </div>
  );
}
