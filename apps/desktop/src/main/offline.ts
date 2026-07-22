import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { app } from "electron";
import { sshMuxOpts } from "./ssh-common";

// ---------------------------------------------------------------------------
// OFFLINE MODE — drive Claude Code sessions on remote hosts over plain SSH, with
// NO cowork server. Sessions live in tmux; we discover them (tmux list-sessions),
// read their live state from the pane (tmux capture-pane), answer by typing into
// the pane (tmux send-keys), and start new ones (tmux new-session … claude). The
// cockpit renders these exactly like server sessions — only the data source
// changes. Everything here is one warm multiplexed SSH connection per host.
// ---------------------------------------------------------------------------

const SSH_TIMEOUT_MS = 12_000;
/** How much scrollback to read per session for the transcript + state heuristic. */
const CAPTURE_LINES = 60;

export type OfflineHost = { alias: string; host: string; label?: string };
export type OfflineSessionState = "working" | "waiting" | "idle";

export type OfflineSession = {
  /** Stable id: "<hostAlias>::<tmuxName>". */
  id: string;
  hostAlias: string;
  /** The ssh target (alias or user@host) this session lives on. */
  host: string;
  tmux: string;
  cwd: string;
  createdAt: number;
  state: OfflineSessionState;
  /** Recent pane scrollback — the transcript we show. */
  transcript: string;
};

/** Single-quote a value for safe interpolation into a remote shell command. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sshArgs(host: string, remoteCommand: string): string[] {
  return [...sshMuxOpts(), "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", host, remoteCommand];
}

function sshRun(host: string, remoteCommand: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("ssh", sshArgs(host, remoteCommand), { timeout: SSH_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
}

// ----------------------------- host registry -------------------------------

function hostsStorePath(): string {
  return path.join(app.getPath("userData"), "offline-hosts.json");
}

export function readOfflineHosts(): OfflineHost[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(hostsStorePath(), "utf8"));
    return Array.isArray(parsed) ? parsed.filter((h) => h && typeof h.host === "string") : [];
  } catch {
    return [];
  }
}

export function writeOfflineHosts(hosts: OfflineHost[]): void {
  try {
    fs.mkdirSync(path.dirname(hostsStorePath()), { recursive: true });
    fs.writeFileSync(hostsStorePath(), JSON.stringify(hosts, null, 2));
  } catch {
    /* best effort */
  }
}

/** Parse `Host` aliases from an ~/.ssh/config body (skips wildcards). Pure. */
export function parseSshConfigHosts(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*Host\s+(.+?)\s*$/i.exec(line);
    if (!m) continue;
    for (const alias of m[1].split(/\s+/)) {
      if (alias && !alias.includes("*") && !alias.includes("?") && !out.includes(alias)) out.push(alias);
    }
  }
  return out;
}

export function sshConfigHostCandidates(): string[] {
  try {
    return parseSshConfigHosts(fs.readFileSync(path.join(os.homedir(), ".ssh", "config"), "utf8"));
  } catch {
    return [];
  }
}

// --------------------------- discovery + state -----------------------------

const FRAME_SESSION = "@@RCW_SESSION@@";
const FRAME_PANE = "@@RCW_PANE@@";

/** One remote command per host: list every tmux session with its metadata and a
 * tail of its pane, framed so we can parse it in one round trip. */
function scanCommand(): string {
  // `list-sessions` gives name/created/path; capture-pane gives the visible tail.
  return (
    `tmux list-sessions -F '${FRAME_SESSION}#{session_name}\t#{session_created}\t#{pane_current_path}\t#{pane_current_command}' 2>/dev/null | ` +
    `while IFS= read -r line; do ` +
    `  echo "$line"; ` +
    `  name=$(printf '%s' "$line" | sed 's/^${FRAME_SESSION}//; s/\t.*//'); ` +
    `  echo '${FRAME_PANE}'; ` +
    `  tmux capture-pane -p -t "$name" -S -${CAPTURE_LINES} 2>/dev/null; ` +
    `done`
  );
}

/** Heuristic session state from the pane's recent text. Pure + testable.
 * - working: Claude is mid-turn (shows its interrupt hint / a running spinner).
 * - waiting: Claude is asking you something (a select prompt or an empty input box).
 * - idle: a shell prompt or nothing actionable. */
