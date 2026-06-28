import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
        // node-pty is a native module — never bundle it; resolve from node_modules at runtime.
        external: ["node-pty"],
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
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "src/renderer/index.html") } },
    },
  },
});
