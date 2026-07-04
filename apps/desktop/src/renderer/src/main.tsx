import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { loadAppearance, applyAppearance, applyBgImage } from "./appearance";

// Apply saved appearance before first paint (no flash), then load the persisted
// background image (async, from the main process' userData store).
applyAppearance(loadAppearance());
window.cowork?.getBgImage?.().then(applyBgImage).catch(() => {});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