export function inferState(transcript: string): OfflineSessionState {
  const lines = transcript.replace(/\s+$/g, "").split("\n");
  const tail = lines.slice(-14).join("\n");
  const low = tail.toLowerCase();
  if (/esc to interrupt|interrupt\b|✻|✳|⏳|working…|thinking…|\besc\b to stop/i.test(tail)) return "working";
  // A selection prompt (❯ / numbered choices) or a yes/no, or Claude's input box.
  if (/[❯▶]\s|\b1\.\s.+\n\s*2\.\s|\(y\/n\)|do you want|approve|allow this|permission|\bwaiting for\b/i.test(tail)) return "waiting";
  if (/│\s*>\s*$|╰─+╯|\bhuman:\s*$|>\s*$/.test(tail) && !/\$\s*$|#\s*$/.test(low)) return "waiting";
  return "idle";
}

/** Does this session look like a Claude Code session (vs a plain shell)? */
export function looksLikeClaude(name: string, paneCmd: string, transcript: string): boolean {
  if (/^rcw-/i.test(name)) return true;
  if (/^(claude|node)$/i.test(paneCmd.trim())) {
    return /claude|anthropic|esc to interrupt|\? for shortcuts|tokens|✻|context left/i.test(transcript);
  }
  return /claude|esc to interrupt|\? for shortcuts/i.test(transcript);
}

/** Parse the framed scan output for one host into sessions. Pure + testable. */
export function parseHostScan(hostAlias: string, host: string, raw: string): OfflineSession[] {
  const sessions: OfflineSession[] = [];
  // Split into per-session chunks on the session frame marker.
  const chunks = raw.split(FRAME_SESSION).slice(1);
  for (const chunk of chunks) {
    const paneIdx = chunk.indexOf(FRAME_PANE);
    const header = (paneIdx >= 0 ? chunk.slice(0, paneIdx) : chunk).trim();
    const pane = paneIdx >= 0 ? chunk.slice(paneIdx + FRAME_PANE.length).replace(/^\n/, "") : "";
    const [name, created, cwd, paneCmd] = header.split("\t");
    if (!name) continue;
    const transcript = pane.replace(/\s+$/g, "");
    if (!looksLikeClaude(name, paneCmd ?? "", transcript)) continue;
    sessions.push({
      id: `${hostAlias}::${name}`,
      hostAlias,
      host,
      tmux: name,
      cwd: cwd || "",
      createdAt: Number(created) ? Number(created) * 1000 : 0,
      state: inferState(transcript),
      transcript,
    });
  }
  return sessions;
}

// ------------------------------ operations ---------------------------------

/** Scan one host for its Claude sessions. Never throws — a dead host yields []. */
export async function scanHost(h: OfflineHost): Promise<{ ok: true; sessions: OfflineSession[] } | { ok: false; error: string }> {
  try {
    const raw = await sshRun(h.host, scanCommand());
    return { ok: true, sessions: parseHostScan(h.alias, h.host, raw) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Scan every configured host and pool their sessions (newest-waiting first). */
export async function scanAll(hosts: OfflineHost[]): Promise<{ sessions: OfflineSession[]; errors: Record<string, string> }> {
  const results = await Promise.all(hosts.map(async (h) => ({ h, r: await scanHost(h) })));
  const sessions: OfflineSession[] = [];
  const errors: Record<string, string> = {};
  for (const { h, r } of results) {
    if (r.ok) sessions.push(...r.sessions);
    else errors[h.alias] = r.error;
  }
  // Waiting first, then working, then idle; each newest-first.
  const rank = (s: OfflineSession) => (s.state === "waiting" ? 0 : s.state === "working" ? 1 : 2);
  sessions.sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt);
  return { sessions, errors };
}

/** Type text into a session's tmux pane, then press Enter — how you'd answer. */
export async function answerOffline(host: string, tmux: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    // Send the literal text (‑l) then a separate Enter, so multi-line/odd chars are safe.
    await sshRun(host, `tmux send-keys -t ${shellQuote(tmux)} -l ${shellQuote(text)} && tmux send-keys -t ${shellQuote(tmux)} Enter`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Send a single key/keys (e.g. "Enter", "Escape", "1", "y") to a pane. */
export async function sendKeyOffline(host: string, tmux: string, keys: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await sshRun(host, `tmux send-keys -t ${shellQuote(tmux)} ${shellQuote(keys)}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Filesystem-safe, unique-ish tmux session name for a new session. */
export function newSessionName(seed: number): string {
  return `rcw-${(seed >>> 0).toString(36)}`;
}

/** Start a new Claude Code session in a detached tmux on the host. Returns its id. */
export async function startOffline(
  h: OfflineHost,
  cwd: string,
  seed: number,
): Promise<{ ok: true; id: string; tmux: string } | { ok: false; error: string }> {
  const name = newSessionName(seed);
  try {
    await sshRun(
      h.host,
      `tmux new-session -d -s ${shellQuote(name)} -c ${shellQuote(cwd)} claude '--dangerously-skip-permissions'`,
    );
    return { ok: true, id: `${h.alias}::${name}`, tmux: name };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
