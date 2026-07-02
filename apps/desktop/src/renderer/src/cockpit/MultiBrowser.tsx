import { useRef, useState } from "react";
import BrowserPanel from "./BrowserPanel";

/**
 * A tabbed set of browser previews for one session — like Chrome tabs. Each tab is
 * its own <webview>, all kept mounted and toggled with `display` so switching tabs
 * never reloads a page. Tab 0 is the session's primary preview (persists the saved
 * URL/port config); extra tabs are ephemeral (navigate freely, don't overwrite it).
 */
export default function MultiBrowser({ sessionId, cwd, machine }: { sessionId: string; cwd: string; machine: string }) {
  const seq = useRef(0);
  const [tabs, setTabs] = useState<number[]>([0]);
  const [active, setActive] = useState(0);

  const addTab = () => { const n = ++seq.current; setTabs((t) => [...t, n]); setActive(n); };
  const closeTab = (n: number) => {
    setTabs((t) => {
      const next = t.filter((x) => x !== n);
      if (active === n) setActive(next[next.length - 1] ?? 0);
      return next.length ? next : [0];
    });
  };

  const tabBtn: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 7,
    fontFamily: "var(--font-mono)", fontSize: 11, cursor: "pointer", border: "1px solid transparent",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div className="no-scrollbar" style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderBottom: "1px solid var(--border)", flexShrink: 0, overflowX: "auto" }}>
        {tabs.map((n, i) => {
          const on = n === active;
          return (
            <span key={n} onClick={() => setActive(n)}
              style={{ ...tabBtn, background: on ? "rgb(var(--primary) / 0.22)" : "transparent", color: on ? "var(--text)" : "var(--text-soft)", borderColor: on ? "rgb(var(--primary-soft) / 0.4)" : "transparent" }}>
              <span style={{ width: 5, height: 5, borderRadius: 999, background: on ? "rgb(var(--accent))" : "var(--border-strong)" }} />
              {i === 0 ? "preview" : `tab ${i + 1}`}
              {tabs.length > 1 && (
                <span onClick={(e) => { e.stopPropagation(); closeTab(n); }} title="Close tab" style={{ opacity: 0.55, fontSize: 12, lineHeight: 1 }}>✕</span>
              )}
            </span>
          );
        })}
        <button onClick={addTab} title="New browser tab" style={{ ...tabBtn, background: "transparent", color: "var(--text-soft)", border: "1px dashed var(--border-strong)" }}>+ new</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {tabs.map((n) => (
          <div key={n} style={{ position: "absolute", inset: 0, display: n === active ? "flex" : "none", flexDirection: "column" }}>
            <BrowserPanel sessionId={sessionId} cwd={cwd} machine={machine} ephemeral={n !== 0} />
          </div>
        ))}
      </div>
    </div>
  );
}
