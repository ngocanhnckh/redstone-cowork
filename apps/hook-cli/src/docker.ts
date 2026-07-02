import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export type DockerContainer = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: string | null;
  cpuPct: number | null;
  memUsed: number | null;
  memPct: number | null;
};

export type DockerSnapshot = { available: boolean; containers: DockerContainer[] };

/** Parse a "50.5MiB / 2GiB" (or "1.2GB / …") usage string → used bytes. */
function parseMemUsed(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.split("/")[0]?.trim().match(/([\d.]+)\s*([KMGT]?i?B)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const mul: Record<string, number> = {
    b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12,
    kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
  };
  return Math.round(n * (mul[unit] ?? 1));
}
const parsePct = (s: string | undefined): number | null => {
  if (!s) return null;
  const n = parseFloat(s.replace("%", ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * Sample running/known containers via `docker ps` (all states) and merge live
 * CPU/mem from `docker stats --no-stream`. Fully defensive: if docker is missing
 * or unauthorized, returns `{ available: false }` rather than throwing.
 */
export async function sampleDocker(): Promise<DockerSnapshot> {
  let psOut: string;
  try {
    const { stdout } = await execFileP("docker", ["ps", "-a", "--no-trunc", "--format", "{{json .}}"], { timeout: 8000, maxBuffer: 4 * 1024 * 1024 });
    psOut = stdout;
  } catch {
    return { available: false, containers: [] };
  }

  const containers: DockerContainer[] = [];
  for (const line of psOut.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t) as Record<string, string>;
      containers.push({
        id: (o.ID ?? "").slice(0, 12),
        name: o.Names ?? o.Name ?? "",
        image: o.Image ?? "",
        state: (o.State ?? "").toLowerCase(),
        status: o.Status ?? "",
        ports: o.Ports || null,
        cpuPct: null,
        memUsed: null,
        memPct: null,
      });
    } catch {
      // skip malformed line
    }
  }

  // Best-effort live stats for running containers (skip if it hangs/errors).
  try {
    const { stdout } = await execFileP("docker", ["stats", "--no-stream", "--format", "{{json .}}"], { timeout: 8000, maxBuffer: 4 * 1024 * 1024 });
    const byName = new Map(containers.map((c) => [c.name, c]));
    for (const line of stdout.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      try {
        const o = JSON.parse(t) as Record<string, string>;
        const c = byName.get(o.Name ?? "") ?? containers.find((x) => x.id.startsWith((o.Container ?? o.ID ?? "").slice(0, 12)));
        if (c) {
          c.cpuPct = parsePct(o.CPUPerc);
          c.memUsed = parseMemUsed(o.MemUsage);
          c.memPct = parsePct(o.MemPerc);
        }
      } catch {
        // skip
      }
    }
  } catch {
    // stats unavailable — ps data still useful
  }

  return { available: true, containers };
}
