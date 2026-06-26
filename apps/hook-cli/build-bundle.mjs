import { build } from "esbuild";
await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "dist/redstone.bundle.js",
  // shebang comes from src/main.ts (esbuild preserves it); no extra banner needed
});
console.log("bundled -> dist/redstone.bundle.js");
