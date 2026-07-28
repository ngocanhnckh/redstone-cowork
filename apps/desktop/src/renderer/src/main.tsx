import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import TerminalWindow, { parseTermHash } from "./TerminalWindow";
import "./styles/globals.css";
import { loadAppearance, applyAppearance, applyBgImage } from "./appearance";
import { installGlobalSfx } from "./sfx";
import { restoreSettings, startSettingsSnapshot } from "./settingsSnapshot";

// A pop-out terminal window loads the same bundle with a `#term=` hash — render just
// the standalone terminal there, not the whole cockpit.
const termArgs = parseTermHash(window.location.hash);

/**
 * Settings must be recovered BEFORE anything reads them, so the boot is async.
 * localStorage is per-origin and comes up empty if Chromium can't open its store;
 * the userData snapshot is the durable copy (see settingsSnapshot.ts). Only keys
 * MISSING from this origin are filled in, so a live profile is never overwritten.
 *
 * Recovery is best-effort and must never block the app from starting: any failure
 * falls through to rendering with whatever localStorage has.
 */
async function boot() {
  try { await restoreSettings(); } catch { /* start anyway */ }
  try { startSettingsSnapshot(); } catch { /* snapshotting is optional */ }

  // Apply saved appearance before first paint (no flash), then load the persisted
  // background image (async, from the main process' userData store).
  applyAppearance(loadAppearance());
  window.cowork?.getBgImage?.().then(applyBgImage).catch(() => {});

  // Hi-tech click + keystroke cues on every window (cockpit and pop-out terminals).
  installGlobalSfx();

  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      {termArgs ? <TerminalWindow args={termArgs} /> : <App />}
    </React.StrictMode>,
  );
}

void boot();
