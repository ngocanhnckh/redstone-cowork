import { useEffect, type CSSProperties } from "react";
import { useStore } from "../store";
import { startCockpit } from "../store";
import QueueRail from "./QueueRail";
import FocusStage from "./FocusStage";
import ContextColumn from "./ContextColumn";

export default function Cockpit() {
  const queue = useStore((s) => s.queue);

  useEffect(() => {
    const unsub = startCockpit();
    return unsub;
  }, []);

  return (
    <div
      data-app
      className="grain"
      style={{ height: "100vh", position: "relative", display: "flex", flexDirection: "column", overflow: "hidden" }}
    >
      <div className="atmosphere">
        <div className="blob blob--a" />
        <div className="blob blob--b" />
        <div className="blob blob--c" />
      </div>

      <div
        className="glass-surface"
        style={{
          position: "relative",
          zIndex: 2,
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Title bar — draggable; left padding clears the macOS traffic lights */}
        <div
          style={
            {
              height: 40,
              flexShrink: 0,
              paddingLeft: 84,
              paddingRight: 16,
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              gap: 14,
              WebkitAppRegion: "drag",
            } as CSSProperties
          }
        >
          <span
            className="mono"
            style={{
              fontSize: 11.5,
              letterSpacing: "0.12em",
              color: "var(--text-soft)",
              textTransform: "uppercase",
            }}
          >
            redstone cowork — flow
          </span>
        </div>

        {/* Main content */}
        {queue.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div
                className="display"
                style={{ fontSize: 32, color: "var(--text-soft)", marginBottom: 10 }}
              >
                All clear
              </div>
              <p className="soft" style={{ fontSize: 14, maxWidth: 360, lineHeight: 1.6 }}>
                All sessions are running — nothing needs your attention.
              </p>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "214px 1fr 314px",
              flex: 1,
              minHeight: 0,
            }}
          >
            <QueueRail />
            <FocusStage />
            <ContextColumn />
          </div>
        )}
      </div>
    </div>
  );
}
