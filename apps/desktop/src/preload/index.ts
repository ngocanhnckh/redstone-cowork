import { contextBridge } from "electron";

// Minimal bridge for the scaffold. Task 3 expands this into the full
// `window.cowork` data API (config, sessions/queue/decisions, onUpdate).
contextBridge.exposeInMainWorld("cowork", {
  ping: () => "pong",
});
