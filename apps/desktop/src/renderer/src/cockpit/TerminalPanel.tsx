import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import ConnectionBar from "./ConnectionBar";

// xterm theme tuned to the liquid-glass tokens (warm ink bg, bone foreground).
const THEME = {
  background: "#15110D",
  foreground: "#F0ECE1",
  cursor: "#F0ECE1",
  cursorAccent: "#15110D",
  selectionBackground: "rgba(240,236,225,0.18)",
  black: "#15110D",
  brightBlack: "#6B6052",
};

export default function TerminalPanel({
  sessionId,
  cwd,
  machine,
}: {
  sessionId: string;
  cwd: string;
  machine: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumping this re-runs the effect to (re)spawn the shell.
  const [restartKey, setRestartKey] = useState(0);

  async function restart() {
    setError(null);
    try {
      await window.cowork.killTerminal(sessionId);
    } catch {
      /* ignore */
    }
    setRestartKey((k) => k + 1);
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !sessionId) return;

    let disposed = false;
    const cleanups: Array<() => void> = [];

    const term = new Terminal({
      fontFamily:
        "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12.5,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      theme: THEME,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    const safeFit = () => {
      try {
        fit.fit();
      } catch {
        // container not measurable yet — ignore
      }
    };
    safeFit();

    // Pipe user keystrokes → main.
    const dataSub = term.onData((data) => {
      window.cowork.sendTerminalInput({ id: sessionId, data });
    });
    cleanups.push(() => dataSub.dispose());

    // Receive bytes from the pty (filtered by our id).
    const offData = window.cowork.onTerminalData(({ id, data }) => {
      if (id === sessionId && !disposed) term.write(data);
    });
    cleanups.push(offData);

    const offExit = window.cowork.onTerminalExit(({ id }) => {
      if (id === sessionId && !disposed) {
        term.write("\r\n\x1b[2m[session ended]\x1b[0m\r\n");
      }
    });
    cleanups.push(offExit);

    // Spawn (or re-attach to) the pty, then replay scrollback.
    window.cowork
      .startTerminal({
        id: sessionId,
        cwd,
        machine,
        cols: term.cols,
        rows: term.rows,
      })
      .then((res) => {
        if (disposed) return;
        if (res.ok) {
          if (res.replay) term.write(res.replay);
          term.focus();
        } else {
          setError(res.error || "Failed to start terminal");
        }
      })
      .catch((e: unknown) => {
        if (!disposed) setError(e instanceof Error ? e.message : String(e));
      });

    // Keep the pty sized to the container.
    const pushResize = () => {
      safeFit();
      window.cowork.resizeTerminal({ id: sessionId, cols: term.cols, rows: term.rows });
    };
    const ro = new ResizeObserver(() => pushResize());
    ro.observe(container);
    window.addEventListener("resize", pushResize);

    return () => {
      disposed = true;
      ro.disconnect();
      window.removeEventListener("resize", pushResize);
      for (const off of cleanups) {
        try {
          off();
        } catch {
          // ignore
        }
      }
      // Dispose xterm but DO NOT kill the pty — it persists across tab switches.
      term.dispose();
    };
  }, [sessionId, cwd, machine, restartKey]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <ConnectionBar machine={machine} onHostChange={() => restart()} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 8,
          padding: "6px 32px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <button
          onClick={() => restart()}
          title="Restart the shell"
          style={{
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-soft)",
            borderRadius: 7,
            padding: "3px 11px",
            fontSize: 10.5,
            fontFamily: "var(--font-mono)",
            cursor: "pointer",
          }}
        >
          ⟳ restart
        </button>
      </div>
      {error ? (
        <div style={{ flex: 1, padding: "18px 32px", overflowY: "auto" }} className="no-scrollbar">
          <div
            className="mono faint"
            style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap" }}
          >
            {error}
          </div>
        </div>
      ) : null}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          minHeight: 0,
          padding: "10px 16px 12px",
          background: "var(--app-bg)",
          overflow: "hidden",
          display: error ? "none" : "block",
        }}
      />
    </div>
  );
}
