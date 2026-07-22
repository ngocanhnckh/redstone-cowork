import type { DockerHostView } from "../types";

/**
 * Pick the best Docker report for a machine. The telemetry feed can carry MORE than
 * one entry per machine name (multiple agents, or a stale report lingering next to a
 * fresh one — we've seen `yitec` reported twice, and a renamed box appear under both
 * its old and new hostname). A naive `.find()` grabs whichever is first, which may be
 * an empty/unavailable duplicate → the panel wrongly reads "no containers".
 *
 * So among all entries matching `machine`, prefer: available over not, then the one
 * with the most containers, then the freshest `at`. Returns null when none match.
 */
export function bestDockerHost(hosts: DockerHostView[], machine: string | null): DockerHostView | null {
  if (!machine) return null;
  const matches = hosts.filter((h) => h.machine === machine);
  if (matches.length === 0) return null;
  return matches.slice().sort((a, b) => {
    if (!!b.available !== !!a.available) return b.available ? 1 : -1;
    const bc = b.containers?.length ?? 0;
    const ac = a.containers?.length ?? 0;
    if (bc !== ac) return bc - ac;
    return (Date.parse(b.at ?? "") || 0) - (Date.parse(a.at ?? "") || 0);
  })[0];
}
