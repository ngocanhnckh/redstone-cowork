import { runRemote } from "./claude-login";
import { isLocalMachine } from "./workspace";
import { execFile } from "node:child_process";

// Disk usage for a host's real filesystems (skips virtual/pseudo mounts). Fetched via
// `df` over the same SSH resolver the terminal uses; runs locally when it's this machine.

import type { DiskMount, DiskUsage } from "../shared/disk";
export type { DiskMount, DiskUsage };

function parseDf(out: string): DiskMount[] {
  const mounts: DiskMount[] = [];
  for (const line of out.split("\n").slice(1)) {
    const c = line.trim().split(/\s+/);
    if (c.length < 6) continue;
    const fs = c[0];
    const sizeKb = +c[1], usedKb = +c[2], availKb = +c[3];
    const mount = c.slice(5).join(" ");
    if (!Number.isFinite(sizeKb) || sizeKb <= 0) continue;
    if (/^(tmpfs|devtmpfs|overlay|squashfs|none|udev|shm|efivarfs|ramfs)$/i.test(fs)) continue;
    if (/^\/(dev|proc|sys|run|snap)(\/|$)/.test(mount) || mount === "/boot/efi") continue;
    mounts.push({ fs, sizeKb, usedKb, availKb, pct: sizeKb ? Math.round((usedKb / sizeKb) * 100) : 0, mount });
  }
  // dedupe by mount point, keep the largest, biggest-first
  const byMount = new Map<string, DiskMount>();
  for (const m of mounts) { const e = byMount.get(m.mount); if (!e || m.sizeKb > e.sizeKb) byMount.set(m.mount, m); }
  return [...byMount.values()].sort((a, b) => b.sizeKb - a.sizeKb);
}

function localDf(): Promise<string> {
  return new Promise((resolve) => {
    execFile("df", ["-Pk"], { timeout: 8000, maxBuffer: 2 * 1024 * 1024 }, (_e, out) => resolve(out || ""));
  });
}

export async function diskUsage(machine: string): Promise<DiskUsage> {
  try {
    const out = isLocalMachine(machine) ? await localDf() : await runRemote(machine, "df -Pk 2>/dev/null", 12000);
    return { ok: true, mounts: parseDf(out) };
  } catch (e) {
    return { ok: false, mounts: [], error: e instanceof Error ? e.message : String(e) };
  }
}
