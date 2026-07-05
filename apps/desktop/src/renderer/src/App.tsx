import { useState, useEffect, useCallback } from "react";
import Login from "./Login";
import Cockpit from "./cockpit/Cockpit";
import BgVideo from "./cockpit/BgVideo";

type ConfigState = { serverUrl: string; hasToken: boolean } | null | "loading";

export default function App() {
  const [configState, setConfigState] = useState<ConfigState>("loading");

  const recheck = useCallback(async () => {
    const cfg = await window.cowork.getConfig();
    setConfigState(cfg ?? null);
  }, []);

  useEffect(() => {
    recheck();
  }, [recheck]);

  let content: React.ReactNode;
  if (configState === "loading") {
    content = (
      <div data-app className="grain" style={{ minHeight: "100vh" }}>
        <div className="atmosphere">
          <div className="blob blob--a" />
          <div className="blob blob--b" />
          <div className="blob blob--c" />
        </div>
        <div
          style={{
            position: "relative",
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
          }}
        >
          <div
            className="glass-surface"
            style={{ padding: "32px 48px", borderRadius: 14, textAlign: "center" }}
          >
            <span className="soft">Loading…</span>
          </div>
        </div>
      </div>
    );
  } else if (!(configState !== null && configState.hasToken)) {
    // Not configured — show login
    content = <Login onConnected={recheck} />;
  } else {
    // Configured — show Focus Theater
    content = <Cockpit />;
  }

  return (
    <>
      {/* Optional looping background video, behind everything. */}
      <BgVideo />
      {content}
    </>
  );
}
