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
