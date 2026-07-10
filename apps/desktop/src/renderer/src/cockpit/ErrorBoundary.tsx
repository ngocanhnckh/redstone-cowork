import { Component, type ReactNode } from "react";

/**
 * Contains render errors so one broken subtree can't blank a whole view. Used to
 * isolate individual transcript messages: a single message whose Markdown throws
 * shows a small fallback instead of taking the entire chat down with it.
 */
export default class ErrorBoundary extends Component<
  { children: ReactNode; fallback?: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(err: unknown): void {
    // Surface it in the console (the Inspector) without breaking the UI.
    console.error("[rcw] render error contained by ErrorBoundary:", err);
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        this.props.fallback ?? (
          <span className="mono faint" style={{ fontSize: 11, fontStyle: "italic" }}>
            (couldn’t render this message)
          </span>
        )
      );
    }
    return this.props.children;
  }
}
