// electron-builder afterPack hook.
//
// node-pty spawns every process via a small `spawn-helper` binary on macOS/Linux.
// Its prebuilt copy ships WITHOUT the executable bit (the prebuild tarball / pnpm
// extraction drops it), so the packaged app fails with `posix_spawnp failed` the
// moment you open a terminal. Restore +x on any spawn-helper in the packed output.
// Runs on the build host after packing, so it works for cross-builds too.
const fs = require("node:fs");
const path = require("node:path");

function fixExecutables(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) fixExecutables(p);
    else if (e.name === "spawn-helper") {
      try {
        fs.chmodSync(p, 0o755);
      } catch {
        /* best effort */
      }
    }
  }
}

exports.default = async function afterPack(context) {
  fixExecutables(context.appOutDir);
};
