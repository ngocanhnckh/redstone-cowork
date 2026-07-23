// Fetch the offline geodata the Network Map widget needs — run before build/dev.
//   pnpm --filter @rcw/desktop geoip
// Downloads:
//   1. DB-IP City Lite (CC BY 4.0) → resources/geoip/dbip-city-lite.mmdb  (gitignored,
//      bundled into the packaged app via electron-builder extraResources)
//   2. Natural Earth 110m land (public domain) → src/renderer/src/assets/geo/land.json
//      (committed — only ~140KB — so the app builds without the network).
// Both are free/redistributable; attribution lives in THIRD_PARTY_NOTICES.md.
import { createWriteStream, mkdirSync, existsSync, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mmdbPath = resolve(root, "resources/geoip/dbip-city-lite.mmdb");
const landPath = resolve(root, "src/renderer/src/assets/geo/land.json");

function ym(offset = 0) {
  // Build a YYYY-MM string offset by `offset` months from a fixed anchor is not needed;
  // DB-IP publishes monthly. We probe the current and previous month by constructing
  // strings from the process clock (build-time only — never shipped/executed at runtime).
  const d = new Date();
  d.setMonth(d.getMonth() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res;
}

async function fetchMmdb() {
  if (existsSync(mmdbPath) && statSync(mmdbPath).size > 1_000_000) {
    console.log(`✓ mmdb already present (${(statSync(mmdbPath).size / 1e6).toFixed(0)}MB) — skip`);
    return;
  }
  mkdirSync(dirname(mmdbPath), { recursive: true });
  let lastErr;
  for (const m of [ym(0), ym(1)]) {
    const url = `https://download.db-ip.com/free/dbip-city-lite-${m}.mmdb.gz`;
    try {
      console.log(`↓ ${url}`);
      const res = await download(url);
      await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(mmdbPath));
      console.log(`✓ mmdb → ${mmdbPath} (${(statSync(mmdbPath).size / 1e6).toFixed(0)}MB)`);
      return;
    } catch (e) { lastErr = e; console.warn(`  ${m} failed: ${e.message}`); }
  }
  throw new Error(`could not fetch DB-IP City Lite mmdb: ${lastErr?.message}`);
}

async function fetchLand() {
  if (existsSync(landPath) && statSync(landPath).size > 10_000) {
    console.log("✓ land.json already present — skip");
    return;
  }
  mkdirSync(dirname(landPath), { recursive: true });
  const url = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson";
  console.log(`↓ ${url}`);
  const res = await download(url);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(landPath));
  console.log(`✓ land → ${landPath} (${(statSync(landPath).size / 1e3).toFixed(0)}KB)`);
}

await fetchLand();
await fetchMmdb();
console.log("done.");
