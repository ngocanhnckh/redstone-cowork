import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import * as api from "./api";
import type { ProviderMode } from "./providers";

// ---------------------------------------------------------------------------
// Which backend the cockpit runs against.
//
//   cloud  — the cowork server, exactly as today
//   direct — SSH straight to each host, no server in the path
//
// Resolution deliberately favours the status quo: an existing install with a
// configured server keeps using it until the user says otherwise. Silently switching
// someone's backend on upgrade would be alarming and hard to diagnose.
// ---------------------------------------------------------------------------

const storePath = (): string => path.join(app.getPath("userData"), "direct-mode.json");

export type ModeChoice = ProviderMode | null;

type Stored = { mode: ProviderMode; auto?: boolean };

function read(): Stored | null {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf8")) as Stored;
    if (raw?.mode === "cloud" || raw?.mode === "direct") return raw;
  } catch {
    // not decided yet
  }
  return null;
}

/** The recorded backend, whether the user picked it or the app decided at first run. */
export function readChoice(): ModeChoice {
  return read()?.mode ?? null;
}

/** True when the recorded backend was decided FOR the user rather than by them. */
export function wasAutoDecided(): boolean {
  return read()?.auto === true;
}

export function writeChoice(mode: ModeChoice, auto = false): void {
  try {
    if (mode === null) { fs.rmSync(storePath(), { force: true }); return; }
    fs.writeFileSync(storePath(), JSON.stringify({ mode, auto }), "utf8");
  } catch {
    // best-effort; resolveMode() still returns something sensible
  }
}

/**
 * Decide the backend ONCE, at the first launch of a direct-capable build, and persist it.
 *
 * This exists because signing in and choosing a backend are different questions, and
 * resolving them together got it wrong in both directions:
 *
 *   * A fresh install that signed in with Jira silently became cloud-backed — the user
 *     wanted an account for the leaderboard, not to route their sessions through a
 *     server. In the offline edition, signing in buys team features and nothing else.
 *   * Deciding lazily on every call meant the answer could CHANGE under the user: sign
 *     in and your sessions quietly move to a different backend.
 *
 * So: decide at first launch, when we can still tell the two cases apart, and never
 * revisit it. An install that already had a cowork server is an upgrade and must keep
 * working exactly as before; anything else is new and gets direct, which needs no
 * account and no server.
 */
export function initMode(): ProviderMode {
  const existing = read();
  if (existing) return existing.mode;
  const mode: ProviderMode = api.isConfigured() ? "cloud" : "direct";
  writeChoice(mode, true);
  return mode;
}

/** The effective backend. Stable for the life of the install unless the user changes it. */
export function resolveMode(): ProviderMode {
  return readChoice() ?? (api.isConfigured() ? "cloud" : "direct");
}

/**
 * True when the app chose the backend rather than the user. The UI says so, instead of
 * leaving someone to wonder why direct mode appears to do nothing.
 */
export function needsModeChoice(): boolean {
  return wasAutoDecided();
}
