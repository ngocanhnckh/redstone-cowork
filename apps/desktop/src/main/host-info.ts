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

export type HostProc = { pid: number; name: string; cpu: number; mem: number };
// procs = top consumers; cpuPct/memPct = OVERALL host usage (0–100) for the Reactor centre.
export type HostProcInfo = { procs: HostProc[]; cores: number; cpuPct: number; memPct: number };

// Top resource-consuming processes on the host — the "who's eating the box" feed
// behind the Reactor widget. `-eo … --sort` is procps (full Linux); the `ps aux`
// fallback covers busybox-ish hosts (parsed the same way: last two numeric columns).
// A trailing RCWSUM line carries core count + total RAM-used% so we can show OVERALL
// usage (per-process %CPU sums past 100% on multi-core; per-process %MEM is tiny — the
// centre readout normalises CPU by cores and reports real memory used).
const PROC_SCRIPT =
  `{ ps -eo pid=,comm=,pcpu=,pmem= --sort=-pcpu 2>/dev/null | head -n 14 || ps aux 2>/dev/null | head -n 15; } ; ` +
  `printf 'RCWSUM cores=%s mem=%s\\n' ` +
  `"$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1)" ` +
  `"$(free 2>/dev/null | awk '/Mem:/{print int(($3/$2)*100)}')"`;

/** Parse a `ps` table into processes. Handles both `ps -eo pid,comm,pcpu,pmem`
 * (PID first, cpu/mem last two, name in the middle) and the `ps aux` fallback
 * (USER PID %CPU %MEM … COMMAND). Header rows and non-numeric lines are skipped.
 * Sorted by cpu descending, capped at 12. */
export function parseProcesses(raw: string): HostProc[] {
  const out: HostProc[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim().split(/\s+/).filter(Boolean);
    if (t.length < 4) continue;
    let pid: number, name: string, cpu: number, mem: number;
    if (isInt(t[0])) {
      // `ps -eo pid=,comm=,pcpu=,pmem=` → PID COMM … %CPU %MEM
      pid = Number(t[0]);
      cpu = Number(t[t.length - 2]);
      mem = Number(t[t.length - 1]);
      name = baseName(t.slice(1, t.length - 2).join(" "));
    } else if (isInt(t[1]) && isNum(t[2]) && isNum(t[3])) {
      // `ps aux` → USER PID %CPU %MEM … COMMAND (skips the "USER PID …" header, whose
      // %CPU column is the non-numeric word "%CPU").
      pid = Number(t[1]);
      cpu = Number(t[2]);
      mem = Number(t[3]);
      // `ps aux` has 10 fixed columns then COMMAND (index 10). Use the executable
      // token, not the last arg. Falls back to the final token if the row is short.
      name = baseName(t[10] ?? t[t.length - 1]);
    } else {
      continue;
    }
    if (!Number.isFinite(cpu) || !Number.isFinite(mem) || !name) continue;
    out.push({ pid, name, cpu, mem });
  }
  return out.sort((a, b) => b.cpu - a.cpu).slice(0, 12);
}
function isNum(s: string): boolean { return /^\d+(\.\d+)?$/.test(s); }
function isInt(s: string): boolean { return /^\d+$/.test(s); }
function baseName(s: string): string { const b = s.split(/[\/\s]/).filter(Boolean).pop() ?? s; return b.slice(0, 24); }

/** Pull core count + total RAM-used% out of the trailing `RCWSUM cores=N mem=M` line. */
export function parseSummary(raw: string): { cores: number; memPct: number } {
  const line = raw.split("\n").find((l) => l.startsWith("RCWSUM")) ?? "";
  const cm = line.match(/cores=(\d+)/);
  const mm = line.match(/mem=(\d+)/);
  return { cores: cm ? Math.max(1, Number(cm[1])) : 1, memPct: mm ? Number(mm[1]) : 0 };
}

export async function getHostProcesses(machine: string): Promise<HostProcInfo> {
  try {
    let raw = "";
    if (isLocalMachine(machine)) {
      raw = await run("/bin/sh", ["-c", PROC_SCRIPT]);
    } else {
      const target = await getSshTarget(machine);
      raw = await run("ssh", [...sshMuxOpts(), ...target.opts, target.host, PROC_SCRIPT]);
    }
    const procs = parseProcesses(raw);
    const { cores, memPct } = parseSummary(raw);
    // Overall CPU% = combined %CPU of the top processes normalised by core count (they
    // dominate real load), capped at 100. Overall RAM% comes straight from `free`; if that
    // isn't available (e.g. macOS), fall back to the summed per-process %MEM.
    const cpuPct = Math.min(100, Math.round(procs.reduce((a, p) => a + p.cpu, 0) / cores));
    const mem = memPct > 0 ? memPct : Math.min(100, Math.round(procs.reduce((a, p) => a + p.mem, 0)));
    return { procs, cores, cpuPct, memPct: mem };
  } catch {
    return { procs: [], cores: 1, cpuPct: 0, memPct: 0 };
  }
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
