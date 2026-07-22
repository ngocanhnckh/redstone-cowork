import { useEffect, type CSSProperties } from "react";
import TerminalPanel from "./cockpit/TerminalPanel";

export type TermArgs = { sessionId: string; cwd: string; machine: string; ptyId?: string; title?: string };

/** Parse the `#term=<encoded JSON>` hash a pop-out terminal window is opened with. */
export function parseTermHash(hash: string): TermArgs | null {
  if (!hash.startsWith("#term=")) return null;
  try {
    const a = JSON.parse(decodeURIComponent(hash.slice("#term=".length)));
    if (a && typeof a.cwd === "string" && typeof a.machine === "string") return a as TermArgs;
  } catch {
    /* malformed hash — fall through */
  }
  return null;
}

/**
 * Standalone terminal window (opened via window.cowork.openTerminalWindow). Renders a
 * single full-bleed TerminalPanel with its own PTY on the session's host — a real OS
 * window the user can move to another monitor. The theme (applied in main.tsx before
 * render) carries over, so it matches the cockpit (incl. the hi-tech theme).
 */
export default function TerminalWindow({ args }: { args: TermArgs }) {
  const label = args.title || `${args.machine} · terminal`;
  useEffect(() => { document.title = label; }, [label]);

  return (
    <div data-app className="grain" style={{ height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="glass-surface" style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* Draggable title strip (clears the macOS traffic lights) so the window moves. */}
        <div
          style={{
            height: 34, flexShrink: 0, paddingLeft: 78, paddingRight: 12,
            display: "flex", alignItems: "center", gap: 8,
            borderBottom: "1px solid var(--border)", WebkitAppRegion: "drag",
          } as CSSProperties}
        >
          <span style={{ fontSize: 12 }}>🖥️</span>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {label}
          </span>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <TerminalPanel sessionId={args.sessionId} cwd={args.cwd} machine={args.machine} ptyId={args.ptyId} />
        </div>
      </div>
    </div>
  );
}
