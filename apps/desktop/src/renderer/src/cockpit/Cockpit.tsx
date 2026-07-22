import ScreenSharePicker from "./ScreenSharePicker";
import { useEffect, useState, type CSSProperties } from "react";
import { useStore } from "../store";
import { startCockpit } from "../store";
import QueueRail from "./QueueRail";
import FocusStage from "./FocusStage";
import ContextColumn from "./ContextColumn";
import AgentGrid from "./AgentGrid";
import AllSessions from "./AllSessions";
import Hud from "./Hud";
import BootScreen from "./BootScreen";
import { useKeybindings } from "./useKeybindings";
import SessionSwitcher from "./SessionSwitcher";
import AssistPanel from "./AssistPanel";
import SettingsPanel from "./SettingsPanel";
import CapsModal from "./CapsModal";
import { useAppearance } from "../appearance";

const noDrag = { WebkitAppRegion: "no-drag" } as CSSProperties;

export default function Cockpit() {
  const queue = useStore((s) => s.queue);
  const sessions = useStore((s) => s.sessions);
  const hasLoaded = useStore((s) => s.hasLoaded);
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const detailId = useStore((s) => s.detailId);
  const closeDetail = useStore((s) => s.closeDetail);
  const focusId = useStore((s) => s.focusId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const openUrlInBrowser = useStore((s) => s.openUrlInBrowser);
  const contextCollapsed = useStore((s) => s.contextCollapsed);
  const toggleContext = useStore((s) => s.toggleContext);
  const toggleAssist = useStore((s) => s.toggleAssist);
  const toggleSettings = useStore((s) => s.toggleSettings);
  const toggleCaps = useStore((s) => s.toggleCaps);
  const offline = useStore((s) => s.offline);
  const exitOffline = useStore((s) => s.exitOffline);

  const appr = useAppearance();

  // Quick "keep-wallpaper" fullscreen toggle (mirrors Settings › Appearance).
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => { window.cowork.getFullscreenState().then((s) => setFullscreen(s.fullscreen)).catch(() => {}); }, []);
  const toggleFullscreen = async () => {
    try {
      const r = await window.cowork.setSimpleFullscreen(!fullscreen);
      setFullscreen(r.fullscreen);
      // Let auto-layout re-tile for the (now full-screen) display size.
      window.dispatchEvent(new CustomEvent("rcw-fullscreen", { detail: { on: r.fullscreen } }));
    } catch { /* ignore */ }
  };

  useEffect(() => {
    const unsub = startCockpit();
    return unsub;
  }, []);

  // Open a URL in the focused session's in-app workspace browser as a NEW TAB. The
  // main process routes here for: target=_blank / window.open, custom-app cross-
  // domain links, and the git widget's GitHub link. This lives in Cockpit (mounted
  // in EVERY mode) so "open in a new tab" works in Flow/Grid too — not only HUD.
  // In Flow mode we also switch to the Browser tab so the new tab is visible; HUD
  // reveals its own browser window via its internal reveal effect.
  useEffect(() => {
    const off = window.cowork.onOpenInWorkspaceBrowser((a) => {
      const st = useStore.getState();
      const sid = st.focusId;
      if (a?.url && sid) {
        openUrlInBrowser(sid, a.url);
        if (st.mode !== "hud") setActiveTab(sid, "browser");
      } else if (a?.url) {
        window.cowork.openExternal(a.url).catch(() => {});
      }
    });
    return off;
  }, [openUrlInBrowser, setActiveTab]);

  // ⌃⌘F (F11 elsewhere) toggles keep-wallpaper fullscreen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = (e.ctrlKey && e.metaKey && (e.key === "f" || e.key === "F")) || e.key === "F11";
      if (combo) { e.preventDefault(); toggleFullscreen(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen]);

  // "Transparent app in HUD mode": drop the window vibrancy so the RAW desktop
  // shows through the center/gaps, and strip the shell glass + decoration. The
  // widgets keep their own frosted glass background (via CSS .rcw-hud-clear) so
  // widget text stays readable.
  useEffect(() => {
    const clear = mode === "hud" && appr.hudClear;
    document.documentElement.classList.toggle("rcw-hud-clear", clear);
    window.cowork.setVibrancy(!clear).catch(() => {});
    return () => document.documentElement.classList.remove("rcw-hud-clear");
  }, [mode, appr.hudClear]);

  // All in-app shortcuts (session cycle, assistant toggle, virtual-app tabs) are
  // handled by the customizable keybindings dispatcher — rebindable in Settings.
  useKeybindings();

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
      <ScreenSharePicker />
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
          className="hud-chrome"
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
          {offline && (
            <span
              style={{
                ...noDrag,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontFamily: "var(--font-mono)",
                fontSize: 10.5,
                letterSpacing: "0.1em",
                color: "rgb(var(--accent))",
                border: "1px solid var(--border)",
                borderRadius: 999,
                padding: "2px 8px",
              }}
              title="Direct SSH — no cowork server"
            >
              ● OFFLINE
              <button
                onClick={exitOffline}
                title="Exit offline mode"
                style={{
                  ...noDrag,
                  border: 0,
                  background: "transparent",
                  color: "var(--text-soft)",
                  cursor: "pointer",
                  fontSize: 10.5,
                  fontFamily: "var(--font-mono)",
                  padding: 0,
                }}
              >
                Exit
              </button>
            </span>
          )}
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
          {/* Fullscreen quick toggle (keeps wallpaper visible) */}
          <button
            onClick={toggleFullscreen}
            title={fullscreen ? "Exit fullscreen (⌃⌘F)" : "Fullscreen — keeps wallpaper (⌃⌘F)"}
            style={{
              ...noDrag,
              border: "1px solid var(--border)",
              background: fullscreen ? "rgb(var(--primary) / 0.18)" : "transparent",
              color: "var(--text-soft)",
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: 13,
              lineHeight: 1,
              cursor: "pointer",
            }}
          >
            {fullscreen ? "🡼" : "⛶"}
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

        {/* Main content — until the first successful fetch, show the boot/connection
            screen (which surfaces a real error instead of a misleading "All clear"). */}
        {!hasLoaded ? (
          <BootScreen />
        ) : mode === "hud" ? (
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
      <SessionSwitcher />
    </div>
  );
}
