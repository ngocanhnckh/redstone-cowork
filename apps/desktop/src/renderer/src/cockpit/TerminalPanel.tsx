import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import ConnectionBar from "./ConnectionBar";
import { playSfx } from "../sfx";

// xterm theme: a transparent background so the terminal sits on the glass panel (not a
// solid black box), with a vivid, cyan-forward neon ANSI palette so command output is
// colourful and hi-tech (paired with the scanline/grid frame + CRT glow in CSS below).
const THEME = {
  background: "rgba(0,0,0,0)",
  foreground: "#E8F4F2",
  cursor: "#54E6FF",
  cursorAccent: "#06121A",
  selectionBackground: "rgba(84,230,255,0.24)",
  black: "#12242A",
  brightBlack: "#5F7D84",
  red: "#FF6B6B",
  brightRed: "#FF8F8F",
  green: "#5EF2B0",
  brightGreen: "#8BFFCF",
  yellow: "#FFD166",
  brightYellow: "#FFE08A",
  blue: "#54B6FF",
  brightBlue: "#8FD0FF",
  magenta: "#C792FF",
  brightMagenta: "#DCB6FF",
  cyan: "#54E6FF",
  brightCyan: "#8FF2FF",
  white: "#DFEEF0",
  brightWhite: "#FFFFFF",
};

// The HUD frame + CRT glow for the terminal surface — grid, travelling scanline, corner
// brackets, a soft text glow. All decorative layers are pointer-events:none so the
// terminal stays fully interactive. Parked while the window is hidden (rcw-hidden).
const TERM_CSS = `
.rcw-term-wrap { position:relative; }
.rcw-term-grid { position:absolute; inset:0; z-index:1; pointer-events:none; opacity:.5;
  background-image: linear-gradient(rgb(var(--primary-soft) / 0.05) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--primary-soft) / 0.05) 1px, transparent 1px);
  background-size: 32px 32px;
  mask-image: radial-gradient(120% 100% at 50% 0%, #000 55%, transparent 100%);
  -webkit-mask-image: radial-gradient(120% 100% at 50% 0%, #000 55%, transparent 100%); }
.rcw-term-wrap .xterm { position:relative; z-index:2; }
.rcw-term-wrap .xterm .xterm-rows { text-shadow: 0 0 3px rgb(var(--primary-soft) / 0.28); }
/* Force a CLASSIC (space-reserving) scrollbar on the xterm viewport. On macOS the
   default overlay scrollbar has zero layout width, so xterm fits text to the full
   width and the scrollbar then draws ON TOP of the last column. Styling the webkit
   scrollbar with an explicit width makes Chromium reserve the gutter, so FitAddon
   leaves room and text never slides under the bar. */
.rcw-term-wrap .xterm-viewport { scrollbar-width: thin; scrollbar-color: rgb(var(--primary-soft) / 0.4) transparent; }
.rcw-term-wrap .xterm-viewport::-webkit-scrollbar { width: 11px; }
.rcw-term-wrap .xterm-viewport::-webkit-scrollbar-track { background: transparent; }
.rcw-term-wrap .xterm-viewport::-webkit-scrollbar-thumb {
  background: rgb(var(--primary-soft) / 0.4); border-radius: 6px; border: 3px solid transparent; background-clip: padding-box; }
.rcw-term-wrap .xterm-viewport::-webkit-scrollbar-thumb:hover { background: rgb(var(--primary-soft) / 0.6); background-clip: padding-box; }
.rcw-term-cnr { position:absolute; width:13px; height:13px; z-index:4; pointer-events:none; }
.rcw-term-cnr.tl { top:6px; left:8px; border-top:1.5px solid rgb(var(--primary-soft) / 0.55); border-left:1.5px solid rgb(var(--primary-soft) / 0.55); }
.rcw-term-cnr.tr { top:6px; right:8px; border-top:1.5px solid rgb(var(--primary-soft) / 0.55); border-right:1.5px solid rgb(var(--primary-soft) / 0.55); }
.rcw-term-cnr.bl { bottom:8px; left:8px; border-bottom:1.5px solid rgb(var(--primary-soft) / 0.55); border-left:1.5px solid rgb(var(--primary-soft) / 0.55); }
.rcw-term-cnr.br { bottom:8px; right:8px; border-bottom:1.5px solid rgb(var(--primary-soft) / 0.55); border-right:1.5px solid rgb(var(--primary-soft) / 0.55); }
`;

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
      scrollback: 2000,
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

    // NOTE: we deliberately use xterm's default (DOM) renderer here, NOT WebglAddon.
    // WebGL gave one GPU context PER terminal, and every session's terminal stays
    // mounted — past Chromium's ~16-context-per-process cap the GPU process thrashed
    // creating/evicting contexts and pegged a core at 100%, freezing the whole app.
    // A per-terminal GPU context is the wrong trade for a many-session cockpit. If we
    // want off-DOM rendering later, do it with the Canvas addon (2D context, no hard
    // cap) and/or only on the visible terminal.

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

    // Keyboard: Cmd+C / Ctrl+Shift+C copy the selection (plain Ctrl+C stays SIGINT).
    // NOTE: we deliberately do NOT handle paste here — xterm pastes natively via the
    // browser 'paste' event on its textarea, so handling Cmd+V ourselves too made it
    // paste TWICE. Native paste covers Cmd+V / Ctrl+Shift+V; the right-click menu
    // covers the explicit case.
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
      if (id === pty && !disposed) {
        term.write(data);
        if (data.includes("\n")) playSfx("output"); // hi-tech output cue on new line(s), rate-limited
      }
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
      <style>{TERM_CSS}</style>
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
      <div className="rcw-term-wrap" style={{ flex: 1, minHeight: 0, position: "relative", display: error ? "none" : "flex" }}>
        <span className="rcw-term-grid" />
        <span className="rcw-term-cnr tl" />
        <span className="rcw-term-cnr tr" />
        <span className="rcw-term-cnr bl" />
        <span className="rcw-term-cnr br" />
        <div
          ref={containerRef}
          style={{
            flex: 1,
            minHeight: 0,
            padding: "10px 16px 12px",
            // Glass instead of a flat black box; the transparent xterm bg lets a faint
            // cyan wash + the frame layers show through.
            background: "rgb(var(--primary) / 0.05)",
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
