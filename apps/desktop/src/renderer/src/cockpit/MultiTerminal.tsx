import { useRef, useState } from "react";
import TerminalPanel from "./TerminalPanel";
import { useStore } from "../store";

/**
 * A tabbed set of terminals for one session — like an IDE's terminal panel. Each
 * tab is its own PTY (keyed `<sessionId>::term::<n>`), all kept mounted and
 * toggled with `display` so switching tabs never kills a running shell. Closing a
 * tab kills its PTY.
 */
export default function MultiTerminal({ sessionId, cwd, machine, idPrefix }: { sessionId: string; cwd: string; machine: string; idPrefix?: string }) {
  const seq = useRef(1);
  const [tabs, setTabs] = useState<number[]>([1]);
  const [active, setActive] = useState(1);
  // Per-tab remount counter so "restart" re-spawns a fresh shell.
  const [restart, setRestart] = useState<Record<number, number>>({});

  // PTY namespace — idPrefix keeps a second MultiTerminal (an extra HUD terminal
  // window) from colliding with the main one on the same session's pty ids.
  const ptyId = (n: number) => `${idPrefix ?? sessionId}::term::${n}`;

  const addTab = () => {
    const n = ++seq.current;
    setTabs((t) => [...t, n]);
    setActive(n);
  };
  const closeTab = (n: number) => {
    window.cowork.killTerminal(ptyId(n)).catch(() => {});
    setTabs((t) => {
      const next = t.filter((x) => x !== n);
      if (next.length === 0) { const m = ++seq.current; setActive(m); return [m]; }
      if (active === n) setActive(next[next.length - 1]);
      return next;
    });
  };
  const restartTab = (n: number) => {
    window.cowork.killTerminal(ptyId(n)).catch(() => {});
    setRestart((r) => ({ ...r, [n]: (r[n] ?? 0) + 1 }));
  };

  const tabBtn: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px", borderRadius: 7,
    fontFamily: "var(--font-mono)", fontSize: 11, cursor: "pointer", border: "1px solid transparent",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* tab bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 10px", borderBottom: "1px solid var(--border)", flexShrink: 0, overflowX: "auto" }} className="no-scrollbar">
        {tabs.map((n, i) => {
          const on = n === active;
          return (
            <span key={n} onClick={() => setActive(n)}
              style={{ ...tabBtn, background: on ? "rgb(var(--primary) / 0.22)" : "transparent", color: on ? "var(--text)" : "var(--text-soft)", borderColor: on ? "rgb(var(--primary-soft) / 0.4)" : "transparent" }}>
              <span style={{ width: 5, height: 5, borderRadius: 999, background: on ? "rgb(var(--accent))" : "var(--border-strong)" }} />
              term {i + 1}
              {tabs.length > 1 && (
                <span onClick={(e) => { e.stopPropagation(); closeTab(n); }} title="Close terminal" style={{ opacity: 0.55, fontSize: 12, lineHeight: 1 }}>✕</span>
              )}
            </span>
          );
        })}
        <button onClick={addTab} title="New terminal tab" style={{ ...tabBtn, background: "transparent", color: "var(--text-soft)", border: "1px dashed var(--border-strong)" }}>+ tab</button>
        <button
          onClick={() => useStore.getState().requestTermWindow()}
          title="Open another terminal as its own HUD window (like Docker's New window)"
          style={{ ...tabBtn, background: "transparent", color: "var(--text-soft)", border: "1px solid var(--border)" }}
        >
          ⤢ window
        </button>
        <span style={{ flex: 1 }} />
        <button onClick={() => restartTab(active)} title="Restart this shell" style={{ ...tabBtn, background: "transparent", color: "var(--text-soft)", border: "1px solid var(--border)" }}>⟳ restart</button>
      </div>
      {/* keep-alive terminal stack */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {tabs.map((n) => (
          <div key={n} style={{ position: "absolute", inset: 0, display: n === active ? "flex" : "none", flexDirection: "column" }}>
            <TerminalPanel sessionId={sessionId} cwd={cwd} machine={machine} ptyId={ptyId(n)} hideChrome key={`${n}-${restart[n] ?? 0}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
