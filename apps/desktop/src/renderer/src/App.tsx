import { useState, useEffect, useCallback } from "react";
import Login from "./Login";
import Cockpit from "./cockpit/Cockpit";
import BgVideo from "./cockpit/BgVideo";
import { playSfx } from "./sfx";

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

  // Global "button click" cue: a single capture-phase listener plays the hi-tech
  // click sound whenever a real button is pressed, anywhere in the app. Rate-limited
  // and volume-gated in sfx.ts, so it's silent when the user sets SFX volume to 0.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest("button, [role=button]")) playSfx("button");
    };
    window.addEventListener("click", onClick, { capture: true });
    return () => window.removeEventListener("click", onClick, { capture: true });
  }, []);

  // Hi-tech keystroke cue: the same click sound on each keypress (typing anywhere —
  // terminal, chat, inputs). Skips auto-repeat (held keys) and bare modifiers so it's
  // a crisp click-per-key, not a machine-gun; rate-limited + volume-gated in sfx.ts.
  useEffect(() => {
    const MOD = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn", "Dead"]);
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || MOD.has(e.key)) return;
      playSfx("button");
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, []);

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
