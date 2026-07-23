import { useState, useEffect, useCallback } from "react";
import Login from "./Login";
import Cockpit from "./cockpit/Cockpit";
import BgVideo from "./cockpit/BgVideo";

type ConfigState = { serverUrl: string; hasToken: boolean; isAccount?: boolean } | null | "loading";

// Employee sessions lock after this long AWAY from the app (window unfocused).
// While the app stays focused, no re-login is ever required; the server also
// idles tokens out after the same window as a backstop.
const AWAY_LOCK_MS = 30 * 60_000;

export default function App() {
  const [configState, setConfigState] = useState<ConfigState>("loading");

  const recheck = useCallback(async () => {
    const cfg = await window.cowork.getConfig();
    setConfigState(cfg ?? null);
  }, []);

  useEffect(() => {
    recheck();
  }, [recheck]);

  // Away-lock: enterprise account sessions sign out after 30 min unfocused.
  const isAccount = configState !== "loading" && !!configState?.isAccount && !!configState?.hasToken;
  useEffect(() => {
    if (!isAccount) return;
    let awaySince: number | null = document.hasFocus() ? null : Date.now();
    const lock = async () => {
      await window.cowork.clearConfig();
      await recheck(); // token gone → login (face + credentials) screen
    };
    const check = () => {
      if (awaySince !== null && Date.now() - awaySince > AWAY_LOCK_MS) void lock();
    };
    const onBlur = () => { awaySince ??= Date.now(); };
    const onFocus = () => { check(); awaySince = null; };
    const timer = setInterval(check, 60_000);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, [isAccount, recheck]);

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
