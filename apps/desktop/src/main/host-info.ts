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
const PROC_SCRIPT = [
  // top consumers (ps %CPU is a lifetime average — fine for ranking, normalised/clamped below)
  `{ ps -eo pid=,pcpu=,pmem=,args= --sort=-pcpu 2>/dev/null | head -n 16 || ps aux 2>/dev/null | head -n 16; }`,
  `C=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1)`,
  `M=$(free 2>/dev/null | awk '/Mem:/{print int(($3/$2)*100)}')`,
  // true instantaneous overall CPU% from two /proc/stat samples (busy jiffies / total)
  `S1=$(head -1 /proc/stat 2>/dev/null); sleep 0.3 2>/dev/null; S2=$(head -1 /proc/stat 2>/dev/null)`,
  `U=$(awk -v a="$S1" -v b="$S2" 'BEGIN{n=split(a,x);m=split(b,y);if(n<5||m<5)exit;for(i=2;i<=n;i++)t1+=x[i];for(i=2;i<=m;i++)t2+=y[i];dt=t2-t1;di=y[5]-x[5];if(dt>0)printf "%d",(100*(dt-di))/dt}')`,
  `printf 'RCWSUM cores=%s mem=%s cpu=%s\\n' "$C" "$M" "$U"`,
].join("; ");

/** Parse a `ps` table into processes. Handles `ps -eo pid=,pcpu=,pmem=,args=` (PID %CPU
 * %MEM then the full command) and the `ps aux` fallback (USER PID %CPU %MEM … COMMAND).
 * The name comes from the command line, not `comm`, so threaded apps don't all show up as
 * "MainThread". Header/summary/non-numeric lines are skipped. Sorted by cpu desc, cap 12. */
export function parseProcesses(raw: string): HostProc[] {
  const out: HostProc[] = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("RCWSUM")) continue;
    const t = s.split(/\s+/).filter(Boolean);
    if (t.length < 4) continue;
    let pid: number, cpu: number, mem: number, args: string;
    if (isInt(t[0]) && isNum(t[1]) && isNum(t[2])) {
      // `ps -eo pid=,pcpu=,pmem=,args=` → PID %CPU %MEM COMMAND…
      pid = Number(t[0]); cpu = Number(t[1]); mem = Number(t[2]); args = t.slice(3).join(" ");
    } else if (isInt(t[1]) && isNum(t[2]) && isNum(t[3])) {
      // `ps aux` → USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND…
      pid = Number(t[1]); cpu = Number(t[2]); mem = Number(t[3]); args = t.slice(10).join(" ") || (t[10] ?? "");
    } else {
      continue;
    }
    const name = friendlyName(args);
    if (!Number.isFinite(cpu) || !Number.isFinite(mem) || !name) continue;
    out.push({ pid, name, cpu, mem });
  }
  return out.sort((a, b) => b.cpu - a.cpu).slice(0, 12);
}
function isNum(s: string): boolean { return /^\d+(\.\d+)?$/.test(s); }
function isInt(s: string): boolean { return /^\d+$/.test(s); }
function baseName(s: string): string { const b = s.split(/[\/\s]/).filter(Boolean).pop() ?? s; return b.slice(0, 24); }
const INTERP = /^(python[0-9.]*|node|nodejs|ruby|perl|java|sh|bash|zsh|php|dotnet|mono)$/i;
/** A readable process name from a full command line: the executable's basename, but for an
 *  interpreter (node/python/…) the script it's running, so we get "redstone.js" not "node"
 *  and never the generic thread name `comm` would give. */
function friendlyName(args: string): string {
  const parts = args.split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  let exe = baseName(parts[0].replace(/:$/, "")); // strip a trailing ':' some kernels add
  if (INTERP.test(exe)) {
    const script = parts.slice(1).find((p) => !p.startsWith("-"));
    if (script) exe = baseName(script);
  }
  return exe || "?";
}

/** Pull core count, total RAM-used% and instantaneous overall CPU% out of the trailing
 *  `RCWSUM cores=N mem=M cpu=U` line. cpu is -1 when the host couldn't sample /proc/stat. */
export function parseSummary(raw: string): { cores: number; memPct: number; cpuPct: number } {
  const line = raw.split("\n").find((l) => l.startsWith("RCWSUM")) ?? "";
  const cm = line.match(/cores=(\d+)/);
  const mm = line.match(/mem=(\d+)/);
  const cp = line.match(/cpu=(\d+)/);
  return { cores: cm ? Math.max(1, Number(cm[1])) : 1, memPct: mm ? Number(mm[1]) : 0, cpuPct: cp ? Number(cp[1]) : -1 };
}

// Our own measurement pipeline — never show these as "top consumers" (a just-spawned `ps`
// reports absurd lifetime-average %CPU, which is what produced the bogus "ps 800%").
const SELF_PROCS = new Set(["ps", "awk", "head", "nproc", "free", "sleep", "sort", "printf"]);

export async function getHostProcesses(machine: string): Promise<HostProcInfo> {
  try {
    let raw = "";
    if (isLocalMachine(machine)) {
      raw = await run("/bin/sh", ["-c", PROC_SCRIPT]);
    } else {
      const target = await getSshTarget(machine);
      raw = await run("ssh", [...sshMuxOpts(), ...target.opts, target.host, PROC_SCRIPT]);
    }
    const { cores, memPct, cpuPct: sysCpu } = parseSummary(raw);
    // `ps` %CPU is per-CORE (a process pegging all cores reads 100·cores%). Normalise by core
    // count so a value is a share of the WHOLE machine, and clamp to 100 so a lifetime-average
    // spike can never render >100%. Drop our own measurement processes.
    const procs = parseProcesses(raw)
      .filter((p) => !SELF_PROCS.has(p.name.toLowerCase()))
      .map((p) => ({ ...p, cpu: Math.min(100, Math.round((p.cpu / cores) * 10) / 10) }))
      .slice(0, 12);
    // Overall CPU LOAD is the true instantaneous system reading (/proc/stat); only if that
    // isn't available do we fall back to the summed per-process share. RAM% from `free`,
    // falling back to summed per-process %MEM (e.g. macOS without `free`).
    const cpuPct = sysCpu >= 0 ? Math.min(100, sysCpu) : Math.min(100, Math.round(procs.reduce((a, p) => a + p.cpu, 0)));
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
