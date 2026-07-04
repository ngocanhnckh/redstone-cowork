import { useEffect, type CSSProperties } from "react";
import { useStore } from "../store";
import { startCockpit } from "../store";
import QueueRail from "./QueueRail";
import FocusStage from "./FocusStage";
import ContextColumn from "./ContextColumn";
import AgentGrid from "./AgentGrid";
import AllSessions from "./AllSessions";
import Hud from "./Hud";
import AssistPanel from "./AssistPanel";
import SettingsPanel from "./SettingsPanel";
import CapsModal from "./CapsModal";
import { useAppearance } from "../appearance";

const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;

export default function Cockpit() {
  const queue = useStore((s) => s.queue);
  const sessions = useStore((s) => s.sessions);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const detailId = useStore((s) => s.detailId);
  const closeDetail = useStore((s) => s.closeDetail);
  const focusId = useStore((s) => s.focusId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const activeTabMap = useStore((s) => s.activeTab);
  const contextCollapsed = useStore((s) => s.contextCollapsed);
  const toggleContext = useStore((s) => s.toggleContext);
  const toggleAssist = useStore((s) => s.toggleAssist);
  const toggleSettings = useStore((s) => s.toggleSettings);
  const toggleCaps = useStore((s) => s.toggleCaps);

  const appr = useAppearance();

  useEffect(() => {
    const unsub = startCockpit();
    return unsub;
  }, []);

  // "Transparent app in HUD mode": strip the app-shell glass only while the HUD is
  // the active mode, so the desktop shows straight through behind the widgets.
  useEffect(() => {
    const on = mode === "hud" && appr.hudClear;
    document.documentElement.classList.toggle("rcw-hud-clear", on);
    return () => document.documentElement.classList.remove("rcw-hud-clear");
  }, [mode, appr.hudClear]);

  // Workspace-tab shortcuts: Ctrl+1/2/3/4 jump, Ctrl+Tab / Ctrl+Shift+Tab cycle.
  useEffect(() => {
    const ORDER = ["chat", "terminal", "browser", "ports", "files"] as const;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey) return;
      const id = detailId ?? focusId;
      if (!id) return;

      if (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4" || e.key === "5") {
        e.preventDefault();
        setActiveTab(id, ORDER[Number(e.key) - 1]);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const cur = activeTabMap[id] ?? "chat";
        const idx = ORDER.indexOf(cur);
        const next = e.shiftKey
          ? ORDER[(idx - 1 + ORDER.length) % ORDER.length]
          : ORDER[(idx + 1) % ORDER.length];
        setActiveTab(id, next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailId, focusId, activeTabMap, setActiveTab]);

  // ⌃J toggles the LLM assistant slide-over.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        toggleAssist();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleAssist]);

  const seg = (m: "flow" | "grid" | "history" | "hud", label: string) => (
    <button
      onClick={() => setMode(m)}
      style={{
        ...noDrag,
        padding: "4px 12px",
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 500,
        cursor: "pointer",
        border: 0,
        background: mode === m ? "rgb(var(--primary) / 0.32)" : "transparent",
        color: mode === m ? "#fff" : "var(--text-soft)",
      }}
    >
      {label}
    </button>
  );

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
            redstone cowork
          </span>
          <div style={{ flex: 1 }} />
          {/* Connection settings */}
          <button
            onClick={toggleSettings}
            title="Connection settings — server & sign-in"
            style={{
              ...noDrag,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-soft)",
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: 11.5,
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
            }}
          >
            ⚙ server
          </button>
          {/* LLM assistant */}
          <button
            onClick={toggleAssist}
            title="Assistant — chat, optimize, summarize (⌃J)"
            style={{
              ...noDrag,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-soft)",
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: 11.5,
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span className="ai-core" style={{ width: 11, height: 11 }} /> assist
          </button>
          {/* Skills & commands browser */}
          <button
            onClick={toggleCaps}
            title="Installed skills & slash commands"
            style={{
              ...noDrag,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-soft)",
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: 11.5,
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
            }}
          >
            ⌘ skills
          </button>
          {/* Collapse / expand the right details sidebar */}
          <button
            onClick={toggleContext}
            title={contextCollapsed ? "Show details panel" : "Hide details panel"}
            style={{
              ...noDrag,
              border: "1px solid var(--border)",
              background: contextCollapsed ? "transparent" : "rgb(var(--primary) / 0.18)",
              color: "var(--text-soft)",
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: 11.5,
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
            }}
          >
            {contextCollapsed ? "◧ details" : "▦ details"}
          </button>
          {/* Flow / Grid toggle */}
          <div
            style={{ ...noDrag, display: "flex", gap: 3, padding: 3, borderRadius: 999, border: "1px solid var(--border)" }}
          >
            {seg("flow", `Flow${queue.length ? ` · ${queue.length}` : ""}`)}
            {seg("grid", `Grid${sessions.length ? ` · ${sessions.length}` : ""}`)}
            {seg("history", "All Sessions")}
            {seg("hud", "HUD")}
          </div>
        </div>

        {/* Main content */}
        {mode === "hud" ? (
          <Hud />
        ) : mode === "history" ? (
          <AllSessions />
        ) : mode === "grid" ? (
          detailId ? (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <button
                onClick={closeDetail}
                className="glass-inset-hover"
                style={{
                  ...noDrag,
                  alignSelf: "flex-start",
                  margin: "12px 0 0 16px",
                  padding: "6px 13px",
                  borderRadius: 999,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text-soft)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                ← All agents
              </button>
              <div style={{ display: "grid", gridTemplateColumns: contextCollapsed ? "1fr" : "1fr 314px", flex: 1, minHeight: 0 }}>
                <FocusStage sessionId={detailId} />
                {!contextCollapsed && <ContextColumn sessionId={detailId} />}
              </div>
            </div>
          ) : (
            <AgentGrid />
          )
        ) : queue.length === 0 ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ textAlign: "center" }}>
              <div className="display" style={{ fontSize: 32, color: "var(--text-soft)", marginBottom: 10 }}>
                All clear
              </div>
              <p className="soft" style={{ fontSize: 14, maxWidth: 360, lineHeight: 1.6, marginBottom: 18 }}>
                Nothing needs your attention right now
                {sessions.length ? ` — ${sessions.length} agent${sessions.length > 1 ? "s" : ""} connected.` : "."}
              </p>
              <button
                onClick={() => setMode("grid")}
                className="glass-btn--clay"
                style={{ padding: "9px 18px", fontSize: 13, fontWeight: 600 }}
              >
                View all agents →
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: contextCollapsed ? "214px 1fr" : "214px 1fr 314px", flex: 1, minHeight: 0 }}>
            <QueueRail />
            <FocusStage />
            {!contextCollapsed && <ContextColumn />}
          </div>
        )}
      </div>

      <AssistPanel />
      <SettingsPanel />
      <CapsModal />
    </div>
  );
}
