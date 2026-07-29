import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSshConfigHosts } from "../ssh-config";

// ---------------------------------------------------------------------------
// Which machines the direct edition talks to.
//
// Replaces `GET /hosts` (the hosted edition's registry, populated by agents phoning
// home). Sources, highest priority first:
//
//   1. local      — this machine, always present, no SSH involved
//   2. manual     — added in the app; explicit user intent, never overwritten
//   3. ssh-config — ~/.ssh/config aliases, OFFERED but never auto-enabled
//
// The ssh-config rule matters: a typical config has dozens of aliases, including
// bastions and one-offs. Auto-connecting to all of them on launch would be hostile,
// and a burst of SSH handshakes is exactly what fail2ban bans. They show up as
// suggestions; the user picks.
//
// Stored as plain JSON (not encrypted) because it holds no secrets — SSH credentials
// live in ssh-creds.ts (safeStorage) and the user's own keys/agent. Keeping it
// readable makes support far easier.
// ---------------------------------------------------------------------------

export type HostSource = "local" | "manual" | "ssh-config";

export type HostEntry = {
  id: string;
  label: string;
  /** What gets handed to ssh. Empty for the local machine. */
  sshHost: string;
  user: string | null;
  port: number | null;
  /** Extra ssh args (ProxyJump, IdentityFile…), same shape as ssh-custom.json. */
  opts: string[];
  source: HostSource;
  enabled: boolean;
  lastOkAt: string | null;
  lastError: string | null;
};

type Stored = {
  v: 1;
  hosts: HostEntry[];
  /** ssh-config aliases the user dismissed, so they stop being offered. */
  hidden: string[];
};

const storePath = (): string => path.join(app.getPath("userData"), "direct-hosts.json");

export const LOCAL_HOST_ID = "local";

function localEntry(): HostEntry {
  return {
    id: LOCAL_HOST_ID,
    label: os.hostname(),
    sshHost: "",
    user: null,
    port: null,
    opts: [],
    source: "local",
    enabled: true,
    lastOkAt: null,
    lastError: null,
  };
}

function read(): Stored {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf8")) as Stored;
    if (raw && raw.v === 1 && Array.isArray(raw.hosts)) {
      return { v: 1, hosts: raw.hosts, hidden: Array.isArray(raw.hidden) ? raw.hidden : [] };
    }
  } catch {
    // no store yet, or garbage — start clean
  }
  return { v: 1, hosts: [], hidden: [] };
}

function write(s: Stored): void {
  try {
    const p = storePath();
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), "utf8");
    fs.renameSync(tmp, p); // atomic — a crash mid-write can't truncate the book
  } catch {
    // best-effort; never throw across IPC
  }
}

/** Normalised key for deduping across sources. */
function keyOf(h: { sshHost: string; user: string | null }): string {
  return `${(h.user ?? "").toLowerCase()}@${h.sshHost.toLowerCase()}`;
}

/**
 * The full host book: stored hosts, plus this machine, plus any ~/.ssh/config alias
 * not already covered or dismissed (offered as disabled suggestions).
 */
export function listHosts(): HostEntry[] {
  const stored = read();
  const out: HostEntry[] = [localEntry()];
  const seen = new Set<string>();

  for (const h of stored.hosts) {
    if (h.source === "local") continue; // regenerated above
    out.push(h);
    seen.add(keyOf(h));
  }

  const hidden = new Set(stored.hidden.map((a) => a.toLowerCase()));
  for (const c of listSshConfigHosts()) {
    if (hidden.has(c.alias.toLowerCase())) continue;
    const candidate = { sshHost: c.alias, user: c.user };
    if (seen.has(keyOf(candidate))) continue;
    out.push({
      id: `sshconfig:${c.alias}`,
      label: c.alias,
      sshHost: c.alias,
      user: c.user,
      port: c.port,
      opts: [],
      source: "ssh-config",
      // Offered, NOT enabled — see the note at the top of this file.
      enabled: false,
      lastOkAt: null,
      lastError: null,
    });
  }
  return out;
}

/** Hosts the engine should actually connect to. */
export function enabledHosts(): HostEntry[] {
  return listHosts().filter((h) => h.enabled);
}

export function getHost(id: string): HostEntry | null {
  return listHosts().find((h) => h.id === id) ?? null;
}

/** Enable or disable a host. Enabling an ssh-config suggestion promotes it to a
 *  stored entry so it survives edits to ~/.ssh/config. */
export function setEnabled(id: string, enabled: boolean): HostEntry | null {
  if (id === LOCAL_HOST_ID) return localEntry(); // the local machine is never disabled
  const stored = read();
  const existing = stored.hosts.find((h) => h.id === id);
  if (existing) {
    existing.enabled = enabled;
    write(stored);
    return existing;
  }
  const offered = listHosts().find((h) => h.id === id);
  if (!offered) return null;
  const promoted: HostEntry = { ...offered, enabled };
  stored.hosts.push(promoted);
  write(stored);
  return promoted;
}

export function addHost(input: {
  label?: string;
  sshHost: string;
  user?: string | null;
  port?: number | null;
  opts?: string[];
}): HostEntry {
  const stored = read();
  const entry: HostEntry = {
    id: `manual:${input.sshHost}:${Date.now()}`,
    label: input.label?.trim() || input.sshHost,
    sshHost: input.sshHost,
    user: input.user ?? null,
    port: input.port ?? null,
    opts: input.opts ?? [],
    source: "manual",
    enabled: true,
    lastOkAt: null,
    lastError: null,
  };
  stored.hosts.push(entry);
  write(stored);
  return entry;
}

export function removeHost(id: string): void {
  if (id === LOCAL_HOST_ID) return;
  const stored = read();
  const before = stored.hosts.length;
  stored.hosts = stored.hosts.filter((h) => h.id !== id);
  // Dismissing a suggestion means "stop offering this alias", which only a hidden
  // list can express — it isn't ours to delete from ~/.ssh/config.
  if (stored.hosts.length === before && id.startsWith("sshconfig:")) {
    const alias = id.slice("sshconfig:".length);
    if (!stored.hidden.includes(alias)) stored.hidden.push(alias);
  }
  write(stored);
}

/** Record the outcome of the last connection attempt, for the hosts UI. */
export function recordStatus(id: string, ok: boolean, error?: string): void {
  const stored = read();
  const h = stored.hosts.find((x) => x.id === id);
  if (!h) return;
  if (ok) { h.lastOkAt = new Date().toISOString(); h.lastError = null; }
  else h.lastError = error ?? "connection failed";
  write(stored);
}

/** ssh argv for a host: `{ host, opts }`, or null for the local machine. */
export function sshTargetOf(h: HostEntry): { host: string; opts: string[] } | null {
  if (h.source === "local") return null;
  const opts = [...h.opts];
  if (h.port) opts.push("-p", String(h.port));
  // A blank user means "let ssh resolve it from ~/.ssh/config" — which is the whole
  // point of adding a host by its alias.
  const host = h.user && h.user.trim() ? `${h.user.trim()}@${h.sshHost}` : h.sshHost;
  return { host, opts };
}
