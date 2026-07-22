// postinstall: node-pty's prebuilt `spawn-helper` (macOS/Linux) ships WITHOUT the
// executable bit — pnpm/prebuild extraction drops it — so any install that resolves
// node-pty to its prebuild (a fresh clone, CI) leaves the DEV app throwing
// `posix_spawnp failed` on the first terminal. Restore +x after every install.
const fs = require("node:fs");
const path = require("node:path");

function fix(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== ".git") fix(p);
    else if (e.name === "spawn-helper") {
      try {
        fs.chmodSync(p, 0o755);
      } catch {
        /* best effort */
      }
    }
  }
}

// Walk this package's node_modules and the monorepo root store.
for (const root of ["node_modules", path.join("..", "..", "node_modules")]) {
  fix(path.resolve(process.cwd(), root));
}
