import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import ConnectionBar from "./ConnectionBar";

// xterm theme tuned to the liquid-glass tokens: a transparent background so the
// terminal sits on the warm-ink glass panel (not a solid black box), with a warm
// ANSI palette (amber accent / sage green) instead of the harsh defaults.
const THEME = {
  background: "rgba(0,0,0,0)",
  foreground: "#F0ECE1",
  cursor: "#E4A672",
  cursorAccent: "#15110D",
  selectionBackground: "rgba(228,166,114,0.24)",
  black: "#2A2118",
  brightBlack: "#6B6052",
  red: "#E0736A",
  brightRed: "#EE8A80",
  green: "#9DBFA8",
  brightGreen: "#B4D3BD",
  yellow: "#D8A76A",
  brightYellow: "#E4A672",
  blue: "#8FB0C8",
  brightBlue: "#A9C6DA",
  magenta: "#C8A0C0",
  brightMagenta: "#D8B4D0",
  cyan: "#8FC4C0",
  brightCyan: "#A9D4D0",
  white: "#E8E0D2",
  brightWhite: "#FBF7EE",
};

export default function TerminalPanel({
  sessionId,
  cwd,
  machine,
  ptyId,
  hideChrome,
}: {
  sessionId: string;
  cwd: string;
  machine: string;
  /** PTY key — distinct per terminal so a session can have several. Defaults to sessionId. */
  ptyId?: string;
  /** Hide the ConnectionBar + restart toolbar (a MultiTerminal provides its own chrome). */
  hideChrome?: boolean;
}) {
  const pty = ptyId ?? sessionId;
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumping this re-runs the effect to (re)spawn the shell.
  const [restartKey, setRestartKey] = useState(0);
  // Right-click menu (Copy/Paste) position + the term ref its actions operate on.
  const termRef = useRef<Terminal | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; hasSel: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const doCopy = () => {
    const sel = termRef.current?.getSelection() ?? "";
    if (sel) { window.cowork.copyText(sel).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 900); }
    setMenu(null);
  };
  const doPaste = async () => {
    setMenu(null);
    try {
      const text = await window.cowork.readClipboard();
      if (text) window.cowork.sendTerminalInput({ id: pty, data: text });
    } catch { /* ignore */ }
    termRef.current?.focus();
  };

  async function restart() {
    setError(null);
    try {
      await window.cowork.killTerminal(pty);
    } catch {
      /* ignore */
    }
    setRestartKey((k) => k + 1);
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pty) return;

    let disposed = false;
    const cleanups: Array<() => void> = [];

    const term = new Terminal({
      fontFamily:
        "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12.5,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      allowTransparency: true, // let the warm-ink panel show through the terminal bg
      theme: THEME,
      scrollback: 5000,
      // Let ⌥(Option)+drag force a LOCAL selection even when the app (tmux with mouse
      // mode on) is capturing the mouse — on macOS xterm ignores Shift for this, so
      // without this option you simply can't select over tmux mouse mode. On non-Mac,
      // Shift+drag already works. Selecting copies on mouseup (see below).
      macOptionClickForcesSelection: true,
      rightClickSelectsWord: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;

    // --- OSC 52 clipboard ---------------------------------------------------
    // THE reliable way to copy out of tmux: in copy-mode (aka "cursor mode") you
    // select + yank, and tmux (with `set-clipboard on`) emits an OSC 52 escape
    // sequence carrying the text through the terminal. xterm doesn't handle OSC 52
    // by default, so the yank went nowhere — this routes it to the LOCAL clipboard.
    // Works regardless of mouse mode / redraws, because it's the app telling us what
    // to copy rather than us scraping a screen selection.
    const flashCopied = () => { setCopied(true); setTimeout(() => setCopied(false), 900); };
    term.parser.registerOscHandler(52, (data: string) => {
      const semi = data.indexOf(";");
      const payload = semi >= 0 ? data.slice(semi + 1) : data; // "c;<base64>" → <base64>
      if (!payload || payload === "?") return true; // clipboard READ request — ignore
      try {
        const bin = atob(payload);
        const text = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
        if (text) { window.cowork.copyText(text).catch(() => {}); flashCopied(); }
      } catch { /* malformed base64 — ignore */ }
      return true;
    });

    // --- Copy / paste -------------------------------------------------------
    // Inside tmux the drag-selection is fragile: tmux mouse mode eats the drag and
    // frequent redraws wipe the visual selection. So COPY THE MOMENT a selection is
    // made (mouseup) — we grab term.getSelection() before a redraw can clear it. To
    // select OVER tmux mouse mode: hold ⌥Option (macOptionClickForcesSelection above)
    // on macOS, or Shift on Windows/Linux, while dragging. Plain drag works when tmux
    // mouse mode is off.
    const onMouseUp = () => {
      const sel = term.getSelection();
      if (sel && sel.trim()) { window.cowork.copyText(sel).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 900); }
    };
    container.addEventListener("mouseup", onMouseUp);
    cleanups.push(() => container.removeEventListener("mouseup", onMouseUp));

    // Keyboard: Cmd+C / Ctrl+Shift+C copy the selection (plain Ctrl+C stays SIGINT);
    // Cmd+V / Ctrl+Shift+V paste. Returning false stops xterm forwarding the key.
    const isMac = /Mac/i.test(navigator.platform);
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const primary = isMac ? e.metaKey : e.ctrlKey;
      const k = e.key.toLowerCase();
      if (primary && k === "c") {
        const sel = term.getSelection();
        if (sel && (isMac || e.shiftKey)) { window.cowork.copyText(sel).catch(() => {}); return false; }
        return true; // no selection, or plain Ctrl+C → let it through as interrupt
      }
      if (primary && k === "v" && (isMac || e.shiftKey)) {
        window.cowork.readClipboard().then((t) => { if (t) window.cowork.sendTerminalInput({ id: pty, data: t }); }).catch(() => {});
        return false;
      }
      return true;
    });

    // Right-click → Copy/Paste menu.
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY, hasSel: !!term.getSelection() });
    };
    container.addEventListener("contextmenu", onCtx);
    cleanups.push(() => container.removeEventListener("contextmenu", onCtx));

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
      window.cowork.sendTerminalInput({ id: pty, data });
    });
    cleanups.push(() => dataSub.dispose());

    // Receive bytes from the pty (filtered by our id).
    const offData = window.cowork.onTerminalData(({ id, data }) => {
      if (id === pty && !disposed) term.write(data);
    });
    cleanups.push(offData);

    const offExit = window.cowork.onTerminalExit(({ id }) => {
      if (id === pty && !disposed) {
        term.write("\r\n\x1b[2m[session ended]\x1b[0m\r\n");
      }
    });
    cleanups.push(offExit);

    // Spawn (or re-attach to) the pty, then replay scrollback.
    window.cowork
      .startTerminal({
        id: pty,
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
      window.cowork.resizeTerminal({ id: pty, cols: term.cols, rows: term.rows });
    };
    const ro = new ResizeObserver(() => pushResize());
    ro.observe(container);
    window.addEventListener("resize", pushResize);
    // A fit right after mount/layout settles avoids the last row being clipped.
    const settle = setTimeout(pushResize, 60);
    cleanups.push(() => clearTimeout(settle));

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
      if (termRef.current === term) termRef.current = null;
      term.dispose();
    };
  }, [pty, cwd, machine, restartKey]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {!hideChrome && <ConnectionBar sessionId={sessionId} machine={machine} onHostChange={() => restart()} />}
      {!hideChrome && (
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
      )}
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
      <div style={{ flex: 1, minHeight: 0, position: "relative", display: error ? "none" : "flex" }}>
        <div
          ref={containerRef}
          style={{
            flex: 1,
            minHeight: 0,
            padding: "10px 16px 12px",
            // Warm-ink glass instead of a flat black box; the transparent xterm bg
            // lets this show through.
            background: "rgb(var(--primary) / 0.04)",
            overflow: "hidden",
          }}
        />
        {copied && (
          <div className="mono" style={{ position: "absolute", top: 8, right: 12, fontSize: 10.5, color: "rgb(var(--accent))", background: "color-mix(in srgb, var(--app-panel) 88%, transparent)", border: "1px solid var(--border)", borderRadius: 6, padding: "2px 8px", pointerEvents: "none" }}>✓ copied</div>
        )}
        {menu && (
          <>
            <div onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
            <div
              className="glass-menu"
              style={{ position: "fixed", top: menu.y, left: menu.x, zIndex: 61, minWidth: 130, borderRadius: 9, border: "1px solid var(--border-strong)", boxShadow: "0 12px 34px rgba(0,0,0,0.5)", padding: 4 }}
            >
              <button onClick={doCopy} disabled={!menu.hasSel} className="glass-inset-hover" style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "1px solid transparent", borderRadius: 6, padding: "6px 10px", fontSize: 12.5, color: menu.hasSel ? "var(--text)" : "var(--text-faint)", cursor: menu.hasSel ? "pointer" : "default" }}>Copy</button>
              <button onClick={doPaste} className="glass-inset-hover" style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "1px solid transparent", borderRadius: 6, padding: "6px 10px", fontSize: 12.5, color: "var(--text)", cursor: "pointer" }}>Paste</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
