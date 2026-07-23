import { spawn } from "node:child_process";
import { getSshTarget, isLocalMachine } from "./workspace";
import { sshMuxOpts } from "./ssh-common";

// Resolve a host's primary LAN (local) IPv4 and its public IPv4. Runs a tiny shell
// snippet locally or over SSH. Best-effort — anything missing comes back null, and
// this never throws across IPC. No awk/sed backrefs so it works on busybox too.
const SCRIPT =
  `L=$(hostname -I 2>/dev/null | cut -d" " -f1); test -z "$L" && L=$(hostname -i 2>/dev/null | cut -d" " -f1); ` +
  `P=$(curl -s -4 --max-time 5 https://api.ipify.org 2>/dev/null); test -z "$P" && P=$(curl -s -4 --max-time 5 https://ifconfig.me 2>/dev/null); ` +
  `printf "%s\\t%s" "$L" "$P"`;

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    try {
      let out = "";
      const p = spawn(cmd, args, { env: process.env });
      const kill = setTimeout(() => { try { p.kill(); } catch { /* already gone */ } }, 14_000);
      p.stdout.on("data", (d) => (out += d.toString()));
      p.on("error", () => { clearTimeout(kill); resolve(""); });
      p.on("close", () => { clearTimeout(kill); resolve(out); });
    } catch {
      resolve("");
    }
  });
}

const cleanIp = (s?: string): string | null => {
  const v = (s ?? "").trim();
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(v) ? v : null;
};

export async function getHostIps(machine: string): Promise<{ local: string | null; public: string | null }> {
  try {
    let raw = "";
    if (isLocalMachine(machine)) {
      raw = await run("/bin/sh", ["-c", SCRIPT]);
    } else {
      const target = await getSshTarget(machine);
      raw = await run("ssh", [...sshMuxOpts(), ...target.opts, target.host, SCRIPT]);
    }
    const [local, pub] = raw.split("\t");
    return { local: cleanIp(local), public: cleanIp(pub) };
  } catch {
    return { local: null, public: null };
  }
}

export type HostPeer = { ip: string; port: number | null; count: number };

// List the remote IPs the host currently has established TCP connections with — the
// "who is this box talking to" recon feed behind the Recon Radar widget. `ss` is the
// modern tool; `netstat` is the busybox/older fallback. We only need the peer column,
// so the raw table is parsed in JS (below). Best-effort — empty on any failure.
const CONN_SCRIPT = `ss -tn 2>/dev/null || netstat -tn 2>/dev/null`;

/** Parse an `ss -tn` / `netstat -tn` table into deduped external peers (by IP). The
 * peer address is the LAST `IPv4:port` token on each line (local address comes first);
 * loopback/link-local are dropped. Deterministic order (by descending count). */
export function parsePeers(raw: string): HostPeer[] {
  const byIp = new Map<string, { port: number | null; count: number }>();
  for (const line of raw.split("\n")) {
    // Every `1.2.3.4:5678` on the line; the peer (foreign) address is the last one.
    const hits = line.match(/(\d{1,3}(?:\.\d{1,3}){3}):(\d+)/g);
    if (!hits || hits.length === 0) continue;
    const last = hits[hits.length - 1];
    const m = last.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d+)$/);
    if (!m) continue;
    const ip = m[1];
    if (ip === "127.0.0.1" || ip === "0.0.0.0" || ip.startsWith("127.") || ip.startsWith("169.254.")) continue;
    const port = Number(m[2]);
    const prev = byIp.get(ip);
    if (prev) prev.count += 1;
    else byIp.set(ip, { port: Number.isFinite(port) ? port : null, count: 1 });
  }
  return [...byIp.entries()]
    .map(([ip, v]) => ({ ip, port: v.port, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);
}

export async function getHostConnections(machine: string): Promise<HostPeer[]> {
  try {
    let raw = "";
    if (isLocalMachine(machine)) {
      raw = await run("/bin/sh", ["-c", CONN_SCRIPT]);
    } else {
      const target = await getSshTarget(machine);
      raw = await run("ssh", [...sshMuxOpts(), ...target.opts, target.host, CONN_SCRIPT]);
    }
    return parsePeers(raw);
  } catch {
    return [];
  }
}
