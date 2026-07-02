import { cpus, totalmem, freemem, uptime, platform } from "node:os";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export type Geo = { lat: number; long: number; city: string | null; country: string | null };
export type TelemetrySample = {
  cpuPct: number;
  ramUsed: number;
  ramTotal: number;
  netRxBps: number | null;
  netTxBps: number | null;
  uptimeSec: number;
  geo: Geo | null;
};

// ---- CPU: percent busy from os.cpus() time deltas between samples ----
function cpuTotals(): { idle: number; total: number } {
  let idle = 0, total = 0;
  for (const c of cpus()) {
    for (const t of Object.values(c.times)) total += t;
    idle += c.times.idle;
  }
  return { idle, total };
}
let prevCpu = cpuTotals();
export function cpuPercent(): number {
  const cur = cpuTotals();
  const idleD = cur.idle - prevCpu.idle;
  const totalD = cur.total - prevCpu.total;
  prevCpu = cur;
  if (totalD <= 0) return 0; // first sample or no delta
  return Math.max(0, Math.min(100, Math.round(100 * (1 - idleD / totalD))));
}

// ---- Network: bytes rx/tx across real interfaces → bps between samples ----
async function netTotals(): Promise<{ rx: number; tx: number } | null> {
  try {
    if (platform() === "linux") {
      const lines = readFileSync("/proc/net/dev", "utf8").split("\n").slice(2);
      let rx = 0, tx = 0;
      for (const line of lines) {
        const [iface, rest] = line.split(":");
        if (!rest || iface.trim() === "lo") continue;
        const cols = rest.trim().split(/\s+/);
        rx += Number(cols[0]) || 0;
        tx += Number(cols[8]) || 0;
      }
      return { rx, tx };
    }
    if (platform() === "darwin") {
      const { stdout } = await execFileP("netstat", ["-ib"], { timeout: 4000 });
      const seen = new Set<string>();
      let rx = 0, tx = 0;
      for (const line of stdout.split("\n").slice(1)) {
        const c = line.trim().split(/\s+/);
        const iface = c[0];
        if (!iface || iface === "lo0" || seen.has(iface)) continue;
        // netstat -ib columns vary; Ibytes/Obytes are the last two large numbers on the Link# row.
        if (!c.includes("Link#")) continue;
        seen.add(iface);
        const nums = c.filter((x) => /^\d+$/.test(x)).map(Number);
        if (nums.length >= 2) { rx += nums[nums.length - 2]; tx += nums[nums.length - 1]; }
      }
      return { rx, tx };
    }
  } catch {
    return null;
  }
  return null;
}
let prevNet: { rx: number; tx: number; t: number } | null = null;
async function netBps(): Promise<{ rx: number | null; tx: number | null }> {
  const totals = await netTotals();
  const now = Date.now();
  if (!totals) return { rx: null, tx: null };
  if (!prevNet) { prevNet = { ...totals, t: now }; return { rx: 0, tx: 0 }; }
  const dt = (now - prevNet.t) / 1000;
  const rx = dt > 0 ? Math.max(0, Math.round((totals.rx - prevNet.rx) / dt)) : 0;
  const tx = dt > 0 ? Math.max(0, Math.round((totals.tx - prevNet.tx) / dt)) : 0;
  prevNet = { ...totals, t: now };
  return { rx, tx };
}

// ---- Geo: approximate location from public IP, cached ~1h ----
let geoCache: { geo: Geo | null; t: number } | null = null;
const GEO_TTL_MS = 60 * 60 * 1000;
async function geolocate(): Promise<Geo | null> {
  if (geoCache && Date.now() - geoCache.t < GEO_TTL_MS) return geoCache.geo;
  let geo: Geo | null = null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch("http://ip-api.com/json/?fields=status,lat,lon,city,country", { signal: ctrl.signal });
      if (res.ok) {
        const j = (await res.json()) as { status?: string; lat?: number; lon?: number; city?: string; country?: string };
        if (j.status === "success" && typeof j.lat === "number" && typeof j.lon === "number") {
          geo = { lat: j.lat, long: j.lon, city: j.city ?? null, country: j.country ?? null };
        }
      }
    } finally { clearTimeout(timer); }
  } catch {
    geo = null;
  }
  geoCache = { geo, t: Date.now() };
  return geo;
}

/** Take one telemetry sample. Fully defensive — any sub-metric failure degrades to null/0. */
export async function sampleTelemetry(): Promise<TelemetrySample> {
  const [net, geo] = await Promise.all([netBps(), geolocate()]);
  return {
    cpuPct: cpuPercent(),
    ramTotal: totalmem(),
    ramUsed: totalmem() - freemem(),
    netRxBps: net.rx,
    netTxBps: net.tx,
    uptimeSec: Math.round(uptime()),
    geo,
  };
}
