import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import maxmind, { type Reader, type CityResponse } from "maxmind";

// Offline IP geolocation via the bundled DB-IP City Lite database (CC BY 4.0). The
// mmdb is fetched by scripts/fetch-geoip.mjs and shipped as an extraResource; lookups
// are fully local (nothing leaves the machine). Missing DB → every lookup returns null.

export type Geo = { lat: number; lon: number; city: string | null; country: string | null; code: string | null };

function candidates(): string[] {
  const out: string[] = [];
  // Packaged: electron-builder extraResources → <resources>/geoip/…
  if (process.resourcesPath) out.push(join(process.resourcesPath, "geoip", "dbip-city-lite.mmdb"));
  // Dev: repo resources dir, relative to the app path.
  try { out.push(join(app.getAppPath(), "resources", "geoip", "dbip-city-lite.mmdb")); } catch { /* app not ready */ }
  return out;
}

let reader: Reader<CityResponse> | null = null;
let loading: Promise<Reader<CityResponse> | null> | null = null;
async function getReader(): Promise<Reader<CityResponse> | null> {
  if (reader) return reader;
  if (loading) return loading;
  loading = (async () => {
    for (const p of candidates()) {
      if (!existsSync(p)) continue;
      try { reader = await maxmind.open<CityResponse>(p); return reader; }
      catch { /* corrupt/unsupported — try next */ }
    }
    return null;
  })();
  return loading;
}

/** True when the geo database is available (so the UI can explain if it isn't). */
export async function geoReady(): Promise<boolean> {
  return (await getReader()) != null;
}

/** Geolocate an IPv4 — null when the DB is missing or the IP isn't in it. */
export async function geoLookup(ip: string): Promise<Geo | null> {
  const r = await getReader();
  if (!r) return null;
  let g: CityResponse | null;
  try { g = r.get(ip); } catch { return null; }
  const loc = g?.location;
  if (!loc || loc.latitude == null || loc.longitude == null) return null;
  return {
    lat: loc.latitude,
    lon: loc.longitude,
    city: g?.city?.names?.en ?? null,
    country: g?.country?.names?.en ?? null,
    code: g?.country?.iso_code ?? null,
  };
}
