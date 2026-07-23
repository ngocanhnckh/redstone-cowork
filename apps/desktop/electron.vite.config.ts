import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
        // node-pty and node-mac-permissions are native modules — never bundle them;
        // resolve from node_modules at runtime.
        external: ["node-pty", "node-mac-permissions"],
      },
    },
  },
  preload: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "src/preload/index.ts") } },
    },
  },
  renderer: {
    root: "src/renderer",
    plugins: [react(), tailwindcss()],
    // PIN the dev port. localStorage (layout, Jira/connection settings, login) is
    // partitioned by ORIGIN — if Vite silently falls back from 5173 to 5174 because
    // an orphaned server holds 5173, the app loads a blank origin and all saved
    // state "disappears". strictPort makes it fail loudly instead of drifting.
    server: { port: 5173, strictPort: true },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "src/renderer/index.html") } },
    },
  },
});
