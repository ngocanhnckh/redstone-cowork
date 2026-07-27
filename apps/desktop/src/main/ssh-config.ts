import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Parse the operator's ~/.ssh/config so the New Session wizard can OFFER hosts they already
// have configured (one-click add, prefilled), instead of making them retype host/user/port.
// Deliberately simple: top-level Host blocks with HostName/User/Port. Wildcard patterns
// (Host *, bastion-*) and Match/Include blocks are skipped — those aren't concrete pickable
// hosts. Never throws (a missing/garbage config just yields []).

export type SshConfigHost = {
  alias: string;
  hostName: string | null;
  user: string | null;
  port: number | null;
};

const isConcreteAlias = (a: string) => !!a && !/[*?!]/.test(a) && a.toLowerCase() !== "host";

export function parseSshConfig(text: string): SshConfigHost[] {
  const out: SshConfigHost[] = [];
  // Aliases in the CURRENT `Host` line share one set of HostName/User/Port that follow.
  let current: string[] = [];
  const drafts = new Map<string, SshConfigHost>();

  const flush = () => { current = []; };
  const setForCurrent = (patch: Partial<SshConfigHost>) => {
    for (const alias of current) {
      const d = drafts.get(alias);
      if (d) Object.assign(d, patch);
    }
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^(\S+)\s+(.+)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();

    if (key === "host") {
      flush();
      const aliases = val.split(/\s+/).filter(isConcreteAlias);
      current = aliases;
      for (const a of aliases) {
        if (!drafts.has(a)) { const d: SshConfigHost = { alias: a, hostName: null, user: null, port: null }; drafts.set(a, d); out.push(d); }
      }
    } else if (key === "match") {
      flush(); // Match blocks are conditional — not a concrete pickable host.
    } else if (current.length) {
      if (key === "hostname") setForCurrent({ hostName: val });
      else if (key === "user") setForCurrent({ user: val });
      else if (key === "port") { const p = Number(val); if (Number.isFinite(p)) setForCurrent({ port: p }); }
    }
  }
  // Keep insertion order; dedupe already handled by the drafts map.
  return out;
}

export function listSshConfigHosts(): SshConfigHost[] {
  try {
    const text = readFileSync(join(homedir(), ".ssh", "config"), "utf8");
    return parseSshConfig(text);
  } catch {
    return [];
  }
}
