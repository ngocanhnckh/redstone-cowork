import type { ReactNode } from "react";

/** A faint monospace keyboard-hint badge. Only render this next to a shortcut that is actually wired. */
export default function Kbd({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        lineHeight: 1,
        color: "var(--text-faint)",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid var(--border)",
        borderRadius: 5,
        padding: "2px 5px",
      }}
    >
      {children}
    </span>
  );
}
