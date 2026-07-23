import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import TerminalWindow, { parseTermHash } from "./TerminalWindow";
import "./styles/globals.css";
import { loadAppearance, applyAppearance, applyBgImage } from "./appearance";
import { installGlobalSfx } from "./sfx";

// Apply saved appearance before first paint (no flash), then load the persisted
// background image (async, from the main process' userData store).
applyAppearance(loadAppearance());
window.cowork?.getBgImage?.().then(applyBgImage).catch(() => {});

// Hi-tech click + keystroke cues on every window (cockpit and pop-out terminals).
installGlobalSfx();

// Register the animated <angle> the session-card "working" orbit glow interpolates.
// The CSS @property at-rule can be dropped/ignored by the build's CSS processor, which
// makes the custom-property animation discrete (the glow reads as frozen); registering
// it here in JS is reliable across builds.
try {
  (CSS as unknown as { registerProperty?: (d: { name: string; syntax: string; inherits: boolean; initialValue: string }) => void }).registerProperty?.({
    name: "--rcw-orbit-a", syntax: "<angle>", inherits: false, initialValue: "0deg",
  });
} catch { /* already registered / unsupported — fine */ }

// A pop-out terminal window loads the same bundle with a `#term=` hash — render just
// the standalone terminal there, not the whole cockpit.
const termArgs = parseTermHash(window.location.hash);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {termArgs ? <TerminalWindow args={termArgs} /> : <App />}
  </React.StrictMode>,
);
