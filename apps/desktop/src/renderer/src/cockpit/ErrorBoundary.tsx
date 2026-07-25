import { Component, type ReactNode } from "react";

/**
 * Contains render errors so one broken subtree can't blank a whole view. Two modes:
 *  - default: a small quiet fallback (used to isolate individual transcript messages).
 *  - `details`: shows the actual error message + stack in place, so a crash SURFACES to
 *    the user instead of the subtree silently vanishing (used around the New Session
 *    wizard, where a blank disappearance was impossible to diagnose).
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode; details?: boolean; label?: string },
  { failed: boolean; message: string; stack: string }
> {
  state = { failed: false, message: "", stack: "" };

  static getDerivedStateFromError(err: unknown): { failed: boolean; message: string; stack: string } {
    return {
      failed: true,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack ?? "" : "",
    };
  }

  componentDidCatch(err: unknown, info: unknown): void {
    // Surface it in the console (the Inspector) without breaking the UI.
    console.error("[rcw] render error contained by ErrorBoundary:", this.props.label ?? "", err, info);
  }

  render(): ReactNode {
    if (this.state.failed) {
      if (this.props.details) {
        return (
          <div style={{ padding: "14px 16px", border: "1px solid #e0736a", borderRadius: 12, background: "rgb(224 115 106 / .08)", color: "#ffd7d2", fontFamily: "var(--font-mono)", maxWidth: "100%" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>⚠ {this.props.label ?? "Something crashed"}</div>
            <div style={{ fontSize: 12, marginBottom: 8, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#ffb3ab" }}>{this.state.message || "unknown error"}</div>
            {this.state.stack && (
              <pre className="no-scrollbar" style={{ fontSize: 10, lineHeight: 1.5, maxHeight: 170, overflow: "auto", opacity: 0.72, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>{this.state.stack}</pre>
            )}
            <div style={{ fontSize: 10.5, marginTop: 8, opacity: 0.7 }}>Close and reopen to retry. If this keeps happening, screenshot this and send it over.</div>
          </div>
        );
      }
      return (
        this.props.fallback ?? (
          <span className="mono faint" style={{ fontSize: 11, fontStyle: "italic" }}>
            (couldn’t render this)
          </span>
        )
      );
    }
    return this.props.children;
  }
}
