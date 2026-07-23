import { spawn } from "node:child_process";
import { promises as dns } from "node:dns";
import { getSshTarget, isLocalMachine } from "./workspace";
import { sshMuxOpts } from "./ssh-common";
import { getHostIps } from "./host-info";
import { geoLookup, geoReady, type Geo } from "./geoip";

// The data behind the Network Map widget: the host's established TCP connections
// (via `ss -tnp` over SSH) enriched with the owning process, reverse-DNS domain, the
// well-known service for the port, and an OFFLINE geo position for the map. Best-effort
// throughout — a missing piece just comes back null; this never throws across IPC.

export type NetPeer = {
  ip: string; port: number | null; proc: string | null; domain: string | null; service: string | null;
  count: number; lat: number | null; lon: number | null; city: string | null; country: string | null;
};
export type NetHost = { ip: string | null; lat: number | null; lon: number | null; city: string | null; country: string | null };
export type NetworkMap = { ok: boolean; geo: boolean; host: NetHost; peers: NetPeer[] };

const SERVICES: Record<number, string> = {
  20: "ftp", 21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns", 80: "http", 110: "pop3",
  143: "imap", 443: "https", 465: "smtps", 587: "smtp", 993: "imaps", 995: "pop3s", 989: "ftps", 990: "ftps",
  1433: "mssql", 1521: "oracle", 2049: "nfs", 3000: "http", 3306: "mysql", 3389: "rdp", 4222: "nats",
  5432: "postgres", 5672: "amqp", 5900: "vnc", 6379: "redis", 6443: "k8s", 8080: "http", 8443: "https",
  9000: "http", 9092: "kafka", 9200: "elastic", 11211: "memcached", 27017: "mongo",
};
function serviceFor(port: number | null): string | null {
  if (port == null) return null;
  return SERVICES[port] ?? (port >= 49152 ? "ephemeral" : null);
}

const CONN_SCRIPT = `ss -tnp 2>/dev/null || ss -tn 2>/dev/null`;

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    try {
      let out = "";
      const p = spawn(cmd, args, { env: process.env });
      const kill = setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, 14_000);
      p.stdout.on("data", (d) => (out += d.toString()));
      p.on("error", () => { clearTimeout(kill); resolve(""); });
      p.on("close", () => { clearTimeout(kill); resolve(out); });
    } catch { resolve(""); }
  });
}

type Raw = { ip: string; port: number | null; proc: string | null; count: number };
/** Parse `ss -tn[p]` output into deduped peers with the owning process (when `-p`
 * was permitted). Peer = the last IPv4:port on the line; loopback/link-local dropped. */
export function parseNet(raw: string): Raw[] {
  const by = new Map<string, { port: number | null; proc: string | null; count: number }>();
  for (const line of raw.split("\n")) {
    const hits = line.match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d+)/g);
    if (!hits || hits.length === 0) continue;
    const last = hits[hits.length - 1];
    const m = last.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);
    if (!m) continue;
    const ip = m[1];
    if (ip === "0.0.0.0" || ip.startsWith("127.") || ip.startsWith("169.254.")) continue;
    const port = Number(m[2]);
    const procM = line.match(/\(\("([^"]+)"/); // users:(("node",pid=…)) → node
    const proc = procM ? procM[1] : null;
    const prev = by.get(ip);
    if (prev) { prev.count += 1; if (!prev.proc && proc) prev.proc = proc; }
    else by.set(ip, { port: Number.isFinite(port) ? port : null, proc, count: 1 });
  }
  return [...by.entries()].map(([ip, v]) => ({ ip, ...v })).sort((a, b) => b.count - a.count).slice(0, 40);
}

/** Reverse-DNS with a short timeout so a slow/again-failing PTR doesn't stall the map. */
async function reverse(ip: string): Promise<string | null> {
  try {
    const names = await Promise.race([
      dns.reverse(ip),
      new Promise<string[]>((_, rej) => setTimeout(() => rej(new Error("timeout")), 1500)),
    ]);
    return names && names.length ? names[0] : null;
  } catch { return null; }
}

// Small cache so the widget's ~5s poll doesn't spawn ssh + re-resolve every tick.
const cache = new Map<string, { at: number; map: NetworkMap }>();
const TTL_MS = 4000;

export async function getNetworkMap(machine: string): Promise<NetworkMap> {
  const hit = cache.get(machine);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.map;
  try {
    let raw = "";
    if (isLocalMachine(machine)) raw = await run("/bin/sh", ["-c", CONN_SCRIPT]);
    else { const t = await getSshTarget(machine); raw = await run("ssh", [...sshMuxOpts(), ...t.opts, t.host, CONN_SCRIPT]); }

    const rows = parseNet(raw);
    const geo = await geoReady();
    const [ips, peers] = await Promise.all([
      getHostIps(machine).catch(() => ({ local: null, public: null })),
      Promise.all(rows.map(async (r): Promise<NetPeer> => {
        const [g, domain] = await Promise.all([geoLookup(r.ip), reverse(r.ip)]);
        return { ip: r.ip, port: r.port, proc: r.proc, domain, service: serviceFor(r.port), count: r.count,
          lat: g?.lat ?? null, lon: g?.lon ?? null, city: g?.city ?? null, country: g?.country ?? null };
      })),
    ]);
    const hg: Geo | null = ips.public ? await geoLookup(ips.public) : null;
    const map: NetworkMap = {
      ok: true, geo,
      host: { ip: ips.public ?? ips.local, lat: hg?.lat ?? null, lon: hg?.lon ?? null, city: hg?.city ?? null, country: hg?.country ?? null },
      peers,
    };
    cache.set(machine, { at: Date.now(), map });
    return map;
  } catch {
    return { ok: false, geo: false, host: { ip: null, lat: null, lon: null, city: null, country: null }, peers: [] };
  }
}
