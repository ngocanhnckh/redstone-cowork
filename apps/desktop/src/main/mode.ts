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

/** The user's explicit choice, if they've made one. */
export function readChoice(): ModeChoice {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf8")) as { mode?: string };
    if (raw?.mode === "cloud" || raw?.mode === "direct") return raw.mode;
  } catch {
    // never chosen
  }
  return null;
}

export function writeChoice(mode: ModeChoice): void {
  try {
    if (mode === null) { fs.rmSync(storePath(), { force: true }); return; }
    fs.writeFileSync(storePath(), JSON.stringify({ mode }), "utf8");
  } catch {
    // best-effort; the resolved default still works
  }
}

/**
 * The effective mode.
 *
 * 1. An explicit choice always wins.
 * 2. A configured cowork server means cloud — never change an existing install's
 *    backend behind its back.
 * 3. Otherwise direct, which needs no account and no server.
 */
export function resolveMode(): ProviderMode {
  const choice = readChoice();
  if (choice) return choice;
  return api.isConfigured() ? "cloud" : "direct";
}
