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

// A pop-out terminal window loads the same bundle with a `#term=` hash — render just
// the standalone terminal there, not the whole cockpit.
const termArgs = parseTermHash(window.location.hash);

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {termArgs ? <TerminalWindow args={termArgs} /> : <App />}
  </React.StrictMode>,
);
