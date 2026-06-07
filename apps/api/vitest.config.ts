import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["test/**/*.test.ts"], globals: true },
  plugins: [swc.vite()],
});
